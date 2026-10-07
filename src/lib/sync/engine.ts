import type { Repo } from '../db/repo';
import { SteamApi, SteamApiError, isFatal } from '../steam/api';
import type { LocalGame, LocalPlaytime, LocalSteam } from '../steam/local';
import {
  emptyGame,
  isPerfect,
  type Achievement,
  type Game,
  type OwnedGame,
  type PlayerAchievement,
  type SchemaAchievement,
  type Snapshot,
} from '../types';
import { dayKey } from '../util';
import { aggregate, applyGlobal, applyPlayer, mergeSchema } from './merge';
import { planSync, type SyncTask } from './plan';
import { decideStatus } from './status';

export interface UnlockEvent {
  game: Game;
  achievement: Achievement;
}

export interface SyncProgress {
  done: number;
  total: number;
  current?: string;
}

export interface SyncResult {
  tasks: number;
  updated: number;
  unlocks: UnlockEvent[];
  errors: { appid: number; name: string; message: string }[];
  /** Set when the run stopped early (private profile, bad key, rate limit). */
  aborted: string | null;
  /** The error behind `aborted`, so the UI can show it in its own language. */
  abortedError?: unknown;
}

export interface EngineOptions {
  api: SteamApi;
  repo: Repo;
  steamid: string;
  /** Steam's local cache. When set, schemas and progress are read from disk where possible. */
  local?: LocalSteam | null;
  staleDays?: number;
  now?: () => number;
  onProgress?: (p: SyncProgress) => void;
  onUnlock?: (e: UnlockEvent) => void;
  /** An update added achievements to a game we already knew (never on the first look). */
  onAchievementsAdded?: (game: Game, added: Achievement[]) => void;
  /** Called after each game is saved, so the UI can refresh incrementally. */
  onGameUpdated?: (g: Game) => void;
}

/** How long an empty GetOwnedGames answer counts as Steam hiccup rather than a private profile. */
const PRIVATE_GRACE_MS = 24 * 3600_000;

export class SyncEngine {
  private running: Promise<SyncResult> | null = null;
  private localRunning: Promise<SyncResult> | null = null;
  private lastLocalScan: number | null = null;

  constructor(private opts: EngineOptions) {}

  get busy(): boolean {
    return this.running != null;
  }

