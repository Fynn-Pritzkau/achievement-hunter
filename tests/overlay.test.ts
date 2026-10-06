import { describe, expect, it } from 'vitest';
import { BUNDLE_MS, buildOverlayData, DEFAULT_OVERLAY, progressStep, ProgressTracker } from '../src/lib/overlay';
import { emptyGame, type Achievement } from '../src/lib/types';

const game = { ...emptyGame(1, 'Game'), total: 6, unlocked: 1 };
const ach = (apiname: string, percent: number | null, over: Partial<Achievement> = {}): Achievement => ({
  apiname,
  name: apiname.toUpperCase(),
  description: `desc ${apiname}`,
  hidden: false,
  icon: `${apiname}.jpg`,
  icongray: `${apiname}_gray.jpg`,
  achieved: false,
  unlocktime: 0,
  percent,
  pinned: false,
  excluded: false,
  note: '',
  tags: [],
  ...over,
});
const list = [
  ach('done', 90, { achieved: true, unlocktime: 1 }),
  ach('rare', 2),
  ach('easy', 70),
  ach('broken', 95, { excluded: true }),
  ach('pin', 40, { pinned: true }),
  ach('nodata', null),
  ach('secret', 60, { hidden: true }),
];
const opts = { locale: 'en' as const, revealHidden: false };
const names = (l: { apiname: string }[]) => l.map((a) => a.apiname);

describe('buildOverlayData', () => {
  it('suggests the easiest open achievements, skipping done, excluded, pinned and unknown ones', () => {
    const d = buildOverlayData(game, list, DEFAULT_OVERLAY, opts);
    expect(d.game).toEqual({ name: 'Game', unlocked: 1, total: 6 });
    expect(names(d.pinned)).toEqual(['pin']);
    expect(names(d.next)).toEqual(['easy', 'secret', 'rare']);
  });

  it('respects the suggestion count and switched-off sections', () => {
    const d = buildOverlayData(game, list, { ...DEFAULT_OVERLAY, suggestions: 1, showPinned: false, showProgress: false }, opts);
    expect(names(d.next)).toEqual(['easy']);
    expect(d.pinned).toEqual([]);
    expect(d.showProgress).toBe(false);
    expect(buildOverlayData(game, list, { ...DEFAULT_OVERLAY, suggestions: 0 }, opts).next).toEqual([]);
    expect(buildOverlayData(game, list, { ...DEFAULT_OVERLAY, suggestions: 99 }, opts).next).toHaveLength(3);
  });

  it('hides descriptions of hidden achievements unless revealed', () => {
    const hidden = buildOverlayData(game, list, DEFAULT_OVERLAY, opts).next.find((a) => a.apiname === 'secret')!;
    expect(hidden.description).toBe('');
    const shown = buildOverlayData(game, list, DEFAULT_OVERLAY, { ...opts, revealHidden: true }).next.find((a) => a.apiname === 'secret')!;
    expect(shown.description).toBe('desc secret');
  });

  it('lists counted-up achievements first, once, with their progress', () => {
    const progress = new Map([['rare', { current: 3, max: 10 }], ['easy', { current: 7, max: 8 }]]);
    const bumps = [
      { apiname: 'rare', delta: 1, at: 5, notable: true },
      { apiname: 'done', delta: 1, at: 4, notable: true }, // unlocked meanwhile: gone
      { apiname: 'pin', delta: 2, at: 3, notable: true },
    ];
    const d = buildOverlayData(game, list, DEFAULT_OVERLAY, { ...opts, progress, bumps });
    expect(names(d.recent)).toEqual(['rare']);
    expect(d.recent[0]).toMatchObject({ progress: { current: 3, max: 10 }, bump: { delta: 1, at: 5 } });
    // Pinned ones keep their section, with the bump.
    expect(names(d.pinned)).toEqual(['pin']);
    expect(d.pinned[0].bump).toEqual({ delta: 2, at: 3 });
    expect(names(d.next)).toEqual(['easy', 'secret']);
    const noPins = buildOverlayData(game, list, { ...DEFAULT_OVERLAY, showPinned: false }, { ...opts, progress, bumps });
    expect(names(noPins.recent)).toEqual(['rare', 'pin']);
    expect(noPins.pinned).toEqual([]);
    expect(d.next[0].progress).toEqual({ current: 7, max: 8 });

    const toast = buildOverlayData(game, list, DEFAULT_OVERLAY, { ...opts, progress, bumps, mode: 'toast' });
    expect(names(toast.recent)).toEqual(['rare', 'pin']);
    expect(toast.pinned).toEqual([]);
    expect(toast.next).toEqual([]);
    expect(toast.showProgress).toBe(false);
  });

  it('is empty without a running game', () => {
    const d = buildOverlayData(null, list, DEFAULT_OVERLAY, opts);
    expect(d.game).toBeNull();
    expect(d.pinned).toEqual([]);
    expect(d.next).toEqual([]);
  });
});

describe('ProgressTracker', () => {
  const p = (...entries: [string, number, number][]) => new Map(entries.map(([n, current, max]) => [n, { current, max }]));

  it('takes the first read as baseline and reports what went up', () => {
    const tr = new ProgressTracker();
    expect(tr.update(1, p(['feathers', 37, 50], ['kills', 10, 100]), 0)).toEqual([]);
    expect(tr.update(1, p(['feathers', 38, 50], ['kills', 10, 100]), 1000)).toEqual([
      { apiname: 'feathers', delta: 1, at: 1000, notable: true },
    ]);
    // Never counts down, and a new counter starts from 0.
    expect(tr.update(1, p(['feathers', 38, 50], ['kills', 9, 100], ['laps', 2, 5]), 2000)).toEqual([
      { apiname: 'laps', delta: 2, at: 2000, notable: true },
    ]);
    expect(names(tr.recent(1))).toEqual(['laps', 'feathers']);
  });

  it('adds up bumps within the bundle time', () => {
    const tr = new ProgressTracker();
    tr.update(1, p(['f', 1, 50]), 0);
    tr.update(1, p(['f', 2, 50]), 1000);
    expect(tr.update(1, p(['f', 4, 50]), 1000 + BUNDLE_MS - 1)[0].delta).toBe(3);
    expect(tr.update(1, p(['f', 5, 50]), 1000 + 3 * BUNDLE_MS)[0].delta).toBe(1);
  });

  it('keeps nonstop counters quiet between steps', () => {
    expect(progressStep(50)).toBe(1);
    expect(progressStep(120)).toBe(3);
    expect(progressStep(3_000_000)).toBe(60_000);
    const tr = new ProgressTracker();
    tr.update(1, p(['clicks', 100_000, 3_000_000]), 0);
    const quiet = tr.update(1, p(['clicks', 101_500, 3_000_000]), 15_000);
    expect(quiet).toMatchObject([{ delta: 1500, notable: false }]);
    expect(tr.update(1, p(['clicks', 120_100, 3_000_000]), 30_000)[0].notable).toBe(true);
  });

  it('forgets closed games', () => {
    const tr = new ProgressTracker();
    tr.update(1, p(['f', 1, 50]), 0);
    tr.update(1, p(['f', 2, 50]), 1);
    tr.forget(1);
    expect(tr.tracks(1)).toBe(false);
    expect(tr.recent(1)).toEqual([]);
    expect(tr.update(1, p(['f', 3, 50]), 2)).toEqual([]);
  });
});
