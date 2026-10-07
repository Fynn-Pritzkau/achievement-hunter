import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../src/lib/db/repo';
import { SyncEngine } from '../src/lib/sync/engine';
import { Scheduler } from '../src/lib/sync/scheduler';
import { FakeSteam } from './fakeSteam';

async function setup() {
  const steam = new FakeSteam();
  steam.add({ appid: 7, name: 'Live', playtime: 10, lastPlayed: 1, achievements: { a: [false, 0, 50] } });
  steam.add({ appid: 8, name: 'Other', playtime: 10, lastPlayed: 1, achievements: { a: [false, 0, 50] } });
  const engine = new SyncEngine({ api: steam.api(), repo: new MemoryRepo(), steamid: '1' });
  await engine.sync();

  let running: number[] = [];
  const changes: number[][] = [];
  const closed: { appid: number; startedAt: number; unlocks: number }[] = [];
  const s = new Scheduler({
    engine,
    intervalMs: 3_600_000,
    liveIntervalMs: 150_000,
    getRunningAppIds: async () => running,
    onRunningChange: (ids) => changes.push(ids),
    onClosed: (appid, startedAt, result) => closed.push({ appid, startedAt, unlocks: result.unlocks.length }),
  });
  steam.calls = [];
  return { steam, s, changes, closed, run: (ids: number[]) => (running = ids) };
}

describe('Scheduler live mode', () => {
  it('polls only the running game, and once more when it closes', async () => {
    const { steam, s, changes, run } = await setup();
    run([7]);
    await s.tick(0); // game started: no call yet
    await s.tick(15_000); // too early
    expect(steam.calls).toHaveLength(0);
    await s.tick(150_000); // live refresh
    expect(steam.calls).toHaveLength(1);
    run([]);
    await s.tick(165_000); // closed: final refresh
    expect(steam.calls).toHaveLength(2);
    expect(steam.calls.every((c) => c.includes('GetPlayerAchievements'))).toBe(true);
    expect(changes).toEqual([[7], []]);
  });

  it('tracks several games at once and refreshes each one that closes', async () => {
    const { steam, s, changes, run } = await setup();
    run([7, 8]);
    await s.tick(0);
    expect(steam.calls).toHaveLength(0);
    await s.tick(150_000); // one live refresh per running game
    expect(steam.calls).toHaveLength(2);
    expect(steam.calls.some((c) => c.includes('appid=7'))).toBe(true);
    expect(steam.calls.some((c) => c.includes('appid=8'))).toBe(true);

    steam.calls = [];
    run([8]);
    await s.tick(160_000); // 7 closed: exactly its final refresh
    expect(steam.calls).toHaveLength(1);
    expect(steam.calls[0]).toContain('appid=7');
    run([]);
    await s.tick(170_000);
    expect(steam.calls).toHaveLength(2);
    expect(steam.calls[1]).toContain('appid=8');
    expect(changes).toEqual([[7, 8], [8], []]);
  });

  it('gives a game that starts later its own live timer', async () => {
    const { steam, s, run } = await setup();
    run([7]);
    await s.tick(0);
    run([7, 8]);
    await s.tick(100_000); // 8 started
    await s.tick(150_000); // 7 is due, 8 not yet
    expect(steam.calls).toHaveLength(1);
    expect(steam.calls[0]).toContain('appid=7');
    await s.tick(250_000); // now 8
    expect(steam.calls).toHaveLength(2);
    expect(steam.calls[1]).toContain('appid=8');
  });

  it('reports each closed game once with its start time and final refresh, at no extra cost', async () => {
    const { steam, s, closed, run } = await setup();
    run([7]);
    await s.tick(1_000);
    await s.tick(150_000); // live refresh moves the timer, not the start
    steam.calls = [];
    run([]);
    await s.tick(170_000);
    await s.tick(185_000);
    expect(steam.calls).toHaveLength(1);
    expect(closed).toEqual([{ appid: 7, startedAt: 1_000, unlocks: 0 }]);
  });
});
