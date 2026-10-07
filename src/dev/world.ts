/**
 * The mock mode's Steam: a fake Web API and a fake local cache that always agree, like the real
 * client and servers. Actions change both the way Steam would (unlocks, stat counters, sessions,
 * playing on another PC, game updates), so the real SyncEngine and Scheduler pick them up.
 */
import { progressStep } from '../lib/overlay';
import { FakeLocal } from './fakeLocal';
import { FakeSteam, type FakeGame } from './fakeSteam';
import { badge, buildLibrary, type FixtureGame } from './fixtures';

export type Scenario = 'library' | 'fresh' | 'nolocal' | 'empty' | 'private';
export const SCENARIOS: Scenario[] = ['library', 'fresh', 'nolocal', 'empty', 'private'];

export interface MockNotification {
  at: number;
  title: string;
  body: string;
}

const nowSec = () => Math.floor(Date.now() / 1000);

export class MockWorld {
  readonly steam = new FakeSteam();
  readonly local: FakeLocal | null;
  readonly fixtures: FixtureGame[];
  running: number[] = [];
  /** Game in the foreground window, for the overlay's focus detection. */
  foreground: number | null = null;
  notifications: MockNotification[] = [];
  trayLabels: [string, string] = ['', ''];
  private sessionStart = new Map<number, number>();
  private listeners = new Set<() => void>();

  constructor(readonly scenario: Scenario) {
    this.local = scenario === 'nolocal' ? null : new FakeLocal();
    this.steam.badKey = 'bad';
    this.steam.latencyMs = 25;
    this.steam.privateProfile = scenario === 'private';
    this.steam.onCall = () => this.changed();
    this.fixtures = scenario === 'empty' ? [] : buildLibrary(nowSec());
    for (const f of this.fixtures) this.load(f);
  }

