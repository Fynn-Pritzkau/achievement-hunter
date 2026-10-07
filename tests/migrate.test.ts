import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DbTooNewError, migrate, SCHEMA_VERSION, schemaVersion, type SqlDb } from '../src/lib/db/migrate';
import { KEEP_META } from '../src/lib/db/repo';
import { emptyGame, type Achievement } from '../src/lib/types';

// sqlite.ts imports the Tauri plugin, which only exists in the app.
vi.mock('@tauri-apps/plugin-sql', () => ({ default: {} }));
const { SqliteRepo } = await import('../src/lib/db/sqlite');

const open: DatabaseSync[] = [];
function sqlite(path: string) {
  const db = new DatabaseSync(path);
  open.push(db);
  return db;
}

/**
 * tauri-plugin-sql's interface over Node's built-in SQLite, so the real SQL runs in tests.
 * sqlx binds $1 by position; node:sqlite treats it as a name, so it becomes SQLite's ?1.
 */
function adapter(db: DatabaseSync): SqlDb {
  const q = (sql: string) => sql.replace(/\$(\d+)/g, '?$1');
  const args = (params: unknown[] = []) => params.map((p) => (typeof p === 'boolean' ? Number(p) : p)) as never[];
  return {
    async execute(sql, params) {
      db.prepare(q(sql)).run(...args(params));
    },
    async select<T>(sql: string, params?: unknown[]) {
      return db.prepare(q(sql)).all(...args(params)) as T;
    },
  };
}

