/**
 * Backup of what only the user created: manual status, hidden and pinned games, pins, exclusions,
 * notes and manual tags of achievements, snapshots (history Steam can't give back), milestones and
 * settings. Everything else comes back from Steam with the next sync.
 *
 * A restore only adds: it sets flags, fills empty notes and adds tags, but never removes anything.
 * Games that aren't synced yet wait in meta `pendingRestore` and are applied after later syncs.
 */
import type { Settings } from './app.svelte';
import type { Earned } from './appAchievements';
import type { Repo } from './db/repo';
import { aggregate, manualTags } from './sync/merge';
import { STATUSES, type Game, type Snapshot, type Status } from './types';

export const BACKUP_FORMAT = 1;
const PENDING = 'pendingRestore';

export interface BackupAchievement {
  apiname: string;
  pinned?: true;
  excluded?: true;
  note?: string;
  /** Manual tags only; auto tags are derived again. */
  tags?: string[];
}

export interface BackupGame {
  appid: number;
  /** Only for people reading the file. */
  name: string;
  /** Set when the user picked it. */
  status?: Status;
  hidden?: true;
  pinned?: true;
  achievements?: BackupAchievement[];
}

export interface Backup {
  app: 'achievement-hunter';
  format: number;
  createdAt: string;
  appVersion: string;
  steamid64: string | null;
  settings: Partial<Settings> | null;
  appAchievements: Earned;
  games: BackupGame[];
  snapshots: Snapshot[];
}

export class BackupError extends Error {
  constructor(public kind: 'invalid' | 'newer') {
    super(`Backup ${kind}`);
    this.name = 'BackupError';
  }
}

export async function createBackup(repo: Repo, appVersion: string, now = Date.now()): Promise<Backup> {
  const byGame = new Map<number, BackupAchievement[]>();
  for (const a of await repo.getAnnotatedAchievements()) {
    const tags = manualTags(a);
    const entry: BackupAchievement = {
      apiname: a.apiname,
      ...(a.pinned && { pinned: true as const }),
      ...(a.excluded && { excluded: true as const }),
      ...(a.note && { note: a.note }),
      ...(tags.length && { tags }),
    };
    // Rows with legacy tag data can turn out to hold only auto tags.
    if (Object.keys(entry).length === 1) continue;
    let list = byGame.get(a.appid);
    if (!list) byGame.set(a.appid, (list = []));
    list.push(entry);
  }
  const games: BackupGame[] = [];
  const covered = new Set<number>();
  for (const g of await repo.getGames()) {
    const achievements = byGame.get(g.appid);
    if (!achievements && !g.statusManual && !g.hidden && !g.pinned) continue;
    covered.add(g.appid);
    games.push({
      appid: g.appid,
      name: g.name,
      ...(g.statusManual && g.status && { status: g.status }),
      ...(g.hidden && { hidden: true as const }),
      ...(g.pinned && { pinned: true as const }),
      ...(achievements && { achievements }),
    });
  }
  // Entries of an earlier restore that are still waiting must not get lost.
  for (const p of await pending(repo)) if (!covered.has(p.appid)) games.push(p);

  const settings = await repo.getMeta('settings');
  const earned = await repo.getMeta('appAchievements');
  return {
    app: 'achievement-hunter',
    format: BACKUP_FORMAT,
    createdAt: new Date(now).toISOString(),
    appVersion,
    steamid64: await repo.getMeta('steamid64'),
    settings: settings ? JSON.parse(settings) : null,
    appAchievements: earned ? JSON.parse(earned) : {},
    games,
    snapshots: await repo.getSnapshots('0000-00-00'),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v != null && !Array.isArray(v);

/** Reads and checks a backup file. Unknown or broken entries are dropped, not trusted. */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('invalid');
  }
  if (!isObj(raw) || raw.app !== 'achievement-hunter' || typeof raw.format !== 'number' || !Array.isArray(raw.games)) {
    throw new BackupError('invalid');
  }
  if (raw.format > BACKUP_FORMAT) throw new BackupError('newer');
  const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const games: BackupGame[] = [];
  for (const g of raw.games) {
    if (!isObj(g) || !Number.isInteger(g.appid)) continue;
    const achievements: BackupAchievement[] = [];
    for (const a of Array.isArray(g.achievements) ? g.achievements : []) {
      if (!isObj(a) || typeof a.apiname !== 'string') continue;
      const tags = Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === 'string').map((t) => t.slice(0, 30)) : [];
      const note = str(a.note);
      achievements.push({
        apiname: a.apiname,
        ...(a.pinned === true && { pinned: true as const }),
        ...(a.excluded === true && { excluded: true as const }),
        ...(note && { note }),
        ...(tags.length && { tags }),
      });
    }
    games.push({
      appid: g.appid as number,
      name: str(g.name, 200) ?? String(g.appid),
      ...(STATUSES.includes(g.status as Status) && { status: g.status as Status }),
      ...(g.hidden === true && { hidden: true as const }),
      ...(g.pinned === true && { pinned: true as const }),
      ...(achievements.length && { achievements }),
    });
  }
  const snapshots = (Array.isArray(raw.snapshots) ? raw.snapshots : []).filter(
    (s): s is Snapshot =>
      isObj(s) && typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) &&
      Number.isInteger(s.appid) && Number.isFinite(s.playtime) && Number.isFinite(s.unlocked),
  );
  const earned = isObj(raw.appAchievements)
    ? Object.fromEntries(Object.entries(raw.appAchievements).filter(([, v]) => Number.isFinite(v)) as [string, number][])
    : {};
  return {
    app: 'achievement-hunter',
    format: raw.format,
    createdAt: str(raw.createdAt, 40) ?? '',
    appVersion: str(raw.appVersion, 40) ?? '',
    steamid64: str(raw.steamid64, 20) ?? null,
    settings: isObj(raw.settings) ? (raw.settings as Partial<Settings>) : null,
    appAchievements: earned,
    games,
    snapshots,
  };
}

