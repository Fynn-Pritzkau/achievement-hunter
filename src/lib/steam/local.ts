import type { PlayerAchievement, SchemaAchievement } from '../types';

/** One game as Steam keeps it on disk: schema and progress in one read. */
export interface LocalGame {
  /** Unix seconds when Steam last wrote the schema file. */
  schemaMtime: number;
  /** Unix seconds when Steam last wrote the user's stats, null = no stats file. */
  statsMtime: number | null;
  /** Names and descriptions are in the requested language. */
  languageMatch: boolean;
  achievements: (SchemaAchievement & PlayerAchievement & { progress?: StatProgress | null })[];
}

/** How far an open achievement is that Steam counts with a stat ("37 / 50"). Only in the local cache. */
export interface StatProgress {
  current: number;
  max: number;
}

export interface LocalPlaytime {
  appid: number;
  /** Minutes. Only written when a session ends, so it can lag behind the Web API. */
  playtime: number;
  /** Unix seconds. */
  lastPlayed: number;
}

/**
 * Read-only view of the Steam client's local cache. Costs no API call.
 * Every method resolves to empty/null instead of throwing when Steam or a file is missing.
 */
export interface LocalSteam {
  game(appid: number): Promise<LocalGame | null>;
  playtimes(): Promise<LocalPlaytime[]>;
  /** AppIDs whose stats file Steam wrote after `sinceUnix`. */
  changedSince(sinceUnix: number): Promise<number[]>;
}

const STEAMID64_BASE = 76561197960265728n;

export function accountIdOf(steamid64: string): number {
  return Number(BigInt(steamid64) - STEAMID64_BASE);
}

/** The cache stores bare file names; the Web API returns full URLs. Same CDN path. */
export function iconUrl(appid: number, file: string): string {
  if (!file || /^https?:/.test(file)) return file;
  return `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appid}/${file}`;
}

type Invoke = <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;

export function tauriLocalSteam(invoke: Invoke, steamid64: string, language: string): LocalSteam {
  const accountId = accountIdOf(steamid64);
  return {
    async game(appid) {
      const g = await invoke<LocalGame | null>('local_achievements', { accountId, appid, language }).catch(() => null);
      if (!g) return null;
      for (const a of g.achievements) {
        a.icon = iconUrl(appid, a.icon);
        a.icongray = iconUrl(appid, a.icongray);
      }
      return g;
    },
    playtimes: () => invoke<LocalPlaytime[]>('local_playtimes', { accountId }).catch(() => []),
    changedSince: (since) => invoke<number[]>('local_stats_changed', { accountId, since }).catch(() => []),
  };
}
