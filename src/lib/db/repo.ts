import type { Achievement, Game, Snapshot } from '../types';
import { dayKey } from '../util';

export type UnlockRow = Achievement & { appid: number; gameName: string };

/** Storage used by the sync engine and the UI. SQLite in the app, in-memory in tests. */
export interface Repo {
  getGames(): Promise<Game[]>;
  getGame(appid: number): Promise<Game | null>;
  saveGame(game: Game): Promise<void>;
  saveGames(games: Game[]): Promise<void>;
  getAchievements(appid: number): Promise<Achievement[]>;
  /** Replaces the full achievement list of one game. */
  saveAchievements(appid: number, list: Achievement[]): Promise<void>;
  /** Unlocks across all visible games, newest first. Page with `before` = the last unlocktime seen. */
  getUnlocks(page: { before?: number; limit: number }): Promise<UnlockRow[]>;
  /** Number of unlocks per local calendar day (YYYY-MM-DD) since `sinceUnix`, visible games only. */
  unlocksPerDay(sinceUnix: number): Promise<{ day: string; n: number }[]>;
  addSnapshots(snapshots: Snapshot[]): Promise<void>;
  getSnapshots(sinceDay: string): Promise<Snapshot[]>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
}

export class MemoryRepo implements Repo {
  games = new Map<number, Game>();
  achievements = new Map<number, Achievement[]>();
  snapshots: Snapshot[] = [];
  meta = new Map<string, string>();

  async getGames() {
    return [...this.games.values()].map((g) => ({ ...g }));
  }
  async getGame(appid: number) {
    const g = this.games.get(appid);
    return g ? { ...g } : null;
  }
  async saveGame(game: Game) {
    this.games.set(game.appid, { ...game });
  }
  async saveGames(games: Game[]) {
    for (const g of games) this.games.set(g.appid, { ...g });
  }
  async getAchievements(appid: number) {
    return (this.achievements.get(appid) ?? []).map((a) => ({ ...a, tags: [...a.tags] }));
  }
  async saveAchievements(appid: number, list: Achievement[]) {
    this.achievements.set(appid, list.map((a) => ({ ...a, tags: [...a.tags] })));
  }
  private visibleUnlocks(): UnlockRow[] {
    const out: UnlockRow[] = [];
    for (const [appid, list] of this.achievements) {
      const g = this.games.get(appid);
      if (!g || g.hidden) continue;
      for (const a of list) if (a.achieved && a.unlocktime > 0) out.push({ ...a, tags: [...a.tags], appid, gameName: g.name });
    }
    return out;
  }
  async getUnlocks({ before, limit }: { before?: number; limit: number }) {
    return this.visibleUnlocks()
      .filter((a) => before == null || a.unlocktime < before)
      .sort((a, b) => b.unlocktime - a.unlocktime)
      .slice(0, limit);
  }
  async unlocksPerDay(sinceUnix: number) {
    const days = new Map<string, number>();
    for (const a of this.visibleUnlocks()) {
      if (a.unlocktime < sinceUnix) continue;
      const day = dayKey(a.unlocktime * 1000);
      days.set(day, (days.get(day) ?? 0) + 1);
    }
    return [...days].map(([day, n]) => ({ day, n }));
  }
  async addSnapshots(snapshots: Snapshot[]) {
    for (const s of snapshots) {
      const i = this.snapshots.findIndex((x) => x.date === s.date && x.appid === s.appid);
      if (i >= 0) this.snapshots[i] = s;
      else this.snapshots.push(s);
    }
  }
  async getSnapshots(sinceDay: string) {
    return this.snapshots.filter((s) => s.date >= sinceDay);
  }
  async getMeta(key: string) {
    return this.meta.get(key) ?? null;
  }
  async setMeta(key: string, value: string) {
    this.meta.set(key, value);
  }
}
