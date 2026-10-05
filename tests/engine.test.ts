import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../src/lib/db/repo';
import { SyncEngine } from '../src/lib/sync/engine';
import { FakeSteam } from './fakeSteam';

const NOW = Date.UTC(2026, 9, 5, 12);
const RECENT = Math.floor(NOW / 1000) - 3600;

function setup() {
  const steam = new FakeSteam();
  const repo = new MemoryRepo();
  let now = NOW;
  const engine = new SyncEngine({ api: steam.api(), repo, steamid: '76561198000000000', now: () => now });
  return { steam, repo, engine, advance: (ms: number) => (now += ms) };
}

describe('SyncEngine', () => {
  it('imports played games with achievements and rarity', async () => {
    const { steam, repo, engine } = setup();
    steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [true, 100, 80], b: [false, 0, 30], c: [false, 0, 2] } });
    steam.add({ appid: 2, name: 'NoAch', playtime: 50, lastPlayed: RECENT, achievements: {} });

    const res = await engine.sync();
    expect(res.errors).toEqual([]);
    const alpha = await repo.getGame(1);
    expect(alpha).toMatchObject({ unlocked: 1, total: 3, easyOpen: 0, rarestOpen: 2, status: 'playing' });
    expect((await repo.getGame(2))?.total).toBe(0);
    const list = await repo.getAchievements(1);
    expect(list.find((a) => a.apiname === 'c')?.percent).toBe(2);
    // No toasts for history on the first import.
    expect(res.unlocks).toEqual([]);
  });

  it('second sync without playing costs exactly one API call', async () => {
    const { steam, engine } = setup();
    steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [true, 100, 80], b: [false, 0, 30] } });
    steam.add({ appid: 2, name: 'NoAch', playtime: 50, lastPlayed: RECENT, achievements: {} });
    await engine.sync();
    steam.calls = [];
    await engine.sync();
    expect(steam.calls).toHaveLength(1);
    expect(steam.count('GetOwnedGames')).toBe(1);
  });

  it('a played game costs one player call and reports new unlocks', async () => {
    const { steam, repo, engine } = setup();
    const g = steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [true, 100, 80], b: [false, 0, 30] } });
    await engine.sync();
    steam.calls = [];
    g.playtime = 180;
    g.achievements.b = [true, 200, 30];
    const res = await engine.sync();
    expect(steam.count('GetPlayerAchievements')).toBe(1);
    expect(steam.count('GetSchemaForGame')).toBe(0);
    expect(res.unlocks.map((u) => u.achievement.apiname)).toEqual(['b']);
    expect(await repo.getGame(1)).toMatchObject({ unlocked: 2, status: 'completed', wasPerfect: true });
  });

  it('a failing schema never turns a game into "no achievements"', async () => {
    const { steam, repo, engine } = setup();
    steam.add({ appid: 1, name: 'Flaky', playtime: 10, lastPlayed: RECENT, achievements: { a: [false, 0, 50] }, schemaFails: true });
    const res = await engine.sync();
    expect(res.errors).toHaveLength(1);
    expect((await repo.getGame(1))?.total ?? null).toBeNull();

    // Next run retries and succeeds.
    steam.games.get(1)!.schemaFails = false;
    await engine.sync();
    expect((await repo.getGame(1))?.total).toBe(1);
  });

  it('keeps old data when a refresh fails', async () => {
    const { steam, repo, engine } = setup();
    const g = steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [true, 100, 80], b: [false, 0, 30] } });
    await engine.sync();
    g.playtime = 200;
    steam.rateLimitNext = 1; // GetOwnedGames succeeds after one retry …
    await engine.sync();
    g.playtime = 300;
    steam.rateLimitNext = 0;
    // … now make every player call fail hard
    const orig = steam.fetch;
    steam.fetch = async (url: string) => (url.includes('GetPlayerAchievements') ? new Response('x', { status: 500 }) : orig(url));
    const engine2 = new SyncEngine({ api: steam.api(), repo, steamid: '1', now: () => NOW });
    const res = await engine2.sync();
    expect(res.errors).toHaveLength(1);
    const stored = await repo.getGame(1);
    expect(stored).toMatchObject({ total: 2, unlocked: 1, playtime: 200 }); // playtime not advanced → retried next time
  });

  it('detects achievements added by an update and refetches the schema', async () => {
    const { steam, repo, engine } = setup();
    const g = steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [true, 100, 80] } });
    await engine.sync();
    expect((await repo.getGame(1))?.status).toBe('completed');
    g.playtime = 130;
    g.achievements.dlc = [false, 0, 5];
    await engine.sync();
    expect(steam.count('GetSchemaForGame')).toBe(2);
    expect(await repo.getGame(1)).toMatchObject({ total: 2, unlocked: 1, wasPerfect: true, status: 'playing' });
  });

  it('stops on a private profile', async () => {
    const { steam, engine } = setup();
    steam.add({ appid: 1, name: 'A', playtime: 1, lastPlayed: RECENT, achievements: { a: [false, 0, 1] } });
    steam.privateProfile = true;
    await expect(engine.sync()).rejects.toMatchObject({ kind: 'private' });
  });

  it('keeps user pins, notes and exclusions across schema refreshes', async () => {
    const { steam, repo, engine } = setup();
    steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [false, 0, 80], b: [false, 0, 0] } });
    await engine.sync();
    const list = await repo.getAchievements(1);
    list[0].pinned = true;
    list[0].note = 'Kapitel 3';
    list[1].excluded = true;
    await repo.saveAchievements(1, list);
    await engine.sync({ force: true });
    const after = await repo.getAchievements(1);
    expect(after[0]).toMatchObject({ pinned: true, note: 'Kapitel 3' });
    expect(after[1].excluded).toBe(true);
    expect((await repo.getGame(1))?.total).toBe(1); // excluded one doesn't count
  });

  it('live sync of one game uses a single call', async () => {
    const { steam, engine } = setup();
    const g = steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [false, 0, 80] } });
    await engine.sync();
    steam.calls = [];
    g.achievements.a = [true, 999, 80];
    const res = await engine.syncGame(1);
    expect(steam.calls).toHaveLength(1);
    expect(res.unlocks).toHaveLength(1);
  });

  it('unplayed games are backfilled slowly, without player calls', async () => {
    const { steam, repo, engine } = setup();
    for (let i = 1; i <= 30; i++) steam.add({ appid: i, name: `U${i}`, playtime: 0, lastPlayed: 0, achievements: { a: [false, 0, 10] } });
    await engine.sync();
    expect(steam.count('GetSchemaForGame')).toBe(15);
    expect(steam.count('GetPlayerAchievements')).toBe(0);
    await engine.sync();
    expect(steam.count('GetSchemaForGame')).toBe(30);
    steam.calls = [];
    await engine.sync();
    expect(steam.calls).toHaveLength(1);
    expect((await repo.getGame(1))?.status).toBeNull();
  });
});
