import type { LocalGame, LocalPlaytime, LocalSteam } from '../src/lib/steam/local';

export interface FakeLocalGame {
  /** Unix seconds. */
  schemaMtime: number;
  /** Unix seconds, null = no stats file. */
  statsMtime: number | null;
  languageMatch?: boolean;
  /** apiname → [unlocked, unlocktime] */
  achievements: Record<string, [boolean, number]>;
}

/** Stand-in for Steam's local cache. Counts reads. */
export class FakeLocal implements LocalSteam {
  games = new Map<number, FakeLocalGame>();
  times = new Map<number, LocalPlaytime>();
  reads = 0;

  set(appid: number, g: FakeLocalGame) {
    this.games.set(appid, g);
    return g;
  }

  async game(appid: number): Promise<LocalGame | null> {
    this.reads++;
    const g = this.games.get(appid);
    if (!g) return null;
    return {
      schemaMtime: g.schemaMtime,
      statsMtime: g.statsMtime,
      languageMatch: g.languageMatch ?? true,
      achievements: Object.entries(g.achievements).map(([n, [ok, t]]) => ({
        apiname: n,
        name: n.toUpperCase(),
        description: `Do ${n}`,
        hidden: false,
        icon: '',
        icongray: '',
        achieved: ok,
        unlocktime: ok ? t : 0,
      })),
    };
  }

  async playtimes() {
    return [...this.times.values()];
  }

  async changedSince(since: number) {
    return [...this.games].filter(([, g]) => (g.statsMtime ?? 0) > since).map(([id]) => id);
  }
}
