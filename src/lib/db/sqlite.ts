import Database from '@tauri-apps/plugin-sql';
import type { Achievement, Game, Snapshot, Status } from '../types';
import { migrate, type SqlDb } from './migrate';
import { KEEP_META, type Repo } from './repo';

const GAME_COLS =
  'appid, name, playtime, last_played, icon_hash, status, status_manual, unlocked, total, schema_fetched_at, player_fetched_at, global_fetched_at, was_perfect, hidden, pinned, easy_open, effort, rarest_open, rarity_score, last_unlock, owned, pinned_open';
const ACH_COLS =
  'appid, apiname, name, description, hidden, icon, icongray, achieved, unlocktime, percent, pinned, excluded, note, tags, sort, manual_tags, added_at';

const b = (v: boolean) => (v ? 1 : 0);

function gameParams(g: Game): unknown[] {
  return [
    g.appid, g.name, g.playtime, g.lastPlayed, g.iconHash, g.status, b(g.statusManual), g.unlocked, g.total,
    g.schemaFetchedAt, g.playerFetchedAt, g.globalFetchedAt, b(g.wasPerfect), b(g.hidden), b(g.pinned),
    g.easyOpen, g.effort, g.rarestOpen, g.rarityScore, g.lastUnlock, b(g.owned), g.pinnedOpen ?? 0,
  ];
}

function rowToGame(r: any): Game {
  return {
    appid: r.appid,
    name: r.name,
    playtime: r.playtime,
    lastPlayed: r.last_played,
    iconHash: r.icon_hash,
    status: (r.status as Status) ?? null,
    statusManual: !!r.status_manual,
    unlocked: r.unlocked,
    total: r.total ?? null,
    schemaFetchedAt: r.schema_fetched_at ?? null,
    playerFetchedAt: r.player_fetched_at ?? null,
    globalFetchedAt: r.global_fetched_at ?? null,
    wasPerfect: !!r.was_perfect,
    hidden: !!r.hidden,
    pinned: !!r.pinned,
    owned: !!r.owned,
    easyOpen: r.easy_open,
    effort: r.effort,
    rarestOpen: r.rarest_open ?? null,
    rarityScore: r.rarity_score,
    lastUnlock: r.last_unlock,
    pinnedOpen: r.pinned_open ?? 0,
  };
}

function rowToAch(r: any): Achievement & { appid: number } {
  return {
    appid: r.appid,
    apiname: r.apiname,
    name: r.name,
    description: r.description,
    hidden: !!r.hidden,
    icon: r.icon,
    icongray: r.icongray,
    achieved: !!r.achieved,
    unlocktime: r.unlocktime,
    percent: r.percent ?? null,
    pinned: !!r.pinned,
    excluded: !!r.excluded,
    note: r.note,
    tags: r.tags ? String(r.tags).split(',') : [],
    ...(r.manual_tags != null && { manualTags: r.manual_tags ? String(r.manual_tags).split(',') : [] }),
    addedAt: r.added_at ?? 0,
  };
}

/** Builds "(?, ?, …), (?, ?, …)" with $n placeholders for `rows` rows of `cols` values. */
function placeholders(rows: number, cols: number): string {
  const out: string[] = [];
  let n = 1;
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) row.push(`$${n++}`);
    out.push(`(${row.join(', ')})`);
  }
  return out.join(', ');
}

/** SQLite allows 32766 variables per statement; stay well below. */
const CHUNK = 500;

export class SqliteRepo implements Repo {
  private constructor(
    private db: SqlDb,
    readonly schemaVersion: number,
  ) {}

  /**
   * Opens and migrates the database. Before an existing database is upgraded, a consistent copy
   * (VACUUM INTO, works in WAL mode) goes to `backupPath(from)`.
   */
  static async open(path = 'sqlite:achievement-hunter.db', backupPath?: (from: number) => Promise<string>): Promise<SqliteRepo> {
    return SqliteRepo.from(await Database.load(path), backupPath);
  }

