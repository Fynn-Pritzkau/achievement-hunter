import { describe, expect, it } from 'vitest';
import { completionPlaytime } from '../src/lib/timeline';

const DAY = 86400;
const game = { unlocked: 10, total: 10, playtime: 900, lastUnlock: 100 * DAY, lastPlayed: 100 * DAY };
const snap = (date: string, playtime: number, unlocked: number) => ({ date, appid: 1, playtime, unlocked });

describe('completionPlaytime', () => {
  it('is null for incomplete games', () => {
    expect(completionPlaytime({ ...game, unlocked: 9 }, [])).toBeNull();
  });

  it('takes the first snapshot at 100 % after an incomplete one', () => {
    const s = [snap('2026-01-01', 300, 5), snap('2026-01-05', 600, 10), snap('2026-02-01', 900, 10)];
    expect(completionPlaytime({ ...game, lastPlayed: 200 * DAY }, s)).toEqual({ min: 600, exact: true });
  });

  it('is exact without snapshots when not played after the last unlock', () => {
    expect(completionPlaytime(game, [])).toEqual({ min: 900, exact: true });
  });

  it('is an upper bound when played on after 100 %', () => {
    const s = [snap('2026-01-05', 700, 10)];
    expect(completionPlaytime({ ...game, lastPlayed: 200 * DAY }, s)).toEqual({ min: 700, exact: false });
  });
});
