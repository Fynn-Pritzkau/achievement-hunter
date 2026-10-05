import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../src/lib/db/repo';
import { SyncEngine } from '../src/lib/sync/engine';
import { Scheduler } from '../src/lib/sync/scheduler';
import { FakeSteam } from './fakeSteam';

describe('Scheduler live mode', () => {
  it('polls only the running game, and once more when it closes', async () => {
    const steam = new FakeSteam();
    steam.add({ appid: 7, name: 'Live', playtime: 10, lastPlayed: 1, achievements: { a: [false, 0, 50] } });
    steam.add({ appid: 8, name: 'Other', playtime: 10, lastPlayed: 1, achievements: { a: [false, 0, 50] } });
    const engine = new SyncEngine({ api: steam.api(), repo: new MemoryRepo(), steamid: '1' });
    await engine.sync();

    let running: number | null = null;
    const changes: (number | null)[] = [];
    const s = new Scheduler({
      engine,
      intervalMs: 3_600_000,
      liveIntervalMs: 150_000,
      getRunningAppId: async () => running,
      onRunningChange: (id) => changes.push(id),
    });
    steam.calls = [];

    running = 7;
    await s.tick(0); // game started: no call yet
    await s.tick(15_000); // too early
    expect(steam.calls).toHaveLength(0);
    await s.tick(150_000); // live refresh
    expect(steam.calls).toHaveLength(1);
    running = null;
    await s.tick(165_000); // closed: final refresh
    expect(steam.calls).toHaveLength(2);
    expect(steam.calls.every((c) => c.includes('GetPlayerAchievements'))).toBe(true);
    expect(changes).toEqual([7, null]);
  });
});
