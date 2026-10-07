import type { Achievement, Snapshot } from './types';

export interface TimelinePoint {
  /** Unix seconds. */
  t: number;
  /** Completion in percent after this unlock. */
  pct: number;
  a: Achievement;
}

/**
 * The completion curve of one game: one point per unlock, oldest first. Excluded achievements
 * don't count, like in the game's numbers; unlocks without a time can't be placed.
 */
export function timelinePoints(list: Achievement[], total: number): TimelinePoint[] {
  if (total <= 0) return [];
  const counted = list.filter((a) => !a.excluded);
  // Unlocks without a time still count towards the level the curve starts at.
  let n = counted.filter((a) => a.achieved && a.unlocktime <= 0).length;
  return counted
    .filter((a) => a.achieved && a.unlocktime > 0)
    .sort((a, b) => a.unlocktime - b.unlocktime)
    .map((a) => ({ t: a.unlocktime, pct: (++n / total) * 100, a }));
}

/** Playtime per snapshot day as unix seconds (local midnight) and minutes. */
export function playtimePoints(snapshots: Snapshot[]): { t: number; min: number }[] {
  return snapshots.map((s) => {
    const [y, m, d] = s.date.split('-').map(Number);
    return { t: Math.floor(new Date(y, m - 1, d).getTime() / 1000), min: s.playtime };
  });
}
