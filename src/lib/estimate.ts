import type { Repo } from './db/repo';
import { isPerfect, type Achievement, type Game } from './types';
import { fmtHours } from './util';

/*
 * "~X h to 100 %": the player's pace in this game so far (minutes per weight unlocked) times the
 * weight still open. The weight of an achievement stands for the time it takes:
 *
 * - Global percents count everyone who owns the game, also those who never started it. Relative to
 *   the game's most common achievement they say what share of the players who started got it.
 * - Players drop out along the way, so the share falls roughly exponentially with time:
 *   time ~ ln(1 / share). 100/percent grew far too fast (a 0.3 % achievement counted as 300 common ones).
 * - Online and co-op achievements depend on other players; they are counted, not estimated.
 */

/** The rarest achievement counts as 1/200 of the most common one (weight ≈ 6.3); rarer is noise. */
const MAX_RATIO = 200;
/** Weight of an achievement without a known percent: as if half the players who started had it. */
const UNKNOWN_WEIGHT = 1 + Math.LN2;
const SKIP_TAGS = ['online', 'coop'];

export function paceWeight(percent: number | null, maxPercent: number): number {
  if (percent == null || !(maxPercent > 0)) return UNKNOWN_WEIGHT;
  return 1 + Math.log(maxPercent / Math.max(percent, maxPercent / MAX_RATIO));
}

const skipped = (a: Pick<Achievement, 'tags'>) => a.tags.some((t) => SKIP_TAGS.includes(t));

