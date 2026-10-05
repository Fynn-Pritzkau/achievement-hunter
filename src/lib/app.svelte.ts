import type { Repo } from './db/repo';
import {
  appVersion,
  checkForUpdate,
  loadApiKey,
  notify,
  openLocalSteam,
  openRepo,
  runningAppId,
  saveApiKey,
  setTrayLabels,
  steamTransport,
  type AppUpdate,
} from './platform';
import { SteamApi } from './steam/api';
import { SyncEngine, type SyncProgress, type UnlockEvent } from './sync/engine';
import { aggregate } from './sync/merge';
import { Scheduler } from './sync/scheduler';
import type { Achievement, Game } from './types';
import { errorText, setLocale, systemLocale, t, type Locale } from './i18n.svelte';
import { fmtPercent } from './util';

export interface Settings {
  steamId: string;
  /** Language of the app itself. */
  uiLanguage: Locale;
  /** Steam language for achievement names and descriptions. */
  language: string;
  intervalMinutes: number;
  staleDays: number;
  /** Show descriptions of hidden achievements without clicking. */
  revealHidden: boolean;
  notifyUnlocks: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  steamId: '',
  uiLanguage: systemLocale(),
  language: 'german',
  intervalMinutes: 60,
  staleDays: 14,
  revealHidden: false,
  notifyUnlocks: true,
};

/** App-wide reactive state. */
class AppState {
  ready = $state(false);
  configured = $state(false);
  settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  games = $state<Game[]>([]);
  progress = $state<SyncProgress | null>(null);
  runningAppId = $state<number | null>(null);
  lastSync = $state<number | null>(null);
  error = $state<string | null>(null);
  recentUnlocks = $state<UnlockEvent[]>([]);
  version = $state('');
  update = $state<AppUpdate | null>(null);
  updateState = $state<'idle' | 'checking' | 'current' | 'installing' | 'error'>('idle');
  updateProgress = $state<number | null>(null);
  updateError = $state<string | null>(null);

  repo!: Repo;
  private engine: SyncEngine | null = null;
  private scheduler: Scheduler | null = null;

