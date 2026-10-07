import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRepo } from '../src/lib/db/repo';
import { SyncEngine } from '../src/lib/sync/engine';
import { MockWorld } from '../src/dev/world';
import type { Achievement, Game } from '../src/lib/types';

// The mock mode's world against the real engine: realistic flows and what they cost.
function setup(scenario: 'library' | 'nolocal' = 'library') {
  const world = new MockWorld(scenario);
  world.steam.latencyMs = 0;
  const repo = new MemoryRepo();
  const added: [Game, Achievement[]][] = [];
  const engine = new SyncEngine({
    api: world.steam.api(),
    repo,
    local: world.local,
    steamid: world.steam.steamid,
    onAchievementsAdded: (g, a) => added.push([g, a]),
  });
  return { world, repo, engine, added };
}

const HADES = 1145360;
const GOD_OF_WAR = 1593500; // family shared: not in GetOwnedGames, "not public" for the API

describe('mock world', () => {
  // File times have 1 s resolution: actions happen a minute after the sync, as in real use.
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 5, 12) }));
  afterEach(() => vi.useRealTimers());
  const later = () => vi.setSystemTime(Date.now() + 60_000);

  it('imports the whole fixture library without errors, shared games from the cache', async () => {
    const { world, repo, engine } = setup();
    const res = await engine.sync();
    expect(res.errors).toEqual([]);
    const games = await repo.getGames();
    expect(games.length).toBe(world.fixtures.length);
    expect(games.find((g) => g.appid === GOD_OF_WAR)).toMatchObject({ owned: false, unlocked: 22 });
    // Played games come from the cache; only the library, rarity and never-played schemas cost calls.
    expect(world.steam.count('GetPlayerAchievements')).toBe(0);
    expect(world.steam.count('GetOwnedGames')).toBe(1);
  });

  it('a second sync without playing costs exactly one call', async () => {
    const { world, engine } = setup();
    await engine.sync();
    world.steam.calls = [];
    await engine.sync();
    expect(world.steam.calls).toEqual(['/IPlayerService/GetOwnedGames/v0001/']);
  });

  it('played on another PC: one achievement call for that game', async () => {
    const { world, repo, engine } = setup();
    await engine.sync();
    const before = (await repo.getGame(HADES))!.unlocked;
    later();
    world.playElsewhere(HADES);
    world.steam.calls = [];
    await engine.sync();
    expect(world.steam.count('GetPlayerAchievements')).toBe(1);
    expect(world.steam.count()).toBe(2);
    expect((await repo.getGame(HADES))!.unlocked).toBe(before + 1);
  });

  it('unlocks, stat counters and game updates arrive through the free local pass', async () => {
    const { world, repo, engine, added } = setup();
    await engine.sync();
    await engine.syncLocal(); // first pass sets the baseline
    const before = (await repo.getGame(HADES))!;
    world.steam.calls = [];
    later();

    world.unlock(HADES);
    world.gameUpdate(HADES, 3);
    // Fill a stat counter: unlocks its achievement.
    while (world.bump(HADES, 'ACH_044', 'step') && !world.game(HADES)!.achievements.ACH_044[0]);
    await engine.syncLocal();

    const after = (await repo.getGame(HADES))!;
    expect(after.unlocked).toBe(before.unlocked + 2);
    expect(after.total).toBe(before.total! + 3);
    expect(added.map(([g, a]) => [g.appid, a.length])).toEqual([[HADES, 3]]);
    // Only rarity of the new schema may cost something; progress itself is free.
    expect(world.steam.count('GetPlayerAchievements')).toBe(0);
  });

  it('without Steam installed everything comes from the API, the shared game stays out', async () => {
    const { world, repo, engine } = setup('nolocal');
    const res = await engine.sync();
    expect(res.errors).toEqual([]);
    expect(await repo.getGame(GOD_OF_WAR)).toBeNull();
    expect(world.steam.count('GetPlayerAchievements')).toBeGreaterThan(20);
  });

  it('is deterministic', () => {
    const a = new MockWorld('library').fixtures.map((f) => f.achievements.map((x) => x.meta.name).join());
    const b = new MockWorld('library').fixtures.map((f) => f.achievements.map((x) => x.meta.name).join());
    expect(a).toEqual(b);
  });
});
