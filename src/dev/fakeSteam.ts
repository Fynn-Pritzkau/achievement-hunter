import { Limiter } from '../lib/steam/limiter';
import { SteamApi } from '../lib/steam/api';

/** Display texts of one achievement. Without them the fake uses "A" / "Do a". */
export interface FakeAchMeta {
  name: string;
  description: string;
  icon?: string;
  icongray?: string;
}

export interface FakeGame {
  appid: number;
  name: string;
  playtime: number;
  lastPlayed: number;
  /** apiname → [unlocked, unlocktime, globalPercent] */
  achievements: Record<string, [boolean, number, number]>;
  /** apiname → display texts and icons. */
  meta?: Record<string, FakeAchMeta>;
  /** Make GetSchemaForGame fail for this game. */
  schemaFails?: boolean;
  /** Hidden achievements: GetSchemaForGame returns them without a description. */
  hidden?: string[];
  /** Make GetGameAchievements fail for this game. */
  descriptionsFail?: boolean;
  /** Played (family sharing, free weekend …) but left out of GetOwnedGames. */
  notOwned?: boolean;
  /** GetPlayerAchievements says "Profile is not public" for this game only. */
  playerPrivate?: boolean;
}

/**
 * A tiny in-memory Steam Web API. Counts calls per endpoint. Used by the tests and by the
 * browser mock mode (`?mock`), so both exercise the real SteamApi and SyncEngine.
 */
export class FakeSteam {
  games = new Map<number, FakeGame>();
  calls: string[] = [];
  privateProfile = false;
  /** GetOwnedGames answers with an empty response this many times, as Steam does when busy. */
  emptyOwnedNext = 0;
  rateLimitNext = 0;
  /** The next requests fail with a 503. */
  serverErrorNext = 0;
  /** Requests with this key get a 401. */
  badKey: string | null = null;
  /** Delay of every answer, for watching progress and loading states. */
  latencyMs = 0;
  /** The account ResolveVanityURL answers with. */
  steamid = '76561198000000000';
  /** Called for every request, after it was counted. */
  onCall?: (call: string) => void;

  add(g: FakeGame) {
    this.games.set(g.appid, g);
    return g;
  }

  count(endpoint?: string) {
    return endpoint ? this.calls.filter((c) => c.includes(endpoint)).length : this.calls.length;
  }

  fetch = async (url: string): Promise<Response> => {
    const u = new URL(url, 'http://fake');
    const path = u.pathname;
    const appid = Number(u.searchParams.get('appid') ?? u.searchParams.get('gameid'));
    const call = appid ? `${path}?appid=${appid}` : path;
    this.calls.push(call);
    this.onCall?.(call);
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.rateLimitNext > 0) {
      this.rateLimitNext--;
      return new Response('Too Many Requests', { status: 429 });
    }
    if (this.serverErrorNext > 0) {
      this.serverErrorNext--;
      return new Response('Service Unavailable', { status: 503 });
    }
    if (this.badKey != null && u.searchParams.get('key') === this.badKey) {
      return new Response('<html>Unauthorized</html>', { status: 401 });
    }
    const g = this.games.get(appid);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const text = (n: string) => g?.meta?.[n] ?? { name: n.toUpperCase(), description: `Do ${n}` };

    if (path.includes('ResolveVanityURL')) {
      const vanity = u.searchParams.get('vanityurl') ?? '';
      return json({ response: vanity && !/unknown/i.test(vanity) ? { success: 1, steamid: this.steamid } : { success: 42, message: 'No match' } });
    }
    if (path.includes('GetOwnedGames')) {
      if (this.privateProfile) return json({ response: {} });
      if (this.emptyOwnedNext > 0) {
        this.emptyOwnedNext--;
        return json({ response: {} });
      }
      const owned = [...this.games.values()].filter((x) => !x.notOwned);
      return json({
        response: {
          game_count: owned.length,
          ...(owned.length
            ? {
                games: owned.map((x) => ({
                  appid: x.appid,
                  name: x.name,
                  playtime_forever: x.playtime,
                  rtime_last_played: x.lastPlayed,
                })),
              }
            : {}),
        },
      });
    }
    if (path.includes('GetSchemaForGame')) {
      if (!g || g.schemaFails) return new Response('Internal Server Error', { status: 500 });
      const names = Object.keys(g.achievements);
      if (!names.length) return json({ game: {} });
      return json({
        game: {
          gameName: g.name,
          availableGameStats: {
            achievements: names.map((n) => {
              const hidden = !!g.hidden?.includes(n);
              const m = text(n);
              return {
                name: n,
                displayName: m.name,
                ...(hidden ? {} : { description: m.description }),
                hidden: hidden ? 1 : 0,
                icon: m.icon ?? '',
                icongray: m.icongray ?? '',
              };
            }),
          },
        },
      });
    }
    if (path.includes('GetGameAchievements')) {
      if (!g || g.descriptionsFail) return new Response('Internal Server Error', { status: 500 });
      const names = Object.keys(g.achievements);
      if (!names.length) return json({ response: {} });
      return json({
        response: {
          achievements: names.map((n) => ({
            internal_name: n,
            localized_name: text(n).name,
            localized_desc: text(n).description,
            hidden: !!g.hidden?.includes(n),
          })),
        },
      });
    }
    if (path.includes('GetPlayerAchievements')) {
      if (this.privateProfile || g?.playerPrivate) return json({ playerstats: { error: 'Profile is not public', success: false } }, 403);
      if (!g || !Object.keys(g.achievements).length) {
        return json({ playerstats: { error: 'Requested app has no stats', success: false } }, 400);
      }
      return json({
        playerstats: {
          success: true,
          achievements: Object.entries(g.achievements).map(([n, [ok, t]]) => ({ apiname: n, achieved: ok ? 1 : 0, unlocktime: ok ? t : 0 })),
        },
      });
    }
    if (path.includes('GetGlobalAchievementPercentagesForApp')) {
      return json({
        achievementpercentages: {
          achievements: Object.entries(g?.achievements ?? {}).map(([n, [, , p]]) => ({ name: n, percent: String(p) })),
        },
      });
    }
    if (path.includes('GetNumberOfCurrentPlayers')) {
      return json({ response: g ? { result: 1, player_count: (appid * 7919) % 50_000 } : { result: 42 } });
    }
    return new Response('not found', { status: 404 });
  };

  api() {
    return new SteamApi({
      apiKey: 'test',
      fetch: this.fetch,
      limiter: new Limiter({ concurrency: 3, minIntervalMs: 0 }),
      retries: 2,
      sleep: async () => {},
    });
  }
}
