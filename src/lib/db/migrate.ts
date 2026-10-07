/**
 * Versioned schema migrations. The version lives in SQLite's `PRAGMA user_version`.
 *
 * Rules for new migrations:
 * - Only append to MIGRATIONS, never change or reorder a released step.
 * - Each step must be safe to run twice (the plugin's connection pool can't hold a transaction
 *   across calls, so a crash between a step and its version bump re-runs the step).
 * - Before an existing database is upgraded, `backup` gets a chance to copy it.
 */

/** The part of tauri-plugin-sql's Database the migrations use (also met by a test adapter). */
export interface SqlDb {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}

type Migration = (db: SqlDb) => Promise<void>;

async function addColumn(db: SqlDb, table: string, col: string, def: string) {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === col)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

const MIGRATIONS: Migration[] = [
  // 1: the schema of 0.10 (before versioning). Older databases get their missing columns here.
  async (db) => {
    await db.execute(`CREATE TABLE IF NOT EXISTS games (
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
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS achievements (
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
    )`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_ach_unlock ON achievements(unlocktime) WHERE achieved = 1`);
    await db.execute(`CREATE TABLE IF NOT EXISTS snapshots (
      date TEXT NOT NULL,
      appid INTEGER NOT NULL,
      playtime INTEGER NOT NULL,
      unlocked INTEGER NOT NULL,
      PRIMARY KEY (date, appid)
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    await addColumn(db, 'games', 'owned', 'INTEGER NOT NULL DEFAULT 1');
    await addColumn(db, 'games', 'pinned_open', 'INTEGER NOT NULL DEFAULT 0');
    // NULL = stored before manual tags had their own column (see manualTags() in merge.ts).
    await addColumn(db, 'achievements', 'manual_tags', 'TEXT');
    await addColumn(db, 'achievements', 'added_at', 'INTEGER NOT NULL DEFAULT 0');
  },
  // 2: aggregates for the "to 100 %" estimate. pace_done NULL = not computed yet; the engine
  // fills it from the stored achievements on the next start (SyncEngine.backfillPace).
  async (db) => {
    await addColumn(db, 'games', 'pace_done', 'REAL');
    await addColumn(db, 'games', 'pace_left', 'REAL NOT NULL DEFAULT 0');
    await addColumn(db, 'games', 'pace_top', 'REAL NOT NULL DEFAULT 0');
    await addColumn(db, 'games', 'skip_open', 'INTEGER NOT NULL DEFAULT 0');
  },
];

/** The schema version this build writes. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/** The database was written by a newer version of the app; opening it could lose data. */
export class DbTooNewError extends Error {
  constructor(public version: number) {
    super(`Database schema v${version} is newer than this app (v${SCHEMA_VERSION})`);
    this.name = 'DbTooNewError';
  }
}

export async function schemaVersion(db: SqlDb): Promise<number> {
  const rows = await db.select<{ user_version: number }[]>('PRAGMA user_version');
  return Number(rows[0]?.user_version ?? 0);
}

/**
 * Brings the database to SCHEMA_VERSION. `backup(from)` runs once before an existing database
 * (one with data) is changed; if it throws, nothing is migrated.
 * Returns the version found and the version now.
 */
export async function migrate(
  db: SqlDb,
  backup?: (from: number) => Promise<void>,
  migrations: Migration[] = MIGRATIONS,
): Promise<{ from: number; to: number }> {
  const target = migrations.length;
  const from = await schemaVersion(db);
  if (from > target) throw new DbTooNewError(from);
  if (from === target) return { from, to: from };
  const tables = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'games'`);
  if (backup && Number(tables[0]?.n) > 0) await backup(from);
  for (let v = from; v < target; v++) {
    await migrations[v](db);
    // PRAGMA takes no bound parameters; v is our own integer.
    await db.execute(`PRAGMA user_version = ${v + 1}`);
  }
  return { from, to: target };
}