  /** Also used by the tests, with a node:sqlite adapter. */
  static async from(db: SqlDb, backupPath?: (from: number) => Promise<string>): Promise<SqliteRepo> {
    await db.execute('PRAGMA journal_mode = WAL');
    const backup = backupPath
      ? async (from: number) => {
          await db.execute('VACUUM INTO $1', [await backupPath(from)]).catch((e) => {
            // A copy from an earlier, interrupted attempt is just as good.
            if (!/exists/i.test(String(e))) throw e;
          });
        }
      : undefined;
    const { to } = await migrate(db, backup);
    return new SqliteRepo(db, to);
  }

  async getGames() {
    const rows = await this.db.select<any[]>(`SELECT ${GAME_COLS} FROM games`);
    return rows.map(rowToGame);
  }

  async getGame(appid: number) {
    const rows = await this.db.select<any[]>(`SELECT ${GAME_COLS} FROM games WHERE appid = $1`, [appid]);
    return rows[0] ? rowToGame(rows[0]) : null;
  }

  async saveGame(game: Game) {
    await this.saveGames([game]);
  }

  async saveGames(games: Game[]) {
    const cols = GAME_COLS.split(', ');
    const update = cols.slice(1).map((c) => `${c} = excluded.${c}`).join(', ');
    for (let i = 0; i < games.length; i += CHUNK) {
      const chunk = games.slice(i, i + CHUNK);
      await this.db.execute(
        `INSERT INTO games (${GAME_COLS}) VALUES ${placeholders(chunk.length, cols.length)}
         ON CONFLICT(appid) DO UPDATE SET ${update}`,
        chunk.flatMap(gameParams),
      );
    }
  }

  async getAchievements(appid: number) {
    const rows = await this.db.select<any[]>(`SELECT ${ACH_COLS} FROM achievements WHERE appid = $1 ORDER BY sort`, [appid]);
    return rows.map(({ appid: _a, ...r }) => rowToAch({ appid, ...r }));
  }

  async saveAchievements(appid: number, list: Achievement[]) {
    const cols = ACH_COLS.split(', ');
    const update = cols.slice(2).map((c) => `${c} = excluded.${c}`).join(', ');
    for (let i = 0; i < list.length; i += CHUNK) {
      const chunk = list.slice(i, i + CHUNK);
      const params = chunk.flatMap((a, j) => [
        appid, a.apiname, a.name, a.description, b(a.hidden), a.icon, a.icongray, b(a.achieved), a.unlocktime,
        a.percent, b(a.pinned), b(a.excluded), a.note, a.tags.join(','), i + j,
        a.manualTags ? a.manualTags.join(',') : null, a.addedAt ?? 0,
      ]);
      await this.db.execute(
        `INSERT INTO achievements (${ACH_COLS}) VALUES ${placeholders(chunk.length, cols.length)}
         ON CONFLICT(appid, apiname) DO UPDATE SET ${update}`,
        params,
      );
    }
    // Remove achievements that are no longer in the list.
    if (list.length === 0) {
      await this.db.execute('DELETE FROM achievements WHERE appid = $1', [appid]);
    } else {
      const names = list.map((a) => a.apiname);
      const ph = names.map((_, k) => `$${k + 2}`).join(', ');
      await this.db.execute(`DELETE FROM achievements WHERE appid = $1 AND apiname NOT IN (${ph})`, [appid, ...names]);
    }
  }

  /** Achievements with their game's name, from games that aren't hidden. */
  private async achRows(where: string, params: unknown[], tail: string) {
    const cols = ACH_COLS.split(', ').map((c) => `a.${c}`).join(', ');
    const rows = await this.db.select<any[]>(
      `SELECT ${cols}, g.name AS game_name FROM achievements a JOIN games g ON g.appid = a.appid
       WHERE g.hidden = 0 AND ${where} ${tail}`,
      params,
    );
    return rows.map((r) => ({ ...rowToAch(r), gameName: r.game_name as string }));
  }

