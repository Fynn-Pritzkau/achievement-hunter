import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../src/lib/db/repo';
import { accountIdOf, iconUrl } from '../src/lib/steam/local';
import { SyncEngine } from '../src/lib/sync/engine';
import { Scheduler } from '../src/lib/sync/scheduler';
import { FakeLocal } from './fakeLocal';
import { FakeSteam } from './fakeSteam';

const NOW = Date.UTC(2026, 9, 5, 12);
const SEC = Math.floor(NOW / 1000);
const RECENT = SEC - 3600;

function setup() {
  const steam = new FakeSteam();
  const local = new FakeLocal();
  const repo = new MemoryRepo();
  let now = NOW;
  const engine = new SyncEngine({ api: steam.api(), repo, local, steamid: '76561198000000000', now: () => now });
  return { steam, local, repo, engine, advance: (ms: number) => (now += ms) };
}

describe('Steam local cache', () => {
  it('imports schema and progress from disk; only the owned list and rarity come from the API', async () => {
    const { steam, local, repo, engine } = setup();
    steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [true, 100, 80], b: [false, 0, 30] } });
    local.set(1, { schemaMtime: RECENT, statsMtime: RECENT + 60, achievements: { a: [true, 100], b: [false, 0] } });

    await engine.sync();
    expect(steam.count('GetSchemaForGame')).toBe(0);
    expect(steam.count('GetPlayerAchievements')).toBe(0);
    expect(steam.count('GetOwnedGames')).toBe(1);
    expect(steam.count('GetGlobalAchievementPercentagesForApp')).toBe(1);
    expect(await repo.getGame(1)).toMatchObject({ unlocked: 1, total: 2 });
  });

  it('never stores stat progress; it is read from disk when shown', async () => {
    const { steam, local, repo, engine } = setup();
    steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [false, 0, 80] } });
    local.set(1, { schemaMtime: RECENT, statsMtime: RECENT + 60, achievements: { a: [false, 0] }, progress: { a: [37, 50] } });

    await engine.sync();
    expect(steam.count()).toBe(2); // GetOwnedGames + rarity, as without progress
    const [a] = await repo.getAchievements(1);
    expect(a.apiname).toBe('a');
    expect('progress' in a).toBe(false);
  });

  it('a local pass picks up a new unlock without any API call', async () => {
    const { steam, local, engine, advance } = setup();
    steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [false, 0, 80] } });
    const g = local.set(1, { schemaMtime: RECENT, statsMtime: RECENT + 60, achievements: { a: [false, 0] } });
    await engine.sync();
    await engine.syncLocal(); // first pass only sets the baseline
    steam.calls = [];

    advance(30_000);
    g.achievements.a = [true, SEC + 20];
    g.statsMtime = SEC + 20;
    const res = await engine.syncLocal();
    expect(steam.calls).toHaveLength(0);
    expect(res.unlocks.map((u) => u.achievement.apiname)).toEqual(['a']);

    // Nothing changed on disk: nothing is read again.
    advance(15_000);
    local.reads = 0;
    await engine.syncLocal();
    await engine.syncLocal();
    expect(local.reads).toBeLessThanOrEqual(1); // the 1 s overlap may re-read once
  });

  it('never relocks and keeps the server unlock time', async () => {
    const { steam, local, repo, engine } = setup();
    steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [true, 100, 80], b: [true, 200, 30] } });
    await engine.sync({ force: true }); // from the API
    local.set(1, { schemaMtime: RECENT, statsMtime: SEC, achievements: { a: [true, 130], b: [false, 0] } });
    await engine.syncGame(1);
    const list = await repo.getAchievements(1);
    expect(list.map((a) => [a.apiname, a.achieved, a.unlocktime])).toEqual([
      ['a', true, 100],
      ['b', true, 200],
    ]);
  });

  it('asks the API when the game was played since Steam wrote the file (other PC, Steam Deck)', async () => {
    const { steam, local, engine } = setup();
    const g = steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [false, 0, 80] } });
    local.set(1, { schemaMtime: RECENT, statsMtime: RECENT + 60, achievements: { a: [false, 0] } });
    await engine.sync();
    steam.calls = [];
    g.playtime = 180;
    g.lastPlayed = RECENT + 600;
    g.achievements.a = [true, RECENT + 900, 80];
    const res = await engine.sync();
    expect(steam.count('GetPlayerAchievements')).toBe(1);
    expect(res.unlocks).toHaveLength(1);
  });

  it('takes the schema from the API when the cache is in another language', async () => {
    const { steam, local, engine } = setup();
    steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [false, 0, 80] } });
    local.set(1, { schemaMtime: RECENT, statsMtime: RECENT + 60, languageMatch: false, achievements: { a: [false, 0] } });
    await engine.sync();
    expect(steam.count('GetSchemaForGame')).toBe(1);
    expect(steam.count('GetPlayerAchievements')).toBe(0);
  });

  it('a forced sync ignores the cache', async () => {
    const { steam, local, engine } = setup();
    steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [false, 0, 80] } });
    local.set(1, { schemaMtime: RECENT, statsMtime: RECENT + 60, achievements: { a: [false, 0] } });
    await engine.sync({ force: true });
    expect(local.reads).toBe(0);
    expect(steam.count('GetPlayerAchievements')).toBe(1);
  });

  it('uses the higher playtime of API and disk', async () => {
    const { steam, local, repo, engine } = setup();
    steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: {} });
    local.times.set(1, { appid: 1, playtime: 150, lastPlayed: RECENT + 5 });
    await engine.sync();
    expect(await repo.getGame(1)).toMatchObject({ playtime: 150, lastPlayed: RECENT + 5 });
  });

  it('live mode makes no API calls while the game runs', async () => {
    const { steam, local, engine } = setup();
    steam.add({ appid: 7, name: 'Live', playtime: 10, lastPlayed: RECENT, achievements: { a: [false, 0, 50] } });
    const g = local.set(7, { schemaMtime: RECENT, statsMtime: RECENT + 60, achievements: { a: [false, 0] } });
    await engine.sync();
    let running: number[] = [];
    const s = new Scheduler({ engine, intervalMs: 3_600_000, getRunningAppIds: async () => running });
    steam.calls = [];

    running = [7];
    await s.tick(0);
    for (let t = 15_000; t <= 600_000; t += 15_000) await s.tick(t);
    g.achievements.a = [true, SEC + 1];
    g.statsMtime = SEC + 1;
    await s.tick(615_000);
    running = [];
    await s.tick(630_000);
    expect(steam.calls).toHaveLength(0);
  });

  it('converts IDs and icon names', () => {
    expect(accountIdOf('76561198000000001')).toBe(39734273);
    expect(iconUrl(5, 'x.jpg')).toBe('https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/5/x.jpg');
    expect(iconUrl(5, '')).toBe('');
  });
});
