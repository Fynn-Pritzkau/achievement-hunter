import type { Status } from '../types';

export const RECENT_DAYS = 30;

export interface StatusInfo {
  perfect: boolean;
  /** Playtime went up since the last sync. */
  playedAgain: boolean;
  /** Unix seconds. */
  lastPlayed: number;
  /** Days without playing after which "playing" becomes "paused"; 0 = never. */
  staleDays: number;
  /** Unix seconds. */
  now: number;
}

/** Automatic status, ported from the Obsidian plugin. "dropped" is only ever set by the user. */
export function decideStatus(cur: Status | null, info: StatusInfo): Status {
  const { perfect, playedAgain, lastPlayed, staleDays, now } = info;
  if (!cur) {
    if (perfect) return 'completed';
    return lastPlayed && now - lastPlayed < RECENT_DAYS * 86400 ? 'playing' : 'paused';
  }
  if (cur === 'dropped') return cur;
  if (perfect && cur !== 'completed') return 'completed';
  // New achievements after an update: a completed game is no longer complete.
  if (!perfect && cur === 'completed') return playedAgain ? 'playing' : 'paused';
  if (playedAgain && (cur === 'paused' || cur === 'next')) return 'playing';
  if (cur === 'playing' && staleDays > 0 && lastPlayed && now - lastPlayed > staleDays * 86400) return 'paused';
  return cur;
}
