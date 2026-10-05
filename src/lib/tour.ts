import type { Game } from './types';

/**
 * Optional guided tour. Each step highlights an element marked with `data-tour="<target>"`;
 * texts are the i18n keys `tour.<id>` and `tour.<id>.body`.
 */
export interface TourStep {
  id: string;
  /** `data-tour` value to highlight; none (or not found) = centered card. */
  target?: string;
  /** View the step needs: a sidebar list, or the tour game's detail page. */
  view?: { list: string } | { game: true };
  /** Only in the desktop app (overlay, tray). */
  desktopOnly?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'welcome', view: { list: 'all' } },
  { id: 'search', target: 'search', view: { list: 'all' } },
  { id: 'lists', target: 'lists', view: { list: 'all' } },
  { id: 'toolbar', target: 'toolbar', view: { list: 'all' } },
  { id: 'row', target: 'row', view: { list: 'all' } },
  { id: 'gameHeader', target: 'game-actions', view: { game: true } },
  { id: 'gameFilters', target: 'game-filters', view: { game: true } },
  { id: 'achievement', target: 'achievement', view: { game: true } },
  { id: 'live', target: 'live', view: { list: 'all' } },
  { id: 'history', target: 'history', view: { list: 'history' } },
  { id: 'milestones', target: 'milestones', view: { list: 'appAchievements' } },
  { id: 'sync', target: 'sync', view: { list: 'all' } },
  { id: 'overlay', target: 'settings', view: { list: 'all' }, desktopOnly: true },
  { id: 'done', target: 'tour', view: { list: 'all' } },
];

/** Steps that make sense here: game steps need a game with achievements, desktop steps the app. */
export function tourSteps(hasGame: boolean, desktop: boolean): TourStep[] {
  return TOUR_STEPS.filter((s) => (desktop || !s.desktopOnly) && (hasGame || !(s.view && 'game' in s.view)));
}

/** The game the tour opens: a running one, else the last played one with open achievements (so the list isn't empty). */
export function tourGame(games: Game[], runningAppIds: number[]): Game | null {
  const all = games.filter((g) => !!g.total && !g.hidden);
  const open = all.filter((g) => g.unlocked < g.total!);
  const pool = open.length ? open : all;
  return (
    pool.find((g) => runningAppIds.includes(g.appid)) ??
    pool.reduce<Game | null>((best, g) => (!best || g.lastPlayed > best.lastPlayed ? g : best), null)
  );
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const GAP = 12;
const MARGIN = 12;

/** Where the card goes: right of the target, else below, above, left; centered without a target. */
export function placeCard(target: Rect | null, card: { width: number; height: number }, view: { width: number; height: number }) {
  const clamp = (v: number, max: number) => Math.max(MARGIN, Math.min(v, max - MARGIN));
  if (!target) return { left: (view.width - card.width) / 2, top: (view.height - card.height) / 2 };
  const right = target.left + target.width + GAP;
  const below = target.top + target.height + GAP;
  const fitsX = (x: number) => x >= MARGIN && x + card.width <= view.width - MARGIN;
  const fitsY = (y: number) => y >= MARGIN && y + card.height <= view.height - MARGIN;
  const alignY = clamp(target.top, view.height - card.height);
  const alignX = clamp(target.left, view.width - card.width);
  if (fitsX(right)) return { left: right, top: alignY };
  if (fitsY(below)) return { left: alignX, top: below };
  if (fitsY(target.top - GAP - card.height)) return { left: alignX, top: target.top - GAP - card.height };
  if (fitsX(target.left - GAP - card.width)) return { left: target.left - GAP - card.width, top: alignY };
  // Huge target: inside it, at the bottom.
  return { left: alignX, top: clamp(view.height - card.height, view.height - card.height) };
}
