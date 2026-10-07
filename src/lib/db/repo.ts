import type { Achievement, Game, Snapshot } from '../types';
import { dayKey } from '../util';

const copy = (a: Achievement): Achievement => ({
  ...a,
  tags: [...a.tags],
  ...(a.manualTags && { manualTags: [...a.manualTags] }),
});

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
  /** Pinned achievements that are still open (and not excluded), across all visible games. */
  getPinnedOpen(): Promise<UnlockRow[]>;
  /**
   * Achievements of visible games whose name, note or description contains `q` (case-insensitive),
   * open ones first. Descriptions of hidden, locked achievements only match with `revealHidden`.
   */
  searchAchievements(q: string, limit: number, revealHidden: boolean): Promise<UnlockRow[]>;
  addSnapshots(snapshots: Snapshot[]): Promise<void>;
  /** Snapshots since a day; with `appid` only that game's, oldest first. */
  getSnapshots(sinceDay: string, appid?: number): Promise<Snapshot[]>;
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
    return (this.achievements.get(appid) ?? []).map(copy);
  }
  async saveAchievements(appid: number, list: Achievement[]) {
    this.achievements.set(appid, list.map(copy));
  }
  /** Achievements of visible games that pass `keep`, most recently played game first. */
  private visible(keep: (a: Achievement) => boolean): UnlockRow[] {
    const out: { row: UnlockRow; lastPlayed: number }[] = [];
    for (const [appid, list] of this.achievements) {
      const g = this.games.get(appid);
      if (!g || g.hidden) continue;
      for (const a of list) if (keep(a)) out.push({ row: { ...copy(a), appid, gameName: g.name }, lastPlayed: g.lastPlayed });
    }
    return out.sort((a, b) => b.lastPlayed - a.lastPlayed).map((x) => x.row);
  }
  private visibleUnlocks(): UnlockRow[] {
    return this.visible((a) => a.achieved && a.unlocktime > 0);
  }
  async getPinnedOpen() {
    return this.visible((a) => a.pinned && !a.achieved && !a.excluded);
  }
  async searchAchievements(q: string, limit: number, revealHidden: boolean) {
    const needle = q.toLowerCase();
    const has = (s: string) => s.toLowerCase().includes(needle);
    return this.visible((a) => has(a.name) || has(a.note) || ((!a.hidden || a.achieved || revealHidden) && has(a.description)))
      .sort((a, b) => Number(a.achieved) - Number(b.achieved))
      .slice(0, limit);
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
  async getSnapshots(sinceDay: string, appid?: number) {
    const out = this.snapshots.filter((s) => s.date >= sinceDay && (appid == null || s.appid === appid));
    return appid == null ? out : out.sort((a, b) => a.date.localeCompare(b.date));
  }
  async getMeta(key: string) {
    return this.meta.get(key) ?? null;
  }
  async setMeta(key: string, value: string) {
    this.meta.set(key, value);
  }
}
