import { completion, isPerfect, type Game } from './types';

export interface SmartList {
  /** Label and hint are the i18n keys `list.<id>` and `list.<id>.hint`. */
  id: string;
  filter: (g: Game, ctx: ListContext) => boolean;
  /** Sort used when the list is opened. */
  sort: SortKey;
}

export interface ListContext {
  runningAppId: number | null;
  /** Unix seconds. */
  now: number;
}

const has = (g: Game) => !!g.total && !g.hidden;
const pct = (g: Game) => completion(g) ?? 0;

export const SMART_LISTS: SmartList[] = [
  { id: 'running', filter: (g, c) => g.appid === c.runningAppId, sort: 'recent' },
  { id: 'all', filter: (g) => has(g), sort: 'recent' },
  { id: 'almost', filter: (g) => has(g) && pct(g) >= 80 && !isPerfect(g), sort: 'remaining' },
  { id: 'easy', filter: (g) => has(g) && g.easyOpen > 0, sort: 'easy' },
  { id: 'lost', filter: (g) => has(g) && g.wasPerfect && !isPerfect(g), sort: 'remaining' },
  { id: 'started', filter: (g, c) => has(g) && pct(g) >= 50 && !isPerfect(g) && c.now - g.lastPlayed > 30 * 86400, sort: 'completion' },
  { id: 'rare', filter: (g) => has(g) && g.rarestOpen != null && g.rarestOpen < 5, sort: 'rarest' },
  { id: 'perfect', filter: (g) => has(g) && isPerfect(g), sort: 'recentUnlock' },
  { id: 'unplayed', filter: (g) => has(g) && g.playtime === 0, sort: 'name' },
  { id: 'none', filter: (g) => g.total === 0 && !g.hidden, sort: 'name' },
  { id: 'hidden', filter: (g) => g.hidden, sort: 'name' },
];

export type SortKey = 'recent' | 'recentUnlock' | 'completion' | 'remaining' | 'effort' | 'easy' | 'rarest' | 'rarity' | 'playtime' | 'name';

/** Labels are the i18n keys `sort.<key>`. */
export const SORTS: SortKey[] = ['recent', 'recentUnlock', 'completion', 'remaining', 'effort', 'easy', 'rarest', 'rarity', 'playtime', 'name'];

const remaining = (g: Game) => (g.total ?? 0) - g.unlocked;

const COMPARE: Record<SortKey, (a: Game, b: Game) => number> = {
  recent: (a, b) => b.lastPlayed - a.lastPlayed,
  recentUnlock: (a, b) => b.lastUnlock - a.lastUnlock,
  completion: (a, b) => pct(b) - pct(a),
  remaining: (a, b) => remaining(a) - remaining(b),
  effort: (a, b) => a.effort - b.effort,
  easy: (a, b) => b.easyOpen - a.easyOpen,
  rarest: (a, b) => (a.rarestOpen ?? 101) - (b.rarestOpen ?? 101),
  rarity: (a, b) => b.rarityScore - a.rarityScore,
  playtime: (a, b) => b.playtime - a.playtime,
  name: () => 0,
};

/** Pinned games first, then the chosen order, then name as tie-breaker. */
export function sortGames(games: Game[], key: SortKey): Game[] {
  const cmp = COMPARE[key];
  return [...games].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || cmp(a, b) || a.name.localeCompare(b.name),
  );
}

/** Tiny query language for the search box: free text plus `tag:`-like filters. */
export function matchesQuery(g: Game, q: string): boolean {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((t) => {
    const m = t.match(/^(status|min|max):(.+)$/);
    if (!m) return g.name.toLowerCase().includes(t);
    const [, k, v] = m;
    if (k === 'status') return g.status === v;
    if (k === 'min') return pct(g) >= Number(v);
    if (k === 'max') return pct(g) <= Number(v);
    return true;
  });
}

export const totals = (games: Game[]) => {
  const started = games.filter((g) => g.total && g.unlocked > 0);
  return {
    perfect: games.filter((g) => isPerfect(g)).length,
    unlocked: games.reduce((s, g) => s + g.unlocked, 0),
    // Steam's "average game completion": only games with at least one unlock.
    avgCompletion: started.length ? started.reduce((s, g) => s + pct(g), 0) / started.length : 0,
    rarityScore: Math.round(games.reduce((s, g) => s + g.rarityScore, 0)),
  };
};
