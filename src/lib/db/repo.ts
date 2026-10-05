import type { Achievement, Game, Snapshot } from '../types';

/** Storage used by the sync engine and the UI. SQLite in the app, in-memory in tests. */
export interface Repo {
  getGames(): Promise<Game[]>;
  getGame(appid: number): Promise<Game | null>;
  saveGame(game: Game): Promise<void>;
  saveGames(games: Game[]): Promise<void>;
  getAchievements(appid: number): Promise<Achievement[]>;
  /** Replaces the full achievement list of one game. */
  saveAchievements(appid: number, list: Achievement[]): Promise<void>;
  /** Newest unlocks across all games, for the "recently unlocked" view and stats. */
  getUnlocks(sinceUnix: number): Promise<(Achievement & { appid: number })[]>;
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
  async getUnlocks(sinceUnix: number) {
    const out: (Achievement & { appid: number })[] = [];
    for (const [appid, list] of this.achievements) {
      for (const a of list) if (a.achieved && a.unlocktime >= sinceUnix) out.push({ ...a, appid });
    }
    return out.sort((a, b) => b.unlocktime - a.unlocktime);
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
