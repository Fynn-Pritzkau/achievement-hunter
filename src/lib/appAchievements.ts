import { SMART_LISTS, totals } from './lists';
import { completion, isPerfect, type Game } from './types';

/**
 * The app's own achievements, to make clearing the backlog more fun. Not to be confused
 * with Steam achievements: these are computed from the per-game aggregates already in
 * memory, so they cost no API calls and load no achievement lists. Name and description
 * are the i18n keys `appAch.<id>` and `appAch.<id>.desc` (`{n}` = goal).
 */
export interface AppAchievement {
  id: string;
  icon: string;
  /** 1 = easy, 2 = medium, 3 = hard. */
  tier: 1 | 2 | 3;
  /** Value at which it is earned. 1 for yes/no achievements. */
  goal: number;
  value: (s: LibraryStats) => number;
}

/** Numbers every app achievement is computed from, gathered in one pass over the library. */
export interface LibraryStats {
  games: number;
  perfect: number;
  unlocked: number;
  rarityScore: number;
  avgCompletion: number;
  /** Percent of games with achievements that have at least one unlock. */
  touched: number;
  /** Percent of games with achievements that were never played. */
  unplayed: number;
  /** Games at 50 % or more. */
  halfDone: number;
  almost: number;
  /** Games in "Started, left behind". */
  leftBehind: number;
  /** Started games (at least one unlock) with easy wins left. */
  easyLeft: number;
  started: number;
  /** Games that were at 100 % and aren't anymore. */
  lost: number;
  next: number;
  dropped: number;
  /** Games with an unlock in the last 7 / 30 days. */
  activeWeek: number;
  activeMonth: number;
  /** Perfect games whose last unlock was in the last 7 / 30 days. */
  perfectWeek: number;
  perfectMonth: number;
  /** Perfect games with under 2 hours of playtime. */
  quickPerfect: number;
  /** Most playtime (minutes) / most achievements among perfect games. */
  longestPerfect: number;
  biggestPerfect: number;
  /** A perfect game whose achievements average 5 % or less. */
  hardPerfect: boolean;
  /** Most rarity points in a single game. */
  bestGameRarity: number;
  hours: number;
}

const DAY = 86400;

export function libraryStats(games: Game[], nowUnix: number): LibraryStats {
  const withAch = games.filter((g) => g.total);
  const perfects = games.filter((g) => isPerfect(g));
  const started = withAch.filter((g) => g.unlocked > 0);
  const ctx = { runningAppId: null, now: nowUnix };
  const inList = (id: string) => {
    const list = SMART_LISTS.find((l) => l.id === id)!;
    return games.filter((g) => list.filter(g, ctx)).length;
  };
  const share = (n: number) => (withAch.length ? Math.floor((n / withAch.length) * 100) : 0);
  const within = (unix: number, days: number) => !!unix && nowUnix - unix < days * DAY;
  const sum = totals(games);
  return {
    games: withAch.length,
    perfect: sum.perfect,
    unlocked: sum.unlocked,
    rarityScore: sum.rarityScore,
    avgCompletion: Math.floor(sum.avgCompletion),
    touched: share(started.length),
    unplayed: share(withAch.filter((g) => g.playtime === 0).length),
    halfDone: withAch.filter((g) => (completion(g) ?? 0) >= 50).length,
    almost: inList('almost'),
    leftBehind: inList('started'),
    easyLeft: started.filter((g) => g.easyOpen > 0).length,
    started: started.length,
    lost: inList('lost'),
    next: games.filter((g) => g.status === 'next').length,
    dropped: games.filter((g) => g.status === 'dropped').length,
    activeWeek: games.filter((g) => within(g.lastUnlock, 7)).length,
    activeMonth: games.filter((g) => within(g.lastUnlock, 30)).length,
    perfectWeek: perfects.filter((g) => within(g.lastUnlock, 7)).length,
    perfectMonth: perfects.filter((g) => within(g.lastUnlock, 30)).length,
    quickPerfect: perfects.filter((g) => g.playtime > 0 && g.playtime < 120).length,
    longestPerfect: Math.max(0, ...perfects.map((g) => g.playtime)),
    biggestPerfect: Math.max(0, ...perfects.map((g) => g.total ?? 0)),
    // rarityScore sums 100/percent, so score/total >= 20 means an average of 5 % or less.
    hardPerfect: perfects.some((g) => g.rarityScore / (g.total ?? 1) >= 20),
    bestGameRarity: Math.max(0, ...games.map((g) => g.rarityScore)),
    hours: Math.floor(games.reduce((s, g) => s + g.playtime, 0) / 60),
  };
}

const flag = (b: boolean) => (b ? 1 : 0);

/** Shorthand for counting achievements: earned when `value(stats) >= goal`. */
const count = (id: string, icon: string, tier: AppAchievement['tier'], goal: number, value: AppAchievement['value']): AppAchievement => ({ id, icon, tier, goal, value });
/** Shorthand for yes/no achievements. */
const once = (id: string, icon: string, tier: AppAchievement['tier'], test: (s: LibraryStats) => boolean): AppAchievement => ({ id, icon, tier, goal: 1, value: (s) => flag(test(s)) });