export interface RestoreResult {
  /** Games whose data was applied. */
  games: Game[];
  /** Games that aren't synced yet; applied after a later sync. */
  pending: number;
  snapshots: number;
}

/** Applies a backup's game data and snapshots. Settings and milestones are up to the caller. */
export async function restoreBackup(repo: Repo, backup: Backup): Promise<RestoreResult> {
  // A newer restore of the same game wins over a waiting older one.
  const waiting = (await pending(repo)).filter((p) => !backup.games.some((g) => g.appid === p.appid));
  const res = await applyGames(repo, [...backup.games, ...waiting]);

  const have = new Set((await repo.getSnapshots('0000-00-00')).map((s) => `${s.date}|${s.appid}`));
  const fresh = backup.snapshots.filter((s) => !have.has(`${s.date}|${s.appid}`));
  await repo.addSnapshots(fresh);
  return { ...res, snapshots: fresh.length };
}

/** Applies what waits from an earlier restore. Cheap when nothing waits (one meta read). */
export async function applyPendingRestore(repo: Repo): Promise<Game[]> {
  const list = await pending(repo);
  return list.length ? (await applyGames(repo, list)).games : [];
}

async function pending(repo: Repo): Promise<BackupGame[]> {
  const raw = await repo.getMeta(PENDING);
  return raw ? (JSON.parse(raw) as BackupGame[]) : [];
}

async function applyGames(repo: Repo, entries: BackupGame[]): Promise<{ games: Game[]; pending: number }> {
  const games: Game[] = [];
  const later: BackupGame[] = [];
  for (const e of entries) {
    const known = await repo.getGame(e.appid);
    // Achievements not loaded yet: user data has nothing to attach to.
    if (!known || known.total == null) {
      later.push(e);
      continue;
    }
    let g: Game = {
      ...known,
      ...(e.status && { status: e.status, statusManual: true }),
      hidden: known.hidden || !!e.hidden,
      pinned: known.pinned || !!e.pinned,
    };
    if (e.achievements?.length) {
      const saved = new Map(e.achievements.map((a) => [a.apiname, a]));
      const list = await repo.getAchievements(e.appid);
      for (const a of list) {
        const b = saved.get(a.apiname);
        if (!b) continue;
        a.pinned ||= !!b.pinned;
        a.excluded ||= !!b.excluded;
        if (!a.note && b.note) a.note = b.note;
        if (b.tags?.length) {
          const manual = manualTags(a);
          a.manualTags = [...new Set([...manual, ...b.tags])];
          a.tags = [...new Set([...a.tags, ...b.tags])];
        }
      }
      await repo.saveAchievements(e.appid, list);
      g = { ...g, ...aggregate(list) };
    }
    await repo.saveGame(g);
    games.push(g);
  }
  if (later.length || (await repo.getMeta(PENDING))) await repo.setMeta(PENDING, JSON.stringify(later));
  return { games, pending: later.length };
}