  async init() {
    this.repo = await openRepo();
    const raw = await this.repo.getMeta('settings');
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      // Settings from before the language switch: keep the app in the language the achievements are in.
      const uiLanguage = saved.uiLanguage ?? (saved.language === 'english' ? 'en' : 'de');
      this.settings = { ...DEFAULT_SETTINGS, ...saved, uiLanguage };
    }
    this.applyLocale();
    this.games = await this.repo.getGames();
    const last = await this.repo.getMeta('lastSync');
    this.lastSync = last ? Number(last) : null;
    const key = await loadApiKey();
    this.configured = !!key && !!(await this.repo.getMeta('steamid64'));
    this.ready = true;
    this.version = await appVersion();
    // Quietly look for updates a bit after start, then twice a day (the app mostly lives in the tray).
    setTimeout(() => void this.checkUpdate(), 10_000);
    setInterval(() => void this.checkUpdate(), 12 * 3_600_000);
    if (this.configured) await this.start(key!);
  }

  /** `manual` shows errors; the automatic check stays silent when offline. */
  async checkUpdate(manual = false) {
    if (this.updateState === 'checking' || this.updateState === 'installing') return;
    this.updateState = 'checking';
    this.updateError = null;
    try {
      this.update = await checkForUpdate();
      this.updateState = this.update ? 'idle' : 'current';
    } catch (e) {
      this.updateState = manual ? 'error' : 'idle';
      if (manual) this.updateError = (e as Error)?.message ?? String(e);
    }
  }

  async installUpdate() {
    if (!this.update || this.updateState === 'installing') return;
    this.updateState = 'installing';
    this.updateProgress = null;
    try {
      await this.update.install((p) => (this.updateProgress = p));
    } catch (e) {
      this.updateState = 'error';
      this.updateError = (e as Error)?.message ?? String(e);
    }
  }

  /** Validates key + profile with real calls, then stores both. */
  async setup(apiKey: string, steamIdInput: string, language: string) {
    const transport = await steamTransport();
    const api = new SteamApi({ apiKey, language, ...transport });
    const steamid = await api.resolveSteamId(steamIdInput);
    await api.getOwnedGames(steamid); // throws on bad key or private profile
    await saveApiKey(apiKey);
    await this.repo.setMeta('steamid64', steamid);
    await this.saveSettings({ ...this.settings, steamId: steamIdInput, language });
    this.configured = true;
    await this.start(apiKey);
  }

  async saveSettings(s: Settings) {
    this.settings = s;
    this.applyLocale();
    await this.repo.setMeta('settings', JSON.stringify(s));
  }

  /** Switches the UI language right away, for the window and the tray menu. */
  private applyLocale() {
    setLocale(this.settings.uiLanguage);
    void setTrayLabels(t('tray.open'), t('tray.quit')).catch(() => {});
  }

  private async start(apiKey: string) {
    const steamid = (await this.repo.getMeta('steamid64'))!;
    const transport = await steamTransport();
    const api = new SteamApi({ apiKey, language: this.settings.language, ...transport });
    this.engine = new SyncEngine({
      api,
      repo: this.repo,
      steamid,
      local: await openLocalSteam(steamid, this.settings.language),
      staleDays: this.settings.staleDays,
      onProgress: (p) => (this.progress = p.done < p.total ? p : null),
      onGameUpdated: (g) => this.upsertLocal(g),
      onUnlock: (e) => this.onUnlock(e),
    });
    this.scheduler?.stop();
    this.scheduler = new Scheduler({
      engine: this.engine,
      intervalMs: this.settings.intervalMinutes * 60_000,
      getRunningAppId: runningAppId,
      onRunningChange: (id) => (this.runningAppId = id),
      onError: (e) => (this.error = errorText(e)),
    });
    this.scheduler.start();
    void this.sync();
  }

  async sync(force = false) {
    if (!this.engine) return;
    this.error = null;
    try {
      const res = await this.engine.sync({ force });
      if (res.aborted) this.error = res.abortedError ? errorText(res.abortedError) : res.aborted;
      else if (res.errors.length) this.error = t('sync.failedGames', { n: res.errors.length });
      this.lastSync = Date.now();
    } catch (e) {
      this.error = errorText(e);
    }
    this.progress = null;
    this.games = await this.repo.getGames();
  }

  async syncGame(appid: number) {
    await this.engine?.syncGame(appid);
  }

  private descriptionsTried = new Set<number>();

  /** Fetches missing hidden descriptions for a stored game, at most once per session. True when something changed. */
  async fillHiddenDescriptions(appid: number): Promise<boolean> {
    if (!this.engine || this.descriptionsTried.has(appid)) return false;
    this.descriptionsTried.add(appid);
    return this.engine.fillHiddenDescriptions(appid).catch(() => false);
  }

  private upsertLocal(g: Game) {
    const i = this.games.findIndex((x) => x.appid === g.appid);
    if (i >= 0) this.games[i] = g;
    else this.games.push(g);
  }

  private onUnlock(e: UnlockEvent) {
    this.recentUnlocks = [e, ...this.recentUnlocks].slice(0, 20);
    if (!this.settings.notifyUnlocks) return;
    const p = e.achievement.percent;
    const rare = p != null && p < 10 ? t('notify.rare', { p: fmtPercent(p) }) : p != null ? ` (${fmtPercent(p)})` : '';
    void notify(`🏆 ${e.achievement.name}`, `${e.game.name}: ${e.game.unlocked}/${e.game.total}${rare}`);
  }

  /** Saves user edits to a game (status, pin, hide). */
  async updateGame(g: Game) {
    await this.repo.saveGame(g);
    this.upsertLocal(g);
  }

  /** Saves user edits to achievements and refreshes the game's numbers. */
  async updateAchievements(game: Game, list: Achievement[]) {
    await this.repo.saveAchievements(game.appid, list);
    await this.updateGame({ ...game, ...aggregate(list) });
  }
}

export const app = new AppState();
