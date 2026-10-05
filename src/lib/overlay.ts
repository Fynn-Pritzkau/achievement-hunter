/**
 * Data for the in-game overlay. The overlay window only renders what the main window sends,
 * so it needs no database, no sync and no API calls of its own.
 */
import type { Locale } from './i18n.svelte';
import type { StatProgress } from './steam/local';
import type { Achievement, Game } from './types';

export type OverlayCorner = 'tl' | 'tr' | 'bl' | 'br';
export const OVERLAY_CORNERS: OverlayCorner[] = ['tl', 'tr', 'bl', 'br'];
export const MAX_SUGGESTIONS = 5;
/** How many recently counted-up achievements the overlay lists. */
export const MAX_RECENT = 3;
/** Bumps within this time add up, and a progress popup closes after this long without a new one. */
export const BUNDLE_MS = 4000;

export interface OverlaySettings {
  /** Global shortcut in accelerator syntax, e.g. "Ctrl+Shift+A". Empty = off. */
  hotkey: string;
  corner: OverlayCorner;
  showProgress: boolean;
  showPinned: boolean;
  /** How many of the easiest open achievements to show, 0 = none. */
  suggestions: number;
  /** Pop up briefly when a counter goes up while the overlay is closed. */
  progressPopup: boolean;
}

export const DEFAULT_OVERLAY: OverlaySettings = {
  hotkey: 'Ctrl+Shift+A',
  corner: 'tr',
  showProgress: true,
  showPinned: true,
  suggestions: 3,
  progressPopup: true,
};

/** A stat counter that went up, e.g. 37 → 39 of 50 collectibles. */
export interface ProgressBump {
  apiname: string;
  /** How much it went up, added up over bumps less than BUNDLE_MS apart. */
  delta: number;
  /** Unix ms of the latest bump. */
  at: number;
  /** Crossed a popup step (see progressStep). Counters that climb nonstop only pop up now and then. */
  notable: boolean;
}

/**
 * Popup granularity: at most ~50 popups over an achievement's whole way. 50 collectibles pop up
 * on every pickup; 3,000,000 clicks (idle games) only every 60,000.
 */
export const progressStep = (max: number) => Math.max(1, Math.ceil(max / 50));

export interface OverlayAch {
  apiname: string;
  name: string;
  /** Empty for hidden achievements unless the user wants them revealed. */
  description: string;
  icon: string;
  percent: number | null;
  /** Counter towards the achievement, when Steam keeps one. */
  progress: StatProgress | null;
  bump: { delta: number; at: number } | null;
}

export interface OverlayData {
  locale: Locale;
  corner: OverlayCorner;
  /** 'toast' = the short popup after a counter went up: only the recent progress. */
  mode: 'full' | 'toast';
  showProgress: boolean;
  /** null = no game with achievements is running. */
  game: { name: string; unlocked: number; total: number } | null;
  /** Achievements whose counter went up recently, newest first. */
  recent: OverlayAch[];
  pinned: OverlayAch[];
  next: OverlayAch[];
}

export function buildOverlayData(
  game: Game | null,
  list: Achievement[],
  o: OverlaySettings,
  opts: {
    locale: Locale;
    revealHidden: boolean;
    mode?: OverlayData['mode'];
    progress?: Map<string, StatProgress>;
    /** Newest first. */
    bumps?: ProgressBump[];
  },
): OverlayData {
  const mode = opts.mode ?? 'full';
  const bumps = new Map((opts.bumps ?? []).map((b) => [b.apiname, b]));
  const toItem = (a: Achievement): OverlayAch => {
    const b = bumps.get(a.apiname);
    return {
      apiname: a.apiname,
      name: a.name,
      description: a.hidden && !opts.revealHidden ? '' : a.description,
      // Colour icons stay readable over a busy game; the grey ones blend in.
      icon: a.icon || a.icongray,
      percent: a.percent,
      progress: opts.progress?.get(a.apiname) ?? null,
      bump: b ? { delta: b.delta, at: b.at } : null,
    };
  };
  const open = game ? list.filter((a) => !a.achieved && !a.excluded) : [];
  const byName = new Map(open.map((a) => [a.apiname, a]));
  const recent = (opts.bumps ?? []).flatMap((b) => byName.get(b.apiname) ?? []).slice(0, MAX_RECENT);
  // Each achievement shows once: in "recent" when it just moved, otherwise where it belongs.
  const inRecent = new Set(recent.map((a) => a.apiname));
  const rest = mode === 'toast' ? [] : open.filter((a) => !inRecent.has(a.apiname));
  const pinned = o.showPinned ? rest.filter((a) => a.pinned) : [];
  const next = rest
    .filter((a) => !a.pinned && a.percent != null)
    .sort((a, b) => b.percent! - a.percent!)
    .slice(0, Math.max(0, Math.min(MAX_SUGGESTIONS, o.suggestions)));
  return {
    locale: opts.locale,
    corner: o.corner,
    mode,
    showProgress: o.showProgress && mode === 'full',
    game: game ? { name: game.name, unlocked: game.unlocked, total: game.total ?? 0 } : null,
    recent: recent.map(toItem),
    pinned: pinned.map(toItem),
    next: next.map(toItem),
  };
}

/**
 * Notices stat counters going up in the running games. Steam rewrites the stats file when a
 * game stores its stats, and the local sync reads it anyway, so this costs no API call.
 */
export class ProgressTracker {
  private seen = new Map<number, Map<string, number>>();
  private bumps = new Map<number, Map<string, ProgressBump>>();

  /** The first read of a game is only the baseline. Returns what went up since the last read. */
  update(appid: number, progress: Map<string, StatProgress>, now: number): ProgressBump[] {
    const before = this.seen.get(appid);
    this.seen.set(appid, new Map([...progress].map(([name, p]) => [name, p.current])));
    if (!before) return [];
    const list = this.bumps.get(appid) ?? new Map<string, ProgressBump>();
    this.bumps.set(appid, list);
    const out: ProgressBump[] = [];
    for (const [name, p] of progress) {
      const was = before.get(name) ?? 0;
      if (p.current <= was) continue;
      const old = list.get(name);
      const delta = p.current - was + (old && now - old.at < BUNDLE_MS ? old.delta : 0);
      const step = progressStep(p.max);
      const notable = Math.floor(p.current / step) > Math.floor(was / step);
      const bump = { apiname: name, delta, at: now, notable };
      // Re-insert so the map stays ordered by the latest bump.
      list.delete(name);
      list.set(name, bump);
      out.push(bump);
    }
    return out;
  }

  tracks(appid: number): boolean {
    return this.seen.has(appid);
  }

  /** Bumps of this game, newest first. */
  recent(appid: number): ProgressBump[] {
    return [...(this.bumps.get(appid)?.values() ?? [])].reverse();
  }

  forget(appid: number) {
    this.seen.delete(appid);
    this.bumps.delete(appid);
  }
}
