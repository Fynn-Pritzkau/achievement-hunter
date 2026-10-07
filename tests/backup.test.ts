import { describe, expect, it } from 'vitest';
import { applyPendingRestore, BackupError, createBackup, parseBackup, restoreBackup } from '../src/lib/backup';
import { MemoryRepo } from '../src/lib/db/repo';
import { emptyGame, type Achievement, type Game } from '../src/lib/types';

const ach = (apiname: string, extra: Partial<Achievement> = {}): Achievement => ({
  apiname, name: apiname, description: '', hidden: false, icon: '', icongray: '', achieved: false, unlocktime: 0,
  percent: 50, pinned: false, excluded: false, note: '', tags: [], ...extra,
});

const game = (appid: number, extra: Partial<Game> = {}): Game => ({ ...emptyGame(appid, `Game ${appid}`), total: 3, ...extra });

/** A library with user data on game 1, a plain game 2 and a hidden game 3. */
async function library() {
  const repo = new MemoryRepo();
  await repo.saveGames([game(1, { status: 'dropped', statusManual: true, pinned: true }), game(2), game(3, { hidden: true })]);
  await repo.saveAchievements(1, [
    ach('a', { pinned: true, note: 'after chapter 3' }),
    // "online" is an auto tag for this name, "boss" is the user's.
    ach('Online match', { tags: ['online', 'boss'], manualTags: ['boss'] }),
    ach('c', { excluded: true }),
  ]);
  await repo.saveAchievements(2, [ach('x'), ach('y')]);
  await repo.addSnapshots([{ date: '2026-10-01', appid: 1, playtime: 60, unlocked: 1 }]);
  await repo.setMeta('settings', JSON.stringify({ uiLanguage: 'en' }));
  await repo.setMeta('appAchievements', JSON.stringify({ firstPerfect: 1000 }));
  await repo.setMeta('steamid64', '76561198000000000');
  return repo;
}

/** The same library freshly synced on a new PC: Steam data only. */
async function fresh() {
  const repo = new MemoryRepo();
  await repo.saveGames([game(1), game(2), game(3)]);
  await repo.saveAchievements(1, [ach('a'), ach('Online match', { tags: ['online'], manualTags: [] }), ach('c')]);
  await repo.saveAchievements(2, [ach('x'), ach('y')]);
  return repo;
}

describe('backup', () => {
  it('holds only what the user made, not Steam data', async () => {
    const b = await createBackup(await library(), '1.0.0', Date.UTC(2026, 9, 7));
    expect(b).toMatchObject({ app: 'achievement-hunter', format: 1, appVersion: '1.0.0', createdAt: '2026-10-07T00:00:00.000Z' });
    expect(b.games).toEqual([
      {
        appid: 1, name: 'Game 1', status: 'dropped', pinned: true,
        achievements: [
          { apiname: 'a', pinned: true, note: 'after chapter 3' },
          { apiname: 'Online match', tags: ['boss'] },
          { apiname: 'c', excluded: true },
        ],
      },
      { appid: 3, name: 'Game 3', hidden: true },
    ]);
    expect(b.snapshots).toHaveLength(1);
    expect(b.appAchievements).toEqual({ firstPerfect: 1000 });
  });

  it('restores into a fresh library and recomputes the aggregates', async () => {
    const backup = parseBackup(JSON.stringify(await createBackup(await library(), '1.0.0')));
    const repo = await fresh();
    const res = await restoreBackup(repo, backup);
    expect(res).toMatchObject({ pending: 0, snapshots: 1 });
    expect(res.games.map((g) => g.appid)).toEqual([1, 3]);

    expect(await repo.getGame(1)).toMatchObject({ status: 'dropped', statusManual: true, pinned: true, pinnedOpen: 1 });
    expect((await repo.getGame(3))?.hidden).toBe(true);
    const list = await repo.getAchievements(1);
    expect(list[0]).toMatchObject({ pinned: true, note: 'after chapter 3' });
    expect(list[1]).toMatchObject({ tags: ['online', 'boss'], manualTags: ['boss'] });
    expect(list[2].excluded).toBe(true);
    // Excluding "c" leaves 2 achievements that count.
    expect((await repo.getGame(1))?.total).toBe(2);
  });

  it('only adds: current notes, pins and status stay', async () => {
    const backup = await createBackup(await library(), '1.0.0');
    const repo = await fresh();
    await repo.saveGame(game(1, { status: 'playing', statusManual: true }));
    await repo.saveAchievements(1, [ach('a', { note: 'newer note' }), ach('Online match', { pinned: true }), ach('c')]);
    await restoreBackup(repo, backup);
    const list = await repo.getAchievements(1);
    expect(list[0]).toMatchObject({ note: 'newer note', pinned: true });
    expect(list[1].pinned).toBe(true);
    // A status the backup has wins: it's the user's own choice either way.
    expect((await repo.getGame(1))?.status).toBe('dropped');
  });

  it('keeps games that are not synced yet and applies them later', async () => {
    const backup = await createBackup(await library(), '1.0.0');
    const repo = new MemoryRepo();
    // The first sync hasn't loaded game 1's achievements yet.
    await repo.saveGames([{ ...emptyGame(1, 'Game 1'), total: null }]);
    const res = await restoreBackup(repo, backup);
    expect(res).toMatchObject({ games: [], pending: 2 });

    // A backup taken now still contains them.
    expect((await createBackup(repo, '1.0.0')).games.map((g) => g.appid)).toEqual([1, 3]);

    await repo.saveGames([game(1), game(3)]);
    await repo.saveAchievements(1, [ach('a'), ach('Online match'), ach('c')]);
    const applied = await applyPendingRestore(repo);
    expect(applied.map((g) => g.appid)).toEqual([1, 3]);
    expect((await repo.getAchievements(1))[0].note).toBe('after chapter 3');
    expect(await applyPendingRestore(repo)).toEqual([]);
  });

  it('does not duplicate snapshots on a second restore', async () => {
    const backup = await createBackup(await library(), '1.0.0');
    const repo = await fresh();
    await restoreBackup(repo, backup);
    expect((await restoreBackup(repo, backup)).snapshots).toBe(0);
    expect(await repo.getSnapshots('0000-00-00')).toHaveLength(1);
  });

  it('rejects files that are not a backup, and newer formats', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup('{"games": []}')).toThrow(BackupError);
    try {
      parseBackup(JSON.stringify({ app: 'achievement-hunter', format: 99, games: [] }));
      expect.unreachable();
    } catch (e) {
      expect((e as BackupError).kind).toBe('newer');
    }
  });

  it('drops broken entries instead of trusting them', () => {
    const b = parseBackup(
      JSON.stringify({
        app: 'achievement-hunter',
        format: 1,
        games: [
          { appid: 'x' },
          { appid: 5, status: 'bogus', hidden: 'yes', achievements: [{ apiname: 'a', pinned: 1, tags: ['t', 3] }, { nope: true }] },
        ],
        snapshots: [{ date: '2026-10-01', appid: 5, playtime: 1, unlocked: 0 }, { date: 'yesterday' }],
        appAchievements: { a: 1, b: 'x' },
      }),
    );
    expect(b.games).toEqual([{ appid: 5, name: '5', achievements: [{ apiname: 'a', tags: ['t'] }] }]);
    expect(b.snapshots).toHaveLength(1);
    expect(b.appAchievements).toEqual({ a: 1 });
  });
});
