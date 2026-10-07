import Database from '@tauri-apps/plugin-sql';
import type { Achievement, Game, Snapshot, Status } from '../types';
import type { Repo } from './repo';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS games (
    appid INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    playtime INTEGER NOT NULL DEFAULT 0,
    last_played INTEGER NOT NULL DEFAULT 0,
    icon_hash TEXT NOT NULL DEFAULT '',
    status TEXT,
    status_manual INTEGER NOT NULL DEFAULT 0,
    unlocked INTEGER NOT NULL DEFAULT 0,
    total INTEGER,
    schema_fetched_at INTEGER,
    player_fetched_at INTEGER,
    global_fetched_at INTEGER,
    was_perfect INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    easy_open INTEGER NOT NULL DEFAULT 0,
    effort REAL NOT NULL DEFAULT 0,
    rarest_open REAL,
    rarity_score REAL NOT NULL DEFAULT 0,
    last_unlock INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS achievements (
    appid INTEGER NOT NULL,
    apiname TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    hidden INTEGER NOT NULL DEFAULT 0,
    icon TEXT NOT NULL DEFAULT '',
    icongray TEXT NOT NULL DEFAULT '',
    achieved INTEGER NOT NULL DEFAULT 0,
    unlocktime INTEGER NOT NULL DEFAULT 0,
    percent REAL,
    pinned INTEGER NOT NULL DEFAULT 0,
    excluded INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (appid, apiname)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ach_unlock ON achievements(unlocktime) WHERE achieved = 1`,
  `CREATE TABLE IF NOT EXISTS snapshots (
    date TEXT NOT NULL,
    appid INTEGER NOT NULL,
    playtime INTEGER NOT NULL,
    unlocked INTEGER NOT NULL,
    PRIMARY KEY (date, appid)
  )`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

/** Columns added after the first release: [table, column, definition]. Added when missing. */
const ADDED_COLUMNS: [string, string, string][] = [
  ['games', 'owned', 'INTEGER NOT NULL DEFAULT 1'],
  ['games', 'pinned_open', 'INTEGER NOT NULL DEFAULT 0'],
  // NULL = stored before manual tags had their own column (see manualTags() in merge.ts).
  ['achievements', 'manual_tags', 'TEXT'],
  ['achievements', 'added_at', 'INTEGER NOT NULL DEFAULT 0'],
];

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
  private constructor(private db: Database) {}

  static async open(path = 'sqlite:achievement-hunter.db'): Promise<SqliteRepo> {
    const db = await Database.load(path);
    await db.execute('PRAGMA journal_mode = WAL');
    for (const sql of MIGRATIONS) await db.execute(sql);
    for (const [table, col, def] of ADDED_COLUMNS) {
      const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
      if (!cols.some((c) => c.name === col)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
    return new SqliteRepo(db);
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