  async getUnlocks({ before, limit }: { before?: number; limit: number }) {
    return this.achRows(
      'a.achieved = 1 AND a.unlocktime > 0 AND a.unlocktime < $1',
      [before ?? Number.MAX_SAFE_INTEGER, limit],
      'ORDER BY a.unlocktime DESC LIMIT $2',
    );
  }

  async getPinnedOpen() {
    return this.achRows('a.pinned = 1 AND a.achieved = 0 AND a.excluded = 0', [], 'ORDER BY g.last_played DESC, a.appid, a.sort');
  }

  async searchAchievements(q: string, limit: number, revealHidden: boolean) {
    // The user's text goes into LIKE: escape its wildcards (with !, which needs no quoting).
    const like = `%${q.replace(/[!%_]/g, (c) => '!' + c)}%`;
    return this.achRows(
      `(a.name LIKE $1 ESCAPE '!' OR a.note LIKE $1 ESCAPE '!'
        OR ((a.hidden = 0 OR a.achieved = 1 OR $2 = 1) AND a.description LIKE $1 ESCAPE '!'))`,
      [like, b(revealHidden), limit],
      'ORDER BY a.achieved, g.last_played DESC LIMIT $3',
    );
  }

  async unlocksPerDay(sinceUnix: number) {
    return this.db.select<{ day: string; n: number }[]>(
      `SELECT date(a.unlocktime, 'unixepoch', 'localtime') AS day, COUNT(*) AS n
       FROM achievements a JOIN games g ON g.appid = a.appid
       WHERE a.achieved = 1 AND a.unlocktime >= $1 AND g.hidden = 0
       GROUP BY day`,
      [Math.max(sinceUnix, 1)],
    );
  }

  async addSnapshots(snapshots: Snapshot[]) {
    for (let i = 0; i < snapshots.length; i += CHUNK) {
      const chunk = snapshots.slice(i, i + CHUNK);
      await this.db.execute(
        `INSERT INTO snapshots (date, appid, playtime, unlocked) VALUES ${placeholders(chunk.length, 4)}
         ON CONFLICT(date, appid) DO UPDATE SET playtime = excluded.playtime, unlocked = excluded.unlocked`,
        chunk.flatMap((s) => [s.date, s.appid, s.playtime, s.unlocked]),
      );
    }
  }

  async getSnapshots(sinceDay: string, appid?: number) {
    if (appid == null) {
      return this.db.select<Snapshot[]>('SELECT date, appid, playtime, unlocked FROM snapshots WHERE date >= $1', [sinceDay]);
    }
    return this.db.select<Snapshot[]>(
      'SELECT date, appid, playtime, unlocked FROM snapshots WHERE date >= $1 AND appid = $2 ORDER BY date',
      [sinceDay, appid],
    );
  }

  async getAnnotatedAchievements() {
    // NULL manual_tags (older rows) may hide manual tags in `tags`: the caller sorts those out.
    const rows = await this.db.select<any[]>(
      `SELECT ${ACH_COLS} FROM achievements
       WHERE pinned = 1 OR excluded = 1 OR note <> '' OR manual_tags <> '' OR (manual_tags IS NULL AND tags <> '')
       ORDER BY appid, sort`,
    );
    return rows.map(rowToAch);
  }

  async clearAccountData() {
    await this.db.execute('DELETE FROM achievements');
    await this.db.execute('DELETE FROM games');
    await this.db.execute('DELETE FROM snapshots');
    await this.db.execute(`DELETE FROM meta WHERE key NOT IN (${KEEP_META.map((_, i) => `$${i + 1}`).join(', ')})`, [...KEEP_META]);
  }

  async getMeta(key: string) {
    const rows = await this.db.select<{ value: string }[]>('SELECT value FROM meta WHERE key = $1', [key]);
    return rows[0]?.value ?? null;
  }

  async setMeta(key: string, value: string) {
    await this.db.execute(
      'INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }
}
