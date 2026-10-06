import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../src/lib/db/repo';
import { totals } from '../src/lib/lists';
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

  it('tracks played games missing from GetOwnedGames, like the profile average on Steam', async () => {
    const { steam, local, repo, engine } = setup();
    steam.add({ appid: 1, name: 'Owned', playtime: 120, lastPlayed: RECENT, achievements: { a: [true, 100, 80], b: [true, 100, 30] } });
    steam.add({ appid: 2, name: 'Shared', playtime: 0, lastPlayed: 0, notOwned: true, achievements: { a: [true, 100, 80], b: [false, 0, 30], c: [false, 0, 10], d: [false, 0, 5] } });
    local.set(1, { schemaMtime: RECENT, statsMtime: RECENT + 60, achievements: { a: [true, 100], b: [true, 100] } });
    local.set(2, { name: 'Shared', schemaMtime: RECENT, statsMtime: RECENT, achievements: { a: [true, 100], b: [false, 0], c: [false, 0], d: [false, 0] } });
    // Played on a free weekend, nothing unlocked: Steam doesn't count it, neither do we.
    local.set(3, { name: 'Tried', schemaMtime: RECENT, statsMtime: RECENT, achievements: { a: [false, 0] } });

    await engine.sync();
    // Found on disk; only rarity costs a call, as for an owned game.
    expect(steam.count()).toBe(3); // GetOwnedGames + 2 × rarity
    expect(await repo.getGame(2)).toMatchObject({ name: 'Shared', owned: false, unlocked: 1, total: 4 });
    expect(await repo.getGame(1)).toMatchObject({ owned: true });
    expect(await repo.getGame(3)).toBeNull();
    expect(totals(await repo.getGames()).avgCompletion).toBe(62.5);

    // Nothing changed: no calls beyond GetOwnedGames, and the file without unlocks isn't read again.
    steam.calls = [];
    local.reads = 0;
    await engine.sync();
    expect(steam.count()).toBe(1);
    expect(local.reads).toBe(0);
    expect(await repo.getGame(2)).toMatchObject({ owned: false, unlocked: 1 });
  });

  it('a game first seen without unlocks is picked up once Steam rewrites its stats', async () => {
    const { steam, local, repo, engine, advance } = setup();
    const g = local.set(3, { name: 'Tried', schemaMtime: RECENT, statsMtime: RECENT, achievements: { a: [false, 0] } });
    steam.add({ appid: 3, name: 'Tried', playtime: 0, lastPlayed: 0, notOwned: true, achievements: { a: [false, 0, 50] } });
    await engine.sync();
    expect(await repo.getGame(3)).toBeNull();

    advance(60_000);
    g.achievements.a = [true, SEC + 30];
    g.statsMtime = SEC + 30;
    await engine.sync();
    expect(await repo.getGame(3)).toMatchObject({ owned: false, unlocked: 1, total: 1 });
  });

  it('a game bought after playing it shared becomes owned', async () => {
    const { steam, local, repo, engine } = setup();
    const s = steam.add({ appid: 2, name: 'Shared', playtime: 0, lastPlayed: 0, notOwned: true, achievements: { a: [true, 100, 80] } });
    local.set(2, { name: 'Shared', schemaMtime: RECENT, statsMtime: RECENT, achievements: { a: [true, 100] } });
    await engine.sync();
    expect(await repo.getGame(2)).toMatchObject({ owned: false });
    s.notOwned = false;
    s.playtime = 30;
    await engine.sync();
    expect(await repo.getGame(2)).toMatchObject({ owned: true, playtime: 30 });
  });

  it('fills hidden descriptions of games stored without them from the cache, once and for free', async () => {
    const { steam, local, repo, engine } = setup();
    steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { a: [false, 0, 80], secret: [false, 0, 17] }, hidden: ['secret'], descriptionsFail: true });
    // Synced by an old version: no cache, no hidden description.
    await new SyncEngine({ api: steam.api(), repo, steamid: '76561198000000000', now: () => NOW }).sync();
    expect((await repo.getAchievements(1)).find((a) => a.apiname === 'secret')?.description).toBe('');
    local.set(1, { schemaMtime: RECENT - 86400, statsMtime: null, achievements: { a: [false, 0], secret: [false, 0] } });
    steam.calls = [];

    expect(await engine.backfillHiddenDescriptions()).toBe(1);
    expect(steam.count()).toBe(0);
    expect((await repo.getAchievements(1)).find((a) => a.apiname === 'secret')?.description).toBe('Do secret');
    // Done once: later starts don't read every game again.
    local.reads = 0;
    expect(await engine.backfillHiddenDescriptions()).toBe(0);
    expect(local.reads).toBe(0);
  });

  it('filling hidden descriptions waits for a running sync before it writes', async () => {
    const { steam, local, repo, engine } = setup();
    steam.add({ appid: 1, name: 'Alpha', playtime: 120, lastPlayed: RECENT, achievements: { secret: [false, 0, 17] }, hidden: ['secret'], descriptionsFail: true });
    await new SyncEngine({ api: steam.api(), repo, steamid: '76561198000000000', now: () => NOW }).sync();
    local.set(1, { schemaMtime: RECENT - 86400, statsMtime: null, achievements: { secret: [false, 0] } });

    const [, filled] = await Promise.all([engine.sync({ force: true }), engine.fillHiddenDescriptions(1, { useApi: false })]);
    expect(filled).toBe(true);
    // The forced sync saved its own list; the description went on top and wasn't lost.
    expect((await repo.getAchievements(1))[0].description).toBe('Do secret');
  });

  it('converts IDs and icon names', () => {
    expect(accountIdOf('76561198000000001')).toBe(39734273);
    expect(iconUrl(5, 'x.jpg')).toBe('https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/5/x.jpg');
    expect(iconUrl(5, '')).toBe('');
  });
});
