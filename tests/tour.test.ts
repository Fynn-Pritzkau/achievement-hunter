import { describe, expect, it } from 'vitest';
import { isMessageKey } from '../src/lib/i18n.svelte';
import { placeCard, TOUR_STEPS, tourGame, tourSteps } from '../src/lib/tour';
import type { Game } from '../src/lib/types';

const game = (appid: number, p: Partial<Game> = {}) => ({ appid, total: 10, unlocked: 5, hidden: false, lastPlayed: 0, ...p }) as Game;

describe('tour', () => {
  it('drops game steps without a game and desktop steps in the browser', () => {
    const all = tourSteps(true, true).map((s) => s.id);
    expect(all).toEqual(TOUR_STEPS.map((s) => s.id));
    const browser = tourSteps(false, false).map((s) => s.id);
    expect(browser).not.toContain('overlay');
    expect(browser).not.toContain('achievement');
    expect(browser).toContain('lists');
    // The overlay step shows the tour game, so it needs one.
    expect(tourSteps(false, true).map((s) => s.id)).not.toContain('overlay');
    expect(TOUR_STEPS.find((s) => s.id === 'overlay')).toMatchObject({ overlay: true, desktopOnly: true });
  });

  it('has a title and text for every step', () => {
    // English is typed against the German keys, so checking the keys covers both languages.
    for (const s of TOUR_STEPS) expect([isMessageKey(`tour.${s.id}`), isMessageKey(`tour.${s.id}.body`)]).toEqual([true, true]);
  });

  it('opens a running game, else the last played one with open achievements', () => {
    const games = [game(1, { lastPlayed: 50 }), game(2, { lastPlayed: 90, unlocked: 10 }), game(3, { lastPlayed: 10 }), game(4, { total: 0 })];
    expect(tourGame(games, [3])?.appid).toBe(3);
    expect(tourGame(games, [])?.appid).toBe(1);
    expect(tourGame([game(2, { unlocked: 10 })], [])?.appid).toBe(2);
    expect(tourGame([game(4, { total: 0 })], [])).toBeNull();
  });

  it('places the card next to the target and inside the window', () => {
    const view = { width: 1000, height: 700 };
    const card = { width: 300, height: 150 };
    expect(placeCard(null, card, view)).toEqual({ left: 350, top: 275 });
    // Sidebar item: to the right.
    expect(placeCard({ left: 10, top: 100, width: 220, height: 30 }, card, view)).toEqual({ left: 242, top: 100 });
    // Full-width toolbar: below.
    expect(placeCard({ left: 240, top: 0, width: 760, height: 60 }, card, view)).toEqual({ left: 240, top: 72 });
    // Footer at the bottom of the sidebar, card clamped to the window.
    expect(placeCard({ left: 10, top: 640, width: 220, height: 50 }, card, view)).toEqual({ left: 242, top: 538 });
  });
});
