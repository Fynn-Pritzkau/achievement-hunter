import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../src/lib/db/repo';
import { backtest, estimateLeft, fmtRange, paceAggregate, paceWeight } from '../src/lib/estimate';
import { aggregate } from '../src/lib/sync/merge';
import { emptyGame, type Achievement } from '../src/lib/types';

const ach = (apiname: string, patch: Partial<Achievement> = {}): Achievement => ({
  apiname,
  name: apiname,
  description: '',
  hidden: false,
  icon: '',
  icongray: '',
  achieved: false,
  unlocktime: 0,
  percent: null,
  pinned: false,
  excluded: false,
  note: '',
  tags: [],
  ...patch,
});
const game = (patch: Partial<ReturnType<typeof emptyGame>>) => ({ ...emptyGame(1, 'G'), ...patch });

describe('paceWeight', () => {
  it('grows with the log of the rarity relative to the most common achievement', () => {
    expect(paceWeight(60, 60)).toBe(1);
    expect(paceWeight(6, 60)).toBeCloseTo(1 + Math.log(10));
    // Only relative rarity counts: a game few owners start isn't harder for those who do.
    expect(paceWeight(3, 30)).toBeCloseTo(paceWeight(6, 60));
  });
  it('caps ultra-rare achievements and gives unknown ones a middle weight', () => {
    expect(paceWeight(0.01, 60)).toBeCloseTo(1 + Math.log(200));
    expect(paceWeight(null, 60)).toBeCloseTo(1 + Math.LN2);
    expect(paceWeight(5, 0)).toBeCloseTo(1 + Math.LN2);
  });
});

describe('paceAggregate', () => {
  it('splits done and open weight, skipping online/co-op and excluded achievements', () => {
    const list = [
      ach('a', { percent: 50, achieved: true }),
      ach('b', { percent: 5, achieved: false }),
      ach('c', { percent: 50, achieved: false, tags: ['online'] }),
      ach('d', { percent: 0.5, achieved: false, excluded: true }),
    ];
    const p = paceAggregate(list);
    expect(p.paceDone).toBe(1);
    expect(p.paceLeft).toBeCloseTo(1 + Math.log(10), 2);
    expect(p.paceTop).toBe(p.paceLeft);
    expect(p.skipOpen).toBe(1);
    // aggregate() carries them, so every sync keeps them current.
    expect(aggregate(list)).toMatchObject(p);
  });
});

describe('estimateLeft', () => {
  const base = { total: 20, unlocked: 16, playtime: 600, paceDone: 20, paceLeft: 10, paceTop: 2.5, skipOpen: 0 };
  it('scales the pace so far by the open weight, with a range around it', () => {
    const e = estimateLeft(game(base))!;
    expect(e.min).toBe(300);
    expect(e.lo).toBeLessThan(300);
    expect(e.hi).toBeGreaterThan(300);
  });
  it('one ultra-rare achievement no longer blows the estimate up', () => {
    // 10 common unlocked in 10 h, 2 common + one at 0.1 % open. The old formula said ~500 h.
    const list = [
      ...Array.from({ length: 10 }, (_, i) => ach(`d${i}`, { percent: 70, achieved: true })),
      ach('o1', { percent: 70 }),
      ach('o2', { percent: 70 }),
      ach('rare', { percent: 0.1 }),
    ];
    const e = estimateLeft({ ...game({ playtime: 600 }), ...aggregate(list) })!;
    expect(e.min).toBeGreaterThan(300);
    expect(e.min).toBeLessThan(600);
  });
  it('the range widens when one achievement dominates', () => {
    const even = estimateLeft(game(base))!;
    const lopsided = estimateLeft(game({ ...base, paceTop: 8 }))!;
    expect(lopsided.hi / lopsided.min).toBeGreaterThan(even.hi / even.min);
  });
  it('needs data, and skips games with only online/co-op left', () => {
    expect(estimateLeft(game({ ...base, unlocked: 2 }))).toBeNull();
    expect(estimateLeft(game({ ...base, playtime: 30 }))).toBeNull();
    expect(estimateLeft(game({ ...base, unlocked: 20 }))).toBeNull();
    expect(estimateLeft(game({ ...base, paceDone: null }))).toBeNull();
    expect(estimateLeft(game({ ...base, paceLeft: 0, paceTop: 0, skipOpen: 3 }))).toBeNull();
    expect(estimateLeft(game({ ...base, skipOpen: 2 }))!.skipped).toBe(2);
  });
});

describe('fmtRange', () => {
  it('shares the unit when it can', () => {
    expect(fmtRange({ lo: 720, hi: 1800 })).toBe('12–30 h');
    expect(fmtRange({ lo: 40, hi: 150 })).toBe('40 min – 2.5 h');
  });
});

describe('backtest', () => {
  it('replays the history and scores both formulas, without loading more than stored', async () => {
    const repo = new MemoryRepo();
    // 10 achievements, the same time each (one per hour of play); the last three are rare.
    const percents = [80, 70, 60, 50, 40, 30, 20, 2, 1, 0.5];
    const list = percents.map((p, i) => ach(`a${i}`, { percent: p, achieved: true, unlocktime: 1000 + i }));
    await repo.saveGames([{ ...game({ total: 10, unlocked: 10, playtime: 600 }), ...aggregate(list) }]);
    await repo.saveAchievements(1, list);
    await repo.addSnapshots(
      [3, 5, 7, 10].map((n, i) => ({ date: `2026-10-0${i + 1}`, appid: 1, playtime: n * 60, unlocked: n })),
    );
    const r = await backtest(repo);
    expect(r.summary.games).toBe(1);
    expect(r.summary.samples).toBe(3);
    // The old formula overrates the rare ones by far; the new one stays much closer.
    expect(r.summary.oldOffBy).toBeGreaterThan(r.summary.newOffBy);
    expect(r.summary.oldBias).toBeGreaterThan(3);
  });
});