  /** Re-renders the dev panel. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed() {
    for (const fn of this.listeners) fn();
  }

  private load(f: FixtureGame) {
    const s: FakeGame = {
      appid: f.appid,
      name: f.name,
      playtime: f.playtime,
      lastPlayed: f.lastPlayed,
      achievements: Object.fromEntries(f.achievements.map((a) => [a.apiname, [a.unlocked, a.unlocktime, a.percent]])),
      meta: Object.fromEntries(f.achievements.map((a) => [a.apiname, a.meta])),
      hidden: f.achievements.filter((a) => a.hidden).map((a) => a.apiname),
      notOwned: f.notOwned,
      playerPrivate: f.playerPrivate,
    };
    this.steam.add(s);
    // Steam only keeps a stats file for games that were played and have stats.
    if (!this.local || !f.lastPlayed || !f.achievements.length) return;
    this.local.set(f.appid, {
      name: f.name,
      schemaMtime: f.lastPlayed - 3600,
      statsMtime: f.lastPlayed,
      achievements: Object.fromEntries(f.achievements.map((a) => [a.apiname, [a.unlocked, a.unlocktime]])),
      progress: Object.fromEntries(f.achievements.filter((a) => a.progress).map((a) => [a.apiname, a.progress!])),
      meta: s.meta,
      hidden: s.hidden,
    });
    this.local.times.set(f.appid, { appid: f.appid, playtime: f.playtime, lastPlayed: f.lastPlayed });
  }

  game(appid: number): FakeGame | undefined {
    return this.steam.games.get(appid);
  }

  /** Games with achievements, for pickers. */
  get games(): FakeGame[] {
    return [...this.steam.games.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Open achievements of a game, those with a stat counter last. */
  open(appid: number): string[] {
    const g = this.game(appid);
    if (!g) return [];
    const progress = this.local?.games.get(appid)?.progress ?? {};
    return Object.entries(g.achievements)
      .filter(([, [ok]]) => !ok)
      .map(([n]) => n)
      .sort((a, b) => Number(a in progress) - Number(b in progress));
  }

  /** Unlocks one achievement (default: the next open one), on the servers and in the local cache. */
  unlock(appid: number, apiname = this.open(appid)[0], { local = true } = {}): string | null {
    const g = this.game(appid);
    if (!g || !apiname || !g.achievements[apiname]) return null;
    const t = nowSec();
    g.achievements[apiname] = [true, t, g.achievements[apiname][2]];
    g.lastPlayed = Math.max(g.lastPlayed, t);
    const l = local ? this.ensureLocal(appid) : null;
    if (l) {
      l.achievements[apiname] = [true, t];
      if (l.progress?.[apiname]) l.progress[apiname] = [l.progress[apiname][1], l.progress[apiname][1]];
      l.statsMtime = t;
    }
    this.changed();
    return apiname;
  }

  /**
   * Counts a stat up, like collecting something in game. Only Steam's local cache sees this
   * (the Web API has no progress). Unlocks the achievement when the counter is full.
   */
  bump(appid: number, apiname?: string, delta: number | 'step' = 1): string | null {
    const l = this.local?.games.get(appid);
    if (!l?.progress) return null;
    const name = apiname ?? Object.keys(l.progress).find((n) => !l.achievements[n]?.[0]);
    if (!name || !l.progress[name]) return null;
    const [cur, max] = l.progress[name];
    // 'step' = up to the next overlay popup step, so the progress toast shows.
    const step = progressStep(max);
    const next = Math.min(max, delta === 'step' ? (Math.floor(cur / step) + 1) * step : cur + delta);
    l.progress[name] = [next, max];
    l.statsMtime = nowSec();
    if (next >= max) this.unlock(appid, name);
    this.changed();
    return name;
  }

  start(appid: number) {
    if (this.running.includes(appid)) return;
    this.running = [...this.running, appid];
    this.sessionStart.set(appid, Date.now());
    this.foreground = appid;
    const g = this.game(appid);
    if (g) g.lastPlayed = nowSec();
    this.changed();
  }

  /** Ends a session. `minutes` defaults to the real time it ran (at least one). */
  stop(appid: number, minutes?: number) {
    if (!this.running.includes(appid)) return;
    this.running = this.running.filter((id) => id !== appid);
    if (this.foreground === appid) this.foreground = this.running.at(-1) ?? null;
    const started = this.sessionStart.get(appid) ?? Date.now();
    this.sessionStart.delete(appid);
    const played = minutes ?? Math.max(1, Math.round((Date.now() - started) / 60_000));
    const g = this.game(appid);
    if (g) {
      g.playtime += played;
      g.lastPlayed = nowSec();
      // localconfig.vdf is written when the session ends.
      this.local?.times.set(appid, { appid, playtime: g.playtime, lastPlayed: g.lastPlayed });
    }
    this.changed();
  }

  /**
   * Played on another PC or a Steam Deck: the servers get the unlock and the playtime,
   * this PC's cache stays old. The app must ask the API.
   */
  playElsewhere(appid: number, minutes = 45): string | null {
    const g = this.game(appid);
    if (!g) return null;
    g.playtime += minutes;
    const name = this.unlock(appid, undefined, { local: false });
    g.lastPlayed = nowSec();
    this.changed();
    return name;
  }

  /** A game update (or DLC) adds achievements. */
  gameUpdate(appid: number, n = 3): string[] {
    const g = this.game(appid);
    if (!g) return [];
    const added: string[] = [];
    const start = Object.keys(g.achievements).length;
    const t = nowSec();
    const l = this.local?.games.get(appid);
    for (let i = 0; i < n; i++) {
      const apiname = `DLC_${String(start + i + 1).padStart(3, '0')}`;
      const meta = {
        name: `New Horizon ${start + i + 1}`,
        description: i === 0 ? 'Finish the new chapter.' : i === 1 ? 'Defeat the new boss without taking damage.' : 'Collect all new relics.',
        icon: badge(appid * 1000 + start + i, false),
        icongray: badge(appid * 1000 + start + i, true),
      };
      g.achievements[apiname] = [false, 0, 0.4 + i];
      (g.meta ??= {})[apiname] = meta;
      if (l) {
        l.achievements[apiname] = [false, 0];
        (l.meta ??= {})[apiname] = meta;
      }
      added.push(apiname);
    }
    if (l) l.schemaMtime = l.statsMtime = t;
    this.changed();
    return added;
  }

  /** The stats file of a game Steam never wrote before (first launch). */
  private ensureLocal(appid: number) {
    if (!this.local) return null;
    const g = this.game(appid)!;
    let l = this.local.games.get(appid);
    if (!l) {
      l = this.local.set(appid, {
        name: g.name,
        schemaMtime: nowSec(),
        statsMtime: nowSec(),
        achievements: Object.fromEntries(Object.entries(g.achievements).map(([n, [ok, t]]) => [n, [ok, t]])),
        meta: g.meta,
        hidden: g.hidden,
      });
    }
    return l;
  }

  notify(title: string, body: string) {
    this.notifications = [{ at: Date.now(), title, body }, ...this.notifications].slice(0, 30);
    console.info(`[mock notification] ${title} — ${body}`);
    this.changed();
  }
}
