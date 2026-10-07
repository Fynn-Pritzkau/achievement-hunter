import type { LocalGame, LocalPlaytime, LocalSteam } from '../lib/steam/local';
import type { FakeAchMeta } from './fakeSteam';

export interface FakeLocalGame {
  name?: string;
  /** Unix seconds. */
  schemaMtime: number;
  /** Unix seconds, null = no stats file. */
  statsMtime: number | null;
  languageMatch?: boolean;
  /** apiname → [unlocked, unlocktime] */
  achievements: Record<string, [boolean, number]>;
  /** apiname → [current, max] for stat-counted achievements. */
  progress?: Record<string, [number, number]>;
  /** apiname → display texts and icons. Without them: "A" / "Do a". */
  meta?: Record<string, FakeAchMeta>;
  hidden?: string[];
}

/** Stand-in for Steam's local cache. Counts reads. Shared by the tests and the browser mock mode. */
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
      name: g.name ?? '',
      schemaMtime: g.schemaMtime,
      statsMtime: g.statsMtime,
      languageMatch: g.languageMatch ?? true,
      achievements: Object.entries(g.achievements).map(([n, [ok, t]]) => {
        const m = g.meta?.[n];
        return {
          apiname: n,
          name: m?.name ?? n.toUpperCase(),
          description: m?.description ?? `Do ${n}`,
          hidden: !!g.hidden?.includes(n),
          icon: m?.icon ?? '',
          icongray: m?.icongray ?? '',
          achieved: ok,
          unlocktime: ok ? t : 0,
          progress: g.progress?.[n] ? { current: g.progress[n][0], max: g.progress[n][1] } : null,
        };
      }),
    };
  }

  async playtimes() {
    return [...this.times.values()];
  }

  async changedSince(since: number) {
    return [...this.games].filter(([, g]) => (g.statsMtime ?? 0) > since).map(([id]) => id);
  }
}