/** Highest percent among the counted achievements, 0 if none is known. */
function maxPercent(list: Achievement[]): number {
  let max = 0;
  for (const a of list) if (!a.excluded && a.percent != null && a.percent > max) max = a.percent;
  return max;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The pace aggregates of one game, from its (full) achievement list. */
export function paceAggregate(list: Achievement[]): Pick<Game, 'paceDone' | 'paceLeft' | 'paceTop' | 'skipOpen'> {
  const max = maxPercent(list);
  let done = 0;
  let left = 0;
  let top = 0;
  let skipOpen = 0;
  for (const a of list) {
    if (a.excluded) continue;
    const w = paceWeight(a.percent, max);
    if (a.achieved) done += w;
    else if (skipped(a)) skipOpen++;
    else {
      left += w;
      if (w > top) top = w;
    }
  }
  return { paceDone: round2(done), paceLeft: round2(left), paceTop: round2(top), skipOpen };
}

/**
 * How far the range spreads around the estimate: wide with few unlocks to learn the pace from,
 * and when one achievement makes up much of what is left. lo = min / (1 + k), hi = min * (1 + k).
 */
export function spread(unlocked: number, topShare: number): number {
  return 0.25 + 1 / Math.sqrt(Math.max(unlocked, 1)) + 0.5 * topShare;
}

export interface LeftEstimate {
  /** Most likely minutes to 100 %. */
  min: number;
  lo: number;
  hi: number;
  /** Open online/co-op achievements, not part of the estimate. */
  skipped: number;
}

type EstimateInput = Pick<Game, 'unlocked' | 'total' | 'playtime' | 'paceDone' | 'paceLeft' | 'paceTop' | 'skipOpen'>;

/** Null when there is too little to go on, or only online/co-op achievements are left. */
export function estimateLeft(g: EstimateInput): LeftEstimate | null {
  if (!g.total || isPerfect(g) || g.unlocked < 3 || g.playtime < 60) return null;
  if (g.paceDone == null || !(g.paceLeft > 0)) return null;
  const min = Math.round((g.playtime / Math.max(g.paceDone, 1)) * g.paceLeft);
  const k = spread(g.unlocked, g.paceTop / g.paceLeft);
  return { min, lo: Math.round(min / (1 + k)), hi: Math.round(min * (1 + k)), skipped: g.skipOpen ?? 0 };
}

/** "12–30 h", or "40 min – 2.5 h" when the units differ. */
export function fmtRange(e: Pick<LeftEstimate, 'lo' | 'hi'>): string {
  const [a, ua] = fmtHours(e.lo).split(' ');
  const b = fmtHours(e.hi);
  return ua === b.split(' ')[1] ? `${a}–${b}` : `${a} ${ua} – ${b}`;
}

// --- Backtest (dev only): how well would the formulas have predicted the player's real history? ---

export interface BacktestGame {
  appid: number;
  name: string;
  samples: number;
  /** Median of ln(predicted / actual): > 0 = too high. */
  oldErr: number;
  newErr: number;
  /** Share of samples whose actual time fell inside the new range. */
  inRange: number;
}

export interface BacktestResult {
  games: BacktestGame[];
  summary: {
    games: number;
    samples: number;
    /** Typical factor the estimate is off by (median over games), e.g. 1.6 = 60 % too high or too low. */
    oldOffBy: number;
    newOffBy: number;
    /** Median signed factor: > 1 = estimates too high. */
    oldBias: number;
    newBias: number;
    /** Share of samples whose actual time fell inside the new range (target: around 0.7–0.8). */
    newInRange: number;
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const oldWeight = (a: Achievement) => 100 / Math.max(a.percent ?? 50, 0.1);

/**
 * Replays the stored history. For every daily snapshot A of a game the achievements are split by
 * unlock order: the first A.unlocked were known then, the rest were unlocked later. Each formula
 * predicts the playtime those later ones took from the pace up to A; the actual time runs from A
 * to the first snapshot with all of them unlocked. Uses only stored data, no API calls; loads one
 * game's achievements at a time.
 */
export async function backtest(repo: Repo): Promise<BacktestResult> {
  const byGame = new Map<number, { date: string; playtime: number; unlocked: number }[]>();
  for (const s of await repo.getSnapshots('0000-00-00')) {
    const list = byGame.get(s.appid) ?? [];
    list.push(s);
    byGame.set(s.appid, list);
  }
  const names = new Map((await repo.getGames()).map((g) => [g.appid, g.name]));
  const games: BacktestGame[] = [];
  let hits = 0;
  let samples = 0;
  for (const [appid, snaps] of byGame) {
    if (snaps.length < 2) continue;
    snaps.sort((a, b) => a.date.localeCompare(b.date));
    const list = (await repo.getAchievements(appid)).filter((a) => !a.excluded);
    const max = maxPercent(list);
    const unlocked = list.filter((a) => a.achieved).sort((a, b) => a.unlocktime - b.unlocktime);
    const end = snaps.find((s) => s.unlocked >= unlocked.length);
    if (!end) continue;
    const oldErrs: number[] = [];
    const newErrs: number[] = [];
    let gameHits = 0;
    for (const a of snaps) {
      if (a.date >= end.date || a.unlocked < 3 || a.playtime < 60 || a.unlocked >= unlocked.length) continue;
      const actual = end.playtime - a.playtime;
      if (actual <= 0) continue;
      const done = unlocked.slice(0, a.unlocked);
      const later = unlocked.slice(a.unlocked).filter((x) => !skipped(x));
      const sum = (xs: Achievement[], w: (x: Achievement) => number) => xs.reduce((s, x) => s + w(x), 0);
      const newW = (x: Achievement) => paceWeight(x.percent, max);
      const laterW = sum(later, newW);
      if (laterW <= 0) continue;
      const oldPred = (a.playtime / Math.max(sum(done, oldWeight), 1)) * sum(later, oldWeight);
      const newPred = (a.playtime / Math.max(sum(done, newW), 1)) * laterW;
      oldErrs.push(Math.log(Math.max(oldPred, 1) / actual));
      newErrs.push(Math.log(Math.max(newPred, 1) / actual));
      const k = spread(a.unlocked, Math.max(...later.map(newW)) / laterW);
      if (actual >= newPred / (1 + k) && actual <= newPred * (1 + k)) gameHits++;
    }
    if (!newErrs.length) continue;
    hits += gameHits;
    samples += newErrs.length;
    games.push({
      appid,
      name: names.get(appid) ?? String(appid),
      samples: newErrs.length,
      oldErr: round2(median(oldErrs)),
      newErr: round2(median(newErrs)),
      inRange: round2(gameHits / newErrs.length),
    });
  }
  const factor = (xs: number[]) => round2(Math.exp(median(xs)));
  return {
    games,
    summary: {
      games: games.length,
      samples,
      oldOffBy: factor(games.map((g) => Math.abs(g.oldErr))),
      newOffBy: factor(games.map((g) => Math.abs(g.newErr))),
      oldBias: factor(games.map((g) => g.oldErr)),
      newBias: factor(games.map((g) => g.newErr)),
      newInRange: samples ? round2(hits / samples) : 0,
    },
  };
}