const dirs: string[] = [];
function tempDir() {
  const d = mkdtempSync(join(tmpdir(), 'ah-migrate-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const db of open.splice(0)) if (db.isOpen) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A database as 0.9 left it: no version, without the columns added later. */
function legacyDb(path: string) {
  const db = sqlite(path);
  db.exec(`CREATE TABLE games (appid INTEGER PRIMARY KEY, name TEXT NOT NULL, playtime INTEGER NOT NULL DEFAULT 0,
    last_played INTEGER NOT NULL DEFAULT 0, icon_hash TEXT NOT NULL DEFAULT '', status TEXT, status_manual INTEGER NOT NULL DEFAULT 0,
    unlocked INTEGER NOT NULL DEFAULT 0, total INTEGER, schema_fetched_at INTEGER, player_fetched_at INTEGER, global_fetched_at INTEGER,
    was_perfect INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
    easy_open INTEGER NOT NULL DEFAULT 0, effort REAL NOT NULL DEFAULT 0, rarest_open REAL, rarity_score REAL NOT NULL DEFAULT 0,
    last_unlock INTEGER NOT NULL DEFAULT 0)`);
  db.exec(`CREATE TABLE achievements (appid INTEGER NOT NULL, apiname TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    hidden INTEGER NOT NULL DEFAULT 0, icon TEXT NOT NULL DEFAULT '', icongray TEXT NOT NULL DEFAULT '', achieved INTEGER NOT NULL DEFAULT 0,
    unlocktime INTEGER NOT NULL DEFAULT 0, percent REAL, pinned INTEGER NOT NULL DEFAULT 0, excluded INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (appid, apiname))`);
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.exec(`INSERT INTO games (appid, name, total, unlocked, status, status_manual) VALUES (10, 'Old Game', 2, 1, 'dropped', 1)`);
  db.exec(`INSERT INTO achievements (appid, apiname, name, note, tags, pinned) VALUES (10, 'a', 'A', 'my note', 'online,mine', 1), (10, 'b', 'B', '', '', 0)`);
  db.exec(`INSERT INTO meta VALUES ('steamid64', '76561198000000000'), ('settings', '{}'), ('lastSync', '1')`);
  return db;
}

const ach = (apiname: string, extra: Partial<Achievement> = {}): Achievement => ({
  apiname, name: apiname, description: '', hidden: false, icon: '', icongray: '', achieved: false, unlocktime: 0,
  percent: null, pinned: false, excluded: false, note: '', tags: [], ...extra,
});

describe('schema migrations', () => {
  it('creates a new database at the current version without a backup', async () => {
    const db = adapter(sqlite(':memory:'));
    const backup = vi.fn();
    expect(await migrate(db, backup)).toEqual({ from: 0, to: SCHEMA_VERSION });
    expect(await schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(backup).not.toHaveBeenCalled();
  });

  it('upgrades an unversioned 0.x database, keeps its data and copies it first', async () => {
    const dir = tempDir();
    const raw = legacyDb(join(dir, 'app.db'));
    const backupFile = join(dir, 'before.db');
    const repo = await SqliteRepo.from(adapter(raw), async (from) => {
      expect(from).toBe(0);
      return backupFile;
    });
    expect(repo.schemaVersion).toBe(SCHEMA_VERSION);
    // The copy is a complete, readable database with the old data.
    const copy = sqlite(backupFile);
    expect(copy.prepare('SELECT name FROM games').all()).toEqual([{ name: 'Old Game' }]);
    copy.close();

    expect(await repo.getGame(10)).toMatchObject({ name: 'Old Game', status: 'dropped', statusManual: true, owned: true, pinnedOpen: 0 });
    const list = await repo.getAchievements(10);
    expect(list[0]).toMatchObject({ note: 'my note', pinned: true, addedAt: 0 });
    expect(list[0].manualTags).toBeUndefined();
  });

  it('upgrades a 1.0 database: estimate numbers start unknown and round-trip after that', async () => {
    const dir = tempDir();
    const raw = sqlite(join(dir, 'app.db'));
    // The schema 1.0 shipped: today's minus the estimate columns, at version 1.
    await migrate(adapter(raw));
    for (const c of ['pace_done', 'pace_left', 'pace_top', 'skip_open']) raw.exec(`ALTER TABLE games DROP COLUMN ${c}`);
    raw.exec('PRAGMA user_version = 1');
    raw.exec(`INSERT INTO games (appid, name, total, unlocked) VALUES (10, 'Old Game', 2, 1)`);
    const backups: number[] = [];
    const v1 = await SqliteRepo.from(adapter(raw), async (from) => {
      backups.push(from);
      return join(dir, 'b1.db');
    });
    expect(backups).toEqual([1]);
    expect(v1.schemaVersion).toBe(SCHEMA_VERSION);
    const g = (await v1.getGame(10))!;
    expect(g).toMatchObject({ paceDone: null, paceLeft: 0, paceTop: 0, skipOpen: 0, name: 'Old Game' });
    await v1.saveGame({ ...g, paceDone: 3.5, paceLeft: 2.25, paceTop: 1.5, skipOpen: 1 });
    expect(await v1.getGame(10)).toMatchObject({ paceDone: 3.5, paceLeft: 2.25, paceTop: 1.5, skipOpen: 1 });
  });

  it('does nothing (and copies nothing) when the database is current', async () => {
    const db = adapter(sqlite(':memory:'));
    await migrate(db);
    const backup = vi.fn();
    expect(await migrate(db, backup)).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION });
    expect(backup).not.toHaveBeenCalled();
  });

  it('runs only the missing steps, each once', async () => {
    const db = adapter(sqlite(':memory:'));
    const ran: number[] = [];
    const steps = [async () => void ran.push(1), async () => void ran.push(2), async () => void ran.push(3)];
    await migrate(db, undefined, steps.slice(0, 2));
    await migrate(db, undefined, steps);
    expect(ran).toEqual([1, 2, 3]);
    expect(await schemaVersion(db)).toBe(3);
  });

  it('migrates nothing when the backup fails', async () => {
    const raw = legacyDb(':memory:');
    const db = adapter(raw);
    await expect(migrate(db, async () => Promise.reject(new Error('disk full')))).rejects.toThrow('disk full');
    expect(await schemaVersion(db)).toBe(0);
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('games') WHERE name = 'owned'`).get()).toEqual({ n: 0 });
  });

  it('refuses a database written by a newer version', async () => {
    const db = adapter(sqlite(':memory:'));
    await db.execute(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    await expect(migrate(db)).rejects.toBeInstanceOf(DbTooNewError);
  });
});

describe('SqliteRepo account data', () => {
  it('finds achievements with user data, including manual tags in old rows', async () => {
    const dir = tempDir();
    const repo = await SqliteRepo.from(adapter(legacyDb(join(dir, 'app.db'))), async () => join(dir, 'b.db'));
    await repo.saveGames([{ ...emptyGame(20, 'New'), total: 3 }]);
    await repo.saveAchievements(20, [ach('x'), ach('y', { excluded: true }), ach('z', { manualTags: ['later'], tags: ['later'] })]);
    const found = await repo.getAnnotatedAchievements();
    expect(found.map((a) => `${a.appid}:${a.apiname}`)).toEqual(['10:a', '20:y', '20:z']);
  });

  it('clearing removes the account but keeps app settings', async () => {
    const repo = await SqliteRepo.from(adapter(legacyDb(':memory:')));
    await repo.addSnapshots([{ date: '2026-10-01', appid: 10, playtime: 5, unlocked: 1 }]);
    await repo.setMeta('tourOffered', '1');
    await repo.clearAccountData();
    expect(await repo.getGames()).toEqual([]);
    expect(await repo.getAchievements(10)).toEqual([]);
    expect(await repo.getSnapshots('0000-00-00')).toEqual([]);
    expect(await repo.getMeta('steamid64')).toBeNull();
    expect(await repo.getMeta('lastSync')).toBeNull();
    for (const k of KEEP_META) expect(await repo.getMeta(k)).not.toBeNull();
  });

  it('a backup file that already exists counts as done', async () => {
    const dir = tempDir();
    const file = join(dir, 'before.db');
    const first = legacyDb(join(dir, 'one.db'));
    await adapter(first).execute('VACUUM INTO $1', [file]);
    expect(existsSync(file)).toBe(true);
    const repo = await SqliteRepo.from(adapter(first), async () => file);
    expect(repo.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
