import { isPerfect, type Achievement, type Game, type Snapshot } from './types';

/**
 * Playtime it took to reach 100 %. Exact when a snapshot caught the game at 100 % (its first one)
 * or when it wasn't played after the last unlock; otherwise the current playtime is an upper bound.
 */
export function completionPlaytime(
  g: Pick<Game, 'unlocked' | 'total' | 'playtime' | 'lastPlayed' | 'lastUnlock'>,
  snapshots: Snapshot[],
): { min: number; exact: boolean } | null {
  if (!g.total || !isPerfect(g) || g.playtime <= 0) return null;
  const first = snapshots.find((s) => s.unlocked >= g.total!);
  // A snapshot from before the app knew the game can already be past 100 %; only trust it if
  // an earlier one shows the game still incomplete.
  if (first && snapshots.some((s) => s.date < first.date && s.unlocked < g.total!)) {
    return { min: first.playtime, exact: true };
  }
  // lastPlayed is only updated per session; a day of slack covers the session that brought 100 %.
  const exact = !!g.lastUnlock && g.lastPlayed <= g.lastUnlock + 86400;
  return { min: first?.playtime ?? g.playtime, exact };
}

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