export const APP_ACHIEVEMENTS: AppAchievement[] = [
  // 100 % games
  count('perfect1', '🏆', 1, 1, (s) => s.perfect),
  count('perfect5', '🥉', 1, 5, (s) => s.perfect),
  count('perfect10', '🥈', 2, 10, (s) => s.perfect),
  count('perfect25', '🥇', 2, 25, (s) => s.perfect),
  count('perfect50', '👑', 3, 50, (s) => s.perfect),
  count('perfect100', '🏰', 3, 100, (s) => s.perfect),
  // Unlocks
  count('unlocks100', '✔️', 1, 100, (s) => s.unlocked),
  count('unlocks500', '📜', 1, 500, (s) => s.unlocked),
  count('unlocks1000', '🎖️', 2, 1000, (s) => s.unlocked),
  count('unlocks2500', '🗃️', 2, 2500, (s) => s.unlocked),
  count('unlocks5000', '🌌', 3, 5000, (s) => s.unlocked),
  count('unlocks10000', '🪐', 3, 10000, (s) => s.unlocked),
  // Backlog
  count('touched', '🧹', 1, 50, (s) => s.touched),
  count('touched75', '🧽', 2, 75, (s) => s.touched),
  count('half10', '🌗', 1, 10, (s) => s.halfDone),
  count('half25', '🌕', 2, 25, (s) => s.halfDone),
  count('halfway', '📈', 1, 50, (s) => s.avgCompletion),
  count('thorough', '🔬', 2, 75, (s) => s.avgCompletion),
  count('completionist', '🧭', 3, 90, (s) => s.avgCompletion),
  once('looseEnds', '🧺', 2, (s) => s.perfect >= 3 && s.almost === 0),
  once('nothingForgotten', '🧠', 2, (s) => s.started >= 5 && s.leftBehind === 0),
  once('easyCleared', '🍰', 3, (s) => s.started >= 10 && s.easyLeft <= 5),
  once('noShame', '🗑️', 3, (s) => s.games >= 20 && s.unplayed <= 10),
  once('flawless', '🛡️', 3, (s) => s.perfect >= 10 && s.lost === 0),
  // Momentum
  count('variety', '🎲', 1, 5, (s) => s.activeWeek),
  count('variety10', '🎨', 2, 10, (s) => s.activeWeek),
  count('busyMonth', '📅', 2, 20, (s) => s.activeMonth),
  count('perfectWeek', '🔥', 2, 2, (s) => s.perfectWeek),
  count('perfectMonth', '☄️', 3, 5, (s) => s.perfectMonth),
  // Special games
  once('quickie', '⚡', 1, (s) => s.quickPerfect >= 1),
  count('quickie3', '🍿', 2, 3, (s) => s.quickPerfect),
  once('marathon', '🏃', 2, (s) => s.longestPerfect >= 100 * 60),
  once('epic', '🗿', 3, (s) => s.longestPerfect >= 500 * 60),
  once('mammoth', '🦣', 2, (s) => s.biggestPerfect >= 100),
  once('titan', '🐋', 3, (s) => s.biggestPerfect >= 250),
  once('hardcore', '💀', 3, (s) => s.hardPerfect),
  // Rarity and time
  count('rarity', '💎', 1, 5000, (s) => s.rarityScore),
  count('rarity25k', '👛', 3, 25000, (s) => s.rarityScore),
  count('gem', '🔮', 2, 1000, (s) => s.bestGameRarity),
  count('hours1000', '⏳', 2, 1000, (s) => s.hours),
  // Habits
  count('planner', '🗓️', 1, 3, (s) => s.next),
  once('lettingGo', '🍃', 1, (s) => s.dropped > 0),
];

/** Unix ms per earned id. Earned stays earned, even if a game later loses its 100 %. */
export type Earned = Record<string, number>;

export interface AppAchievementProgress {
  achievement: AppAchievement;
  current: number;
  earnedAt: number | null;
}

export function appAchievementProgress(stats: LibraryStats, earned: Earned): AppAchievementProgress[] {
  return APP_ACHIEVEMENTS.map((a) => ({
    achievement: a,
    current: Math.min(Math.floor(a.value(stats)), a.goal),
    earnedAt: earned[a.id] ?? null,
  }));
}

/** Reached now but not earned before. */
export function newlyEarned(stats: LibraryStats, earned: Earned): AppAchievement[] {
  return APP_ACHIEVEMENTS.filter((a) => !(a.id in earned) && a.value(stats) >= a.goal);
}

/** The closest unearned one that already has some progress, as a gentle nudge. */
export function nextAppAchievement(progress: AppAchievementProgress[]): AppAchievementProgress | null {
  let best: AppAchievementProgress | null = null;
  for (const p of progress) {
    const goal = p.achievement.goal;
    // Reached but not saved yet counts as earned: the next check hands it out.
    if (p.earnedAt != null || goal === 1 || p.current === 0 || p.current >= goal) continue;
    if (!best || p.current / goal > best.current / best.achievement.goal) best = p;
  }
  return best;
}