  get hasLocal(): boolean {
    return this.opts.local != null;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  /** Library sync: one GetOwnedGames call plus whatever the plan says. Concurrent calls share one run. */
  sync(options: { force?: boolean } = {}): Promise<SyncResult> {
    if (!this.running) {
      // Wait for a local pass in flight so both never write the same game.
      this.running = (this.localRunning ?? Promise.resolve())
        .then(() => this.doSync(options.force ?? false))
        .finally(() => (this.running = null));
    }
    return this.running;
  }

  /**
   * Free pass over Steam's local cache: every game whose stats file Steam rewrote since
   * the last pass gets its progress from disk. No API call unless a game lacks a usable schema.
   */
  syncLocal(): Promise<SyncResult> {
    if (!this.opts.local || this.running) return Promise.resolve(emptyResult());
    if (!this.localRunning) {
      this.localRunning = this.doSyncLocal(this.opts.local).finally(() => (this.localRunning = null));
    }
    return this.localRunning;
  }

  private async doSyncLocal(local: LocalSteam): Promise<SyncResult> {
    const { repo } = this.opts;
    const result = emptyResult();
    const nowSec = Math.floor(this.now() / 1000);
    if (this.lastLocalScan == null) {
      const stored = await repo.getMeta('localScan');
      // First pass ever: the library sync at startup covers older changes.
      this.lastLocalScan = stored ? Number(stored) : nowSec;
    }
    const ids = await local.changedSince(this.lastLocalScan);
    // File times have 1 s resolution: overlap by a second so a write during the scan isn't missed.
    this.lastLocalScan = nowSec - 1;
    await repo.setMeta('localScan', String(this.lastLocalScan));

    const known = new Map<number, Game>();
    const tasks: SyncTask[] = [];
    for (const appid of ids) {
      const k = await repo.getGame(appid);
      // Unknown games come with the next library sync; games without achievements have nothing to read.
      if (!k || k.total === 0) continue;
      known.set(appid, k);
      tasks.push({ appid, schema: k.total == null, player: true, global: k.total == null, priority: 0, reason: 'local' });
    }
    if (tasks.length) await this.runTasks(tasks, known, new Map(), result);
    return result;
  }

  /** Live mode: refresh one game's progress only (from disk if possible, else 1 API call). */
  async syncGame(appid: number): Promise<SyncResult> {
    const known = await this.opts.repo.getGame(appid);
    const result = emptyResult();
    if (!known) return result;
    const task: SyncTask = {
      appid,
      schema: known.total == null,
      player: true,
      global: known.total == null,
      priority: 0,
      reason: 'live',
    };
    await this.runTasks([task], new Map([[appid, known]]), new Map(), result);
    return result;
  }

  private async doSync(force: boolean): Promise<SyncResult> {
    const { api, repo, steamid } = this.opts;
    const result = emptyResult();
    const known = new Map((await repo.getGames()).map((g) => [g.appid, g]));
    let apiOwned: OwnedGame[];
    try {
      apiOwned = await api.getOwnedGames(steamid);
    } catch (e) {
      // Steam sometimes answers with an empty library for minutes even though it is public.
      // With a library that synced within a day, skip this run instead of blaming the privacy
      // settings; the next run asks again. A profile that really went private still shows up.
      const lastSync = Number(await repo.getMeta('lastSync')) || 0;
      const hadLibrary = [...known.values()].some((g) => g.owned !== false);
      if (e instanceof SteamApiError && e.kind === 'private' && hadLibrary && this.now() - lastSync < PRIVATE_GRACE_MS) {
        return result;
      }
      throw e;
    }
    const playtimes = await this.localPlaytimes();
    const owned = withLocalPlaytime([...apiOwned, ...(await this.notOwnedGames(apiOwned, known, playtimes))], playtimes);
    const ownedById = new Map(owned.map((o) => [o.appid, o]));

    const tasks = planSync(owned, known, { now: this.now(), force });
    const taskIds = new Set(tasks.map((t) => t.appid));

    // Games without a task only need their basic data refreshed (name, playtime, status).
    const passive: Game[] = [];
    for (const o of owned) {
      if (taskIds.has(o.appid)) continue;
      const k = known.get(o.appid) ?? emptyGame(o.appid, o.name);
      passive.push(this.withStatus(this.withOwned(k, o), k));
    }
    await repo.saveGames(passive);

    await this.runTasks(tasks, known, ownedById, result, force);
    await this.recordSnapshots(owned, known);
    await repo.setMeta('lastSync', String(this.now()));
    return result;
  }

  private async localPlaytimes(): Promise<Map<number, LocalPlaytime>> {
    const list = this.opts.local ? await this.opts.local.playtimes().catch(() => []) : [];
    return new Map(list.map((p) => [p.appid, p]));
  }

  /**
   * Games Steam leaves out of GetOwnedGames although its profile average counts them
   * (family sharing, free weekends, refunds, playtests). Known ones come from the repo, new
   * ones from the local cache: a stats file of this account with at least one unlock.
   * No API call. Files checked without an unlock are only read again once Steam rewrites them.
   */
  private async notOwnedGames(apiOwned: OwnedGame[], known: Map<number, Game>, playtimes: Map<number, LocalPlaytime>): Promise<OwnedGame[]> {
    const { local, repo } = this.opts;
    const ownedIds = new Set(apiOwned.map((o) => o.appid));
    const out: OwnedGame[] = [];
    for (const k of known.values()) {
      if (k.owned !== false || ownedIds.has(k.appid)) continue;
      out.push({ appid: k.appid, name: k.name, playtime_forever: k.playtime, rtime_last_played: k.lastPlayed, img_icon_url: k.iconHash, owned: false });
    }
    if (!local) return out;

    const nowSec = Math.floor(this.now() / 1000);
    let scan: { at: number; none: number[] } | null = null;
    try {
      scan = JSON.parse((await repo.getMeta('notOwnedScan')) ?? 'null');
    } catch {
      /* rescan */
    }
    const changed = new Set(scan ? await local.changedSince(scan.at) : []);
    const none = new Set((scan?.none ?? []).filter((id) => !changed.has(id)));
    for (const appid of await local.changedSince(0)) {
      if (ownedIds.has(appid) || known.has(appid) || none.has(appid)) continue;
      const g = await this.readLocal(appid);
      if (!g?.achievements.some((a) => a.achieved)) {
        none.add(appid);
        continue;
      }
      const p = playtimes.get(appid);
      out.push({
        appid,
        name: g.name || String(appid),
        playtime_forever: p?.playtime ?? 0,
        rtime_last_played: p?.lastPlayed || g.statsMtime || 0,
        owned: false,
      });
    }
    // Overlap by a second, like the local pass: file times have 1 s resolution.
    await repo.setMeta('notOwnedScan', JSON.stringify({ at: nowSec - 1, none: [...none] }));
    return out;
  }

  private async readLocal(appid: number): Promise<LocalGame | null> {
    return this.opts.local ? this.opts.local.game(appid).catch(() => null) : null;
  }

  /**
   * GetSchemaForGame leaves out the descriptions of hidden achievements. Fills them in place
   * from what we stored, Steam's cache, or one GetGameAchievements call (only if still missing).
   * Returns true when something was filled.
   */
  private async fillDescriptions(
    appid: number,
    list: SchemaAchievement[],
    local: LocalGame | null,
    stored: Achievement[] = [],
    /** false = only what we stored and Steam's cache, no API call. */
    useApi = true,
  ): Promise<boolean> {
    const missing = () => list.filter((a) => a.hidden && !a.description);
    if (!missing().length) return false;
    const fill = (texts: Map<string, string>) => {
      let n = 0;
      for (const a of missing()) {
        const d = texts.get(a.apiname);
        if (!d) continue;
        a.description = d;
        n++;
      }
      return n;
    };
    let filled = fill(new Map(stored.filter((a) => a.description).map((a) => [a.apiname, a.description])));
    if (local?.languageMatch) {
      filled += fill(new Map(local.achievements.filter((a) => a.description).map((a) => [a.apiname, a.description])));
    }
    if (useApi && missing().length) {
      try {
        filled += fill(await this.opts.api.getDescriptions(appid));
      } catch (e) {
        // Descriptions are nice to have: only errors that stop the whole run count.
        if (isFatal(e)) throw e;
      }
    }
    return filled > 0;
  }

  /**
   * Fills missing hidden descriptions of a stored game (data from before they were fetched).
   * `useApi: false` only reads Steam's cache. True when something was filled.
   */
  async fillHiddenDescriptions(appid: number, { useApi = true } = {}): Promise<boolean> {
    const { repo } = this.opts;
    // Look the texts up first, so a sync in flight doesn't delay them.
    const found = await repo.getAchievements(appid);
    if (!(await this.fillDescriptions(appid, found, await this.readLocal(appid), [], useApi))) return false;
    const texts = new Map(found.filter((a) => a.hidden && a.description).map((a) => [a.apiname, a.description]));

    // Don't write while a sync might be saving the same game; apply the texts to what it saved.
    while (this.running || this.localRunning) await Promise.allSettled([this.running, this.localRunning]);
    const list = await repo.getAchievements(appid);
    let filled = 0;
    for (const a of list) {
      const d = a.hidden && !a.description ? texts.get(a.apiname) : undefined;
      if (!d) continue;
      a.description = d;
      filled++;
    }
    if (filled) await repo.saveAchievements(appid, mergeSchema(list, list));
    return true;
  }

  /**
   * One-time repair for games synced before hidden descriptions were fetched: fills them from
   * Steam's cache, no API call. Games the cache doesn't know get them when opened.
   * Returns the number of games filled.
   */
  async backfillHiddenDescriptions(): Promise<number> {
    const { local, repo } = this.opts;
    if (!local || (await repo.getMeta('hiddenDescBackfill'))) return 0;
    let n = 0;
    // One game at a time, so only one achievement list is in memory.
    for (const g of await repo.getGames()) {
      if (!g.total) continue;
      const list = await repo.getAchievements(g.appid);
      if (!list.some((a) => a.hidden && !a.description)) continue;
      if (await this.fillHiddenDescriptions(g.appid, { useApi: false })) n++;
    }
    await repo.setMeta('hiddenDescBackfill', String(this.now()));
    return n;
  }

  private async runTasks(
    tasks: SyncTask[],
    known: Map<number, Game>,
    owned: Map<number, OwnedGame>,
    result: SyncResult,
    /** A forced sync asks Steam's servers only and skips the local cache. */
    apiOnly = false,
  ): Promise<void> {
    result.tasks = tasks.length;
    let done = 0;
    let stop = false;
    this.opts.onProgress?.({ done, total: tasks.length });

    // The limiter inside SteamApi caps parallel requests; this only keeps a few games in flight.
    const queue = [...tasks];
    const worker = async () => {
      while (!stop) {
        const task = queue.shift();
        if (!task) return;
        const k = known.get(task.appid);
        const o = owned.get(task.appid);
        const name = o?.name ?? k?.name ?? String(task.appid);
        try {
          const changed = await this.runTask(task, k ?? null, o ?? null, result, apiOnly);
          if (changed) result.updated++;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          result.errors.push({ appid: task.appid, name, message });
          if (isFatal(e)) {
            stop = true;
            result.aborted = message;
            result.abortedError = e;
          }
        }
        this.opts.onProgress?.({ done: ++done, total: tasks.length, current: name });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  /** Returns true when something visible changed. Throws on failure without touching stored data. */
  private async runTask(task: SyncTask, known: Game | null, owned: OwnedGame | null, result: SyncResult, apiOnly: boolean): Promise<boolean> {
    const { api, repo, steamid } = this.opts;
    const now = this.now();
    const base = known ?? emptyGame(task.appid, owned?.name ?? String(task.appid));
    // First time we see this game's progress: its unlocks are history, not news.
    // (A game we knew as unplayed had nothing unlocked, so its unlocks are news.)
    const firstLook = !known || (base.playerFetchedAt == null && base.playtime > 0);

    let list = await repo.getAchievements(task.appid);
    const game: Game = { ...base };

    const local = apiOnly ? null : await this.readLocal(task.appid);
    // Only trust the cached schema if Steam wrote it after our last fetch and in our language,
    // so an old cache file never replaces a newer schema from the API.
    const localSchema: SchemaAchievement[] | null =
      local && local.achievements.length > 0 && local.languageMatch && local.schemaMtime * 1000 > (base.schemaFetchedAt ?? 0)
        ? local.achievements.map(({ achieved: _a, unlocktime: _u, progress: _p, ...s }) => s)
        : null;
    // The stats file is current unless the game was played since Steam last wrote it (another PC, Steam Deck).
    // Local and live passes are triggered by the file or the running game, so they read it directly.
    const localProgress =
      local?.statsMtime != null &&
      (task.reason === 'local' ||
        task.reason === 'live' ||
        local.statsMtime >= (owned?.rtime_last_played ?? base.lastPlayed));

    // Everything is fetched before anything is written, so a failure leaves the old data intact.
    let schema = task.schema ? (localSchema ?? (await api.getSchema(task.appid))) : null;
    let player: PlayerAchievement[] | null = null;
    let count: number | null = null;
    // The cache only adds unlocks: it never relocks anything, and its clock can be a few
    // seconds off the server's, so achievements we already have keep their time.
    const localUnlocks = (l: LocalGame): PlayerAchievement[] => {
      const have = new Set(list.filter((a) => a.achieved).map((a) => a.apiname));
      return l.achievements
        .filter((a) => a.achieved && !have.has(a.apiname))
        .map(({ apiname, achieved, unlocktime }) => ({ apiname, achieved, unlocktime }));
    };
    if (task.player && (schema ? schema.length > 0 : (base.total ?? 0) > 0)) {
      if (localProgress) {
        player = localUnlocks(local!);
        if (localSchema) count = local!.achievements.length;
      } else {
        try {
          player = await api.getPlayerAchievements(task.appid, steamid);
          count = player?.length ?? null;
        } catch (e) {
          // Steam also says "not public" for single games outside the library (family sharing,
          // refunds). A private profile already fails at GetOwnedGames, so this one is not fatal:
          // take what the local cache has, or fail just this game.
          if (!(e instanceof SteamApiError && e.kind === 'private')) throw e;
          if (!local?.statsMtime) throw new SteamApiError('http', `GetPlayerAchievements ${task.appid}: not public`, e.status);
          player = localUnlocks(local);
        }
      }
    }
    // A different count than we know means the game was updated: get the new schema.
    if (!schema && count != null && count !== list.length) {
      schema = localSchema ?? (await api.getSchema(task.appid));
    }
    if (schema && schema !== localSchema) await this.fillDescriptions(task.appid, schema, local, list);
    const hasAchievements = schema ? schema.length > 0 : list.length > 0;
    const percents = task.global && hasAchievements ? await api.getGlobalPercentages(task.appid) : null;

    let added: Achievement[] = [];
    if (schema) {
      const before = new Set(list.map((a) => a.apiname));
      // On the first look everything is "new"; only later additions come from an update.
      list = mergeSchema(list, schema, firstLook ? 0 : Math.floor(now / 1000));
      if (!firstLook && before.size) added = list.filter((a) => !before.has(a.apiname));
      game.schemaFetchedAt = now;
    }
    let fresh: Achievement[] = [];
    if (player) {
      fresh = applyPlayer(list, player);
      game.playerFetchedAt = now;
    } else if (task.player && hasAchievements === false) {
      game.playerFetchedAt = now;
    }
    if (percents) {
      applyGlobal(list, percents);
      game.globalFetchedAt = now;
    }

    Object.assign(game, aggregate(list));
    if (owned) Object.assign(game, this.withOwned(game, owned));
    const final = this.withStatus(game, base);

    await repo.saveAchievements(task.appid, list);
    await repo.saveGame(final);
    this.opts.onGameUpdated?.(final);

    if (added.length) this.opts.onAchievementsAdded?.(final, added);
    if (!firstLook) {
      for (const a of fresh) {
        const ev = { game: final, achievement: a };
        result.unlocks.push(ev);
        this.opts.onUnlock?.(ev);
      }
    }
    return (
      fresh.length > 0 ||
      final.total !== base.total ||
      final.playtime !== base.playtime ||
      final.status !== base.status
    );
  }

  private withOwned(g: Game, o: OwnedGame): Game {
    return {
      ...g,
      name: o.name || g.name,
      playtime: o.playtime_forever,
      lastPlayed: o.rtime_last_played ?? 0,
      iconHash: o.img_icon_url ?? g.iconHash,
      owned: o.owned !== false,
    };
  }

  private withStatus(g: Game, before: Game): Game {
    const perfect = isPerfect(g);
    const out = { ...g, wasPerfect: g.wasPerfect || perfect };
    // Games that were never played and have no status stay out of the status board.
    if (g.statusManual || (g.playtime === 0 && !g.status)) return out;
    out.status = decideStatus(g.status, {
      perfect,
      playedAgain: g.playtime > before.playtime && before.playtime > 0,
      lastPlayed: g.lastPlayed,
      staleDays: this.opts.staleDays ?? 14,
      now: Math.floor(this.now() / 1000),
    });
    return out;
  }

  /** One row per game and day, only when playtime or unlocks changed. */
  private async recordSnapshots(owned: OwnedGame[], before: Map<number, Game>): Promise<void> {
    const { repo } = this.opts;
    const day = dayKey(this.now());
    const after = new Map((await repo.getGames()).map((g) => [g.appid, g]));
    const rows: Snapshot[] = [];
    for (const o of owned) {
      const a = after.get(o.appid);
      if (!a || a.playtime === 0) continue;
      const b = before.get(o.appid);
      if (b && b.playtime === a.playtime && b.unlocked === a.unlocked) continue;
      rows.push({ date: day, appid: a.appid, playtime: a.playtime, unlocked: a.unlocked });
    }
    if (rows.length) await repo.addSnapshots(rows);
  }
}

/** The local playtime is only written when a session ends, so take whichever source is further. */
function withLocalPlaytime(owned: OwnedGame[], local: Map<number, LocalPlaytime>): OwnedGame[] {
  if (!local.size) return owned;
  return owned.map((o) => {
    const l = local.get(o.appid);
    if (!l) return o;
    return {
      ...o,
      playtime_forever: Math.max(o.playtime_forever, l.playtime),
      rtime_last_played: Math.max(o.rtime_last_played ?? 0, l.lastPlayed),
    };
  });
}

function emptyResult(): SyncResult {
  return { tasks: 0, updated: 0, unlocks: [], errors: [], aborted: null };
}
