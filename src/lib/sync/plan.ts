import type { Game, OwnedGame } from '../types';
import { DAY_MS } from '../util';

export interface SyncTask {
  appid: number;
  schema: boolean;
  player: boolean;
  global: boolean;
  /** Lower runs first. */
  priority: number;
  reason: 'new' | 'unknown' | 'changed' | 'force' | 'live' | 'local' | 'schemaAge' | 'globalAge' | 'backfill';
}

export interface PlanOptions {
  now: number;
  force?: boolean;
  schemaMaxAgeMs?: number;
  globalMaxAgeMs?: number;
  /** Cap for background refreshes per run (old schemas, old percentages, unplayed games), to spread the load. */
  maxBackgroundTasks?: number;
}

export const SCHEMA_MAX_AGE = 30 * DAY_MS;
export const GLOBAL_MAX_AGE = 7 * DAY_MS;

export function hasChanged(owned: OwnedGame, known: Game): boolean {
  return owned.playtime_forever !== known.playtime || (owned.rtime_last_played ?? 0) !== known.lastPlayed;
}

/**
 * Decides which Steam calls a sync needs, from one GetOwnedGames response.
 * Unchanged games cost nothing; changed games cost one GetPlayerAchievements call.
 * Schemas and global percentages are refreshed only when old, and only a few per run.
 */
export function planSync(owned: OwnedGame[], known: Map<number, Game>, opts: PlanOptions): SyncTask[] {
  const { now, force = false } = opts;
  const schemaMaxAge = opts.schemaMaxAgeMs ?? SCHEMA_MAX_AGE;
  const globalMaxAge = opts.globalMaxAgeMs ?? GLOBAL_MAX_AGE;
  const maxBackground = opts.maxBackgroundTasks ?? 15;

  const urgent: SyncTask[] = [];
  const background: (SyncTask & { age: number })[] = [];

  for (const o of owned) {
    const k = known.get(o.appid);
    // Games we don't own only show up with an unlock, so they were played even if Steam has no playtime.
    const played = o.playtime_forever > 0 || o.owned === false;
    const recency = -(o.rtime_last_played ?? 0); // most recently played first

    if (!k || k.total == null) {
      if (played || force) {
        urgent.push({ appid: o.appid, schema: true, player: true, global: true, priority: recency, reason: k ? 'unknown' : 'new' });
      } else {
        // Unplayed: we only want to know how many achievements it has. Low priority,
        // ranked like a schema that just expired so old played games still get their turn.
        background.push({ appid: o.appid, schema: true, player: false, global: false, priority: 0, reason: 'backfill', age: schemaMaxAge });
      }
      continue;
    }

    const schemaAge = now - (k.schemaFetchedAt ?? 0);
    const globalAge = now - (k.globalFetchedAt ?? 0);

    if (force) {
      if (played || k.total > 0) {
        urgent.push({ appid: o.appid, schema: true, player: played, global: played, priority: recency, reason: 'force' });
      }
      continue;
    }

    if (k.total > 0 && (hasChanged(o, k) || (played && k.playerFetchedAt == null))) {
      urgent.push({
        appid: o.appid,
        schema: false,
        player: true,
        global: globalAge > globalMaxAge,
        priority: recency,
        reason: 'changed',
      });
      continue;
    }

    // Games can get achievements later, or new ones in an update.
    if (schemaAge > schemaMaxAge && (played || k.total > 0)) {
      background.push({ appid: o.appid, schema: true, player: played, global: played, priority: 0, reason: 'schemaAge', age: schemaAge });
    } else if (played && k.total > 0 && globalAge > globalMaxAge && k.unlocked < k.total) {
      // Percentages only matter while something is still open.
      background.push({ appid: o.appid, schema: false, player: false, global: true, priority: 0, reason: 'globalAge', age: globalAge });
    }
  }

  urgent.sort((a, b) => a.priority - b.priority);
  background.sort((a, b) => b.age - a.age);
  const bg = background.slice(0, maxBackground).map(({ age: _age, ...t }, i) => ({ ...t, priority: 1e12 + i }));
  return [...urgent, ...bg];
}
