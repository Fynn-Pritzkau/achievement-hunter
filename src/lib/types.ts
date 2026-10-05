export type Status = 'next' | 'playing' | 'paused' | 'completed' | 'dropped';

export const STATUSES: Status[] = ['next', 'playing', 'paused', 'completed', 'dropped'];

/** One entry of GetOwnedGames. */
export interface OwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;
  rtime_last_played?: number;
  img_icon_url?: string;
}

/** One achievement as described by GetSchemaForGame. */
export interface SchemaAchievement {
  apiname: string;
  name: string;
  description: string;
  hidden: boolean;
  icon: string;
  icongray: string;
}

/** The player's progress on one achievement (GetPlayerAchievements). */
export interface PlayerAchievement {
  apiname: string;
  achieved: boolean;
  unlocktime: number;
}

/** Everything the app knows about one achievement, including what the user added. */
export interface Achievement extends SchemaAchievement {
  achieved: boolean;
  unlocktime: number;
  /** Global unlock rate in percent, null when Steam has no data. */
  percent: number | null;
  pinned: boolean;
  /** Broken / unobtainable — can be left out of the completion. */
  excluded: boolean;
  note: string;
  tags: string[];
}

export interface Game {
  appid: number;
  name: string;
  /** Minutes, as reported by Steam. */
  playtime: number;
  /** Unix seconds, 0 = never. */
  lastPlayed: number;
  iconHash: string;
  status: Status | null;
  /** The user picked the status; the sync no longer changes it. */
  statusManual: boolean;
  unlocked: number;
  /** null = not known yet (never fetched, or the last fetch failed). 0 = game has no achievements. */
  total: number | null;
  /** Unix ms of the last successful fetch, null = never. */
  schemaFetchedAt: number | null;
  playerFetchedAt: number | null;
  globalFetchedAt: number | null;
  /** The game was at 100 % once. */
  wasPerfect: boolean;
  hidden: boolean;
  pinned: boolean;
  // Aggregates, kept up to date by the sync so lists don't need every achievement in memory.
  /** Open achievements that more than 50 % of players have. */
  easyOpen: number;
  /** Sum of 100/percent over the open achievements: a rough "how much work is left". */
  effort: number;
  /** Lowest global percent among the open achievements. */
  rarestOpen: number | null;
  /** Sum of 100/percent over the unlocked achievements. */
  rarityScore: number;
  /** Unix seconds of the newest unlock, 0 = none. */
  lastUnlock: number;
}

export interface Snapshot {
  /** YYYY-MM-DD */
  date: string;
  appid: number;
  playtime: number;
  unlocked: number;
}

export function emptyGame(appid: number, name: string): Game {
  return {
    appid,
    name,
    playtime: 0,
    lastPlayed: 0,
    iconHash: '',
    status: null,
    statusManual: false,
    unlocked: 0,
    total: null,
    schemaFetchedAt: null,
    playerFetchedAt: null,
    globalFetchedAt: null,
    wasPerfect: false,
    hidden: false,
    pinned: false,
    easyOpen: 0,
    effort: 0,
    rarestOpen: null,
    rarityScore: 0,
    lastUnlock: 0,
  };
}

export function isPerfect(g: Pick<Game, 'unlocked' | 'total'>): boolean {
  return !!g.total && g.unlocked >= g.total;
}

/** Completion in percent (0–100), null for games without (known) achievements. */
export function completion(g: Pick<Game, 'unlocked' | 'total'>): number | null {
  return g.total ? (g.unlocked / g.total) * 100 : null;
}
