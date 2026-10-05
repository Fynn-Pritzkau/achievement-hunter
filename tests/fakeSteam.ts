import { Limiter } from '../src/lib/steam/limiter';
import { SteamApi } from '../src/lib/steam/api';

export interface FakeGame {
  appid: number;
  name: string;
  playtime: number;
  lastPlayed: number;
  /** apiname → [unlocked, unlocktime, globalPercent] */
  achievements: Record<string, [boolean, number, number]>;
  /** Make GetSchemaForGame fail for this game. */
  schemaFails?: boolean;
}

/** A tiny in-memory Steam Web API. Counts calls per endpoint. */
export class FakeSteam {
  games = new Map<number, FakeGame>();
  calls: string[] = [];
  privateProfile = false;
  rateLimitNext = 0;

  add(g: FakeGame) {
    this.games.set(g.appid, g);
    return g;
  }

  count(endpoint?: string) {
    return endpoint ? this.calls.filter((c) => c.includes(endpoint)).length : this.calls.length;
  }

  fetch = async (url: string): Promise<Response> => {
    const u = new URL(url);
    const path = u.pathname;
    this.calls.push(path);
    if (this.rateLimitNext > 0) {
      this.rateLimitNext--;
      return new Response('Too Many Requests', { status: 429 });
    }
    const appid = Number(u.searchParams.get('appid') ?? u.searchParams.get('gameid'));
    const g = this.games.get(appid);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (path.includes('GetOwnedGames')) {
      if (this.privateProfile) return json({ response: {} });
      return json({
        response: {
          game_count: this.games.size,
          games: [...this.games.values()].map((x) => ({
            appid: x.appid,
            name: x.name,
            playtime_forever: x.playtime,
            rtime_last_played: x.lastPlayed,
          })),
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
            achievements: names.map((n) => ({ name: n, displayName: n.toUpperCase(), description: `Do ${n}`, hidden: 0, icon: '', icongray: '' })),
          },
        },
      });
    }
    if (path.includes('GetPlayerAchievements')) {
      if (this.privateProfile) return json({ playerstats: { error: 'Profile is not public', success: false } }, 403);
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
