import type { OwnedGame, PlayerAchievement, SchemaAchievement } from '../types';
import { oneLine } from '../util';
import { Limiter, withRetry } from './limiter';

export type SteamErrorKind = 'auth' | 'private' | 'notFound' | 'rate' | 'server' | 'http' | 'network' | 'parse';

export class SteamApiError extends Error {
  constructor(
    public kind: SteamErrorKind,
    message: string,
    public status = 0,
    public retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'SteamApiError';
  }
}

/** Errors after which continuing the sync makes no sense (or would only add load). */
export function isFatal(e: unknown): boolean {
  return e instanceof SteamApiError && (e.kind === 'auth' || e.kind === 'private' || e.kind === 'rate');
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface SteamApiOptions {
  apiKey: string;
  /** https://api.steampowered.com, or a dev proxy path. */
  baseUrl?: string;
  /** Steam language name for names/descriptions, e.g. "german", "english". */
  language?: string;
  fetch?: FetchFn;
  limiter?: Limiter;
  retries?: number;
  retryBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called for every HTTP request — handy for counting calls. */
  onRequest?: (path: string) => void;
}

export class SteamApi {
  private readonly base: string;
  private readonly fetchFn: FetchFn;
  private readonly limiter: Limiter;

  constructor(private opts: SteamApiOptions) {
    this.base = (opts.baseUrl ?? 'https://api.steampowered.com').replace(/\/$/, '');
    this.fetchFn = opts.fetch ?? ((u, i) => fetch(u, i));
    this.limiter = opts.limiter ?? new Limiter({ concurrency: 3, minIntervalMs: 120 });
  }

  get language(): string {
    return this.opts.language ?? 'english';
  }

  /** One GET with rate limiting and retries for 429/5xx/network errors. Returns parsed JSON. */
  async call(path: string, params: Record<string, string | number>): Promise<any> {
    const qs = new URLSearchParams({ key: this.opts.apiKey, format: 'json' });
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    const url = `${this.base}/${path}/?${qs}`;

    return withRetry(() => this.limiter.run(() => this.request(path, url)), {
      retries: this.opts.retries ?? 3,
      baseDelayMs: this.opts.retryBaseMs ?? 2000,
      sleep: this.opts.sleep,
      retryable: (e) =>
        e instanceof SteamApiError && (e.kind === 'rate' || e.kind === 'server' || e.kind === 'network'),
      delayHint: (e) => (e instanceof SteamApiError ? e.retryAfterMs : null),
    });
  }

  private async request(path: string, url: string): Promise<any> {
    this.opts.onRequest?.(path);
    let res: Response;
    try {
      res = await this.fetchFn(url);
    } catch (e) {
      throw new SteamApiError('network', `Network error: ${(e as Error)?.message ?? e}`);
    }
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      throw new SteamApiError('rate', 'Steam rate limit reached', 429, ra > 0 ? ra * 1000 : null);
    }
    if (res.status === 401) throw new SteamApiError('auth', 'Invalid Steam API key', 401);
    if (res.status >= 500) throw new SteamApiError('server', `Steam server error ${res.status}`, res.status);
    // 400/403 often still carry a JSON body (e.g. "Profile is not public"), so parse first.
    let json: any;
    try {
      json = await res.json();
    } catch {
      if (res.status === 403) throw new SteamApiError('auth', 'Access denied (API key?)', 403);
      throw new SteamApiError(res.ok ? 'parse' : 'http', `Unexpected response (${res.status})`, res.status);
    }
    if (!res.ok && res.status !== 400 && res.status !== 403) {
      throw new SteamApiError('http', `HTTP ${res.status}`, res.status);
    }
    if (res.status === 403 && !json?.playerstats) {
      throw new SteamApiError('auth', 'Access denied (API key?)', 403);
    }
    return json;
  }

  /** Accepts a 17-digit ID, a profile URL or a custom URL name. */
  async resolveSteamId(input: string): Promise<string> {
    const trimmed = input.trim();
    if (/^\d{17}$/.test(trimmed)) return trimmed;
    const m = trimmed.match(/steamcommunity\.com\/(id|profiles)\/([^/?#]+)/);
    if (m && m[1] === 'profiles') return m[2];
    const vanity = m ? m[2] : trimmed;
    const json = await this.call('ISteamUser/ResolveVanityURL/v0001', { vanityurl: vanity });
    if (json?.response?.success === 1) return json.response.steamid;
    throw new SteamApiError('notFound', `Steam profile "${vanity}" not found`);
  }

  async getOwnedGames(steamid: string): Promise<OwnedGame[]> {
    const json = await this.call('IPlayerService/GetOwnedGames/v0001', {
      steamid,
      include_appinfo: 1,
      include_played_free_games: 1,
    });
    const resp = json?.response;
    if (!resp) throw new SteamApiError('parse', 'GetOwnedGames: empty response');
    // An empty `response` object means the game list is private.
    if (!resp.games) {
      if (resp.game_count === 0) return [];
      throw new SteamApiError('private', 'Game details are private — set them to public in your Steam privacy settings');
    }
    return resp.games;
  }

  /**
   * The achievement list of a game. Returns [] only when Steam says the game has
   * none; any failure throws, so the caller never mistakes an error for "no achievements".
   */
  async getSchema(appid: number): Promise<SchemaAchievement[]> {
    const json = await this.call('ISteamUserStats/GetSchemaForGame/v2', { appid, l: this.language });
    if (!json || typeof json.game !== 'object') {
      throw new SteamApiError('parse', `GetSchemaForGame ${appid}: unexpected response`);
    }
    const list: any[] = json.game.availableGameStats?.achievements ?? [];
    return list.map((s) => ({
      apiname: s.name,
      name: oneLine(s.displayName || s.name),
      description: oneLine(s.description),
      hidden: s.hidden === 1,
      icon: s.icon ?? '',
      icongray: s.icongray ?? '',
    }));
  }

  /**
   * apiname → description, including hidden achievements, which GetSchemaForGame
   * returns without one.
   */
  async getDescriptions(appid: number): Promise<Map<string, string>> {
    const json = await this.call('IPlayerService/GetGameAchievements/v1', { appid, language: this.language });
    const resp = json?.response;
    if (!resp || typeof resp !== 'object') throw new SteamApiError('parse', `GetGameAchievements ${appid}: unexpected response`);
    const list: any[] = resp.achievements ?? [];
    return new Map(list.filter((a) => a.internal_name && a.localized_desc).map((a) => [a.internal_name, oneLine(a.localized_desc)]));
  }

  /** null = the game has no stats at all. */
  async getPlayerAchievements(appid: number, steamid: string): Promise<PlayerAchievement[] | null> {
    const json = await this.call('ISteamUserStats/GetPlayerAchievements/v0001', { appid, steamid });
    const ps = json?.playerstats;
    if (!ps) throw new SteamApiError('parse', `GetPlayerAchievements ${appid}: unexpected response`);
    if (ps.success === false) {
      const err = String(ps.error ?? '');
      if (/not public/i.test(err)) {
        throw new SteamApiError('private', 'Your achievements are private — set game details to public in Steam');
      }
      if (/no stats/i.test(err)) return null;
      throw new SteamApiError('http', `GetPlayerAchievements ${appid}: ${err || 'failed'}`);
    }
    return (ps.achievements ?? []).map((a: any) => ({
      apiname: a.apiname,
      achieved: a.achieved === 1,
      unlocktime: a.unlocktime || 0,
    }));
  }

  /** apiname → percent of players who have it. */
  async getGlobalPercentages(appid: number): Promise<Map<string, number>> {
    const json = await this.call('ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002', { gameid: appid });
    const list: any[] = json?.achievementpercentages?.achievements;
    if (!Array.isArray(list)) throw new SteamApiError('parse', `Global percentages ${appid}: unexpected response`);
    return new Map(list.map((a) => [a.name, Number(a.percent)]));
  }

  async getCurrentPlayers(appid: number): Promise<number | null> {
    const json = await this.call('ISteamUserStats/GetNumberOfCurrentPlayers/v1', { appid });
    return json?.response?.result === 1 ? Number(json.response.player_count) : null;
  }
}
