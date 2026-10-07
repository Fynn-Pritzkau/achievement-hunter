import type { Repo } from './db/repo';
import {
  appVersion,
  checkForUpdate,
  loadApiKey,
  notify,
  onOverlayEvents,
  openLocalSteam,
  openRepo,
  readLog,
  runningAppIds,
  saveApiKey,
  saveBackupFile,
  systemInfo,
  initLog,
  closeOverlayToast,
  focusedAppId,
  openOverlayToast,
  sendOverlayData,
  setOverlayHotkey,
  setTrayLabels,
  steamTransport,
  type AppUpdate,
} from './platform';
import { BUNDLE_MS, buildOverlayData, DEFAULT_OVERLAY, nextGame, OVERLAY_CORNERS, ProgressTracker, type OverlaySettings } from './overlay';
import { SteamApi, SteamApiError } from './steam/api';
import { applyPendingRestore, createBackup, restoreBackup, type Backup, type RestoreResult } from './backup';
import { buildDiagnostics } from './diagnostics';
import { log } from './log';
import type { LocalSteam, StatProgress } from './steam/local';
import { SyncEngine, type SyncProgress, type UnlockEvent } from './sync/engine';
import { aggregate } from './sync/merge';
import { Scheduler } from './sync/scheduler';
import { libraryStats, newlyEarned, type Earned } from './appAchievements';
import { playMilestoneSound } from './sound';
import { completion, type Achievement, type Game } from './types';
import { errorText, LOCALES, setLocale, systemLocale, t, type Locale, type MessageKey } from './i18n.svelte';
import { missableOpen } from './tags';
import { dayKey, fmtHours, fmtPercent } from './util';

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
  /** Notify about open missable achievements when a game starts. */
  warnMissable: boolean;
  /** Notify with a short summary when a game closes. */
  sessionRecap: boolean;
  /** Play a short chime when a milestone (app achievement) is earned. */
  milestoneSound: boolean;
  overlay: OverlaySettings;
}

const DEFAULT_SETTINGS: Settings = {
  steamId: '',
  uiLanguage: systemLocale(),
  language: 'german',
  intervalMinutes: 60,
  staleDays: 14,
  revealHidden: false,
  notifyUnlocks: true,
  warnMissable: true,
  sessionRecap: true,
  milestoneSound: true,
  overlay: DEFAULT_OVERLAY,
};

/** Games found running this soon after the start were already running: no warning, no recap. */
const ALREADY_RUNNING_MS = 10_000;
/** Shorter sessions without an unlock get no recap. */
const RECAP_MIN_MS = 10 * 60_000;

/**
 * Settings from a backup over the current ones. Account and achievement language stay (a different
 * language would reload every schema); only known keys with the right type are taken.
 */
export function restoredSettings(current: Settings, saved: Partial<Settings>): Settings {
  const pick = <T extends object>(base: T, from: unknown, skip: string[] = []): T => {
    const out = { ...base } as Record<string, unknown>;
    if (typeof from !== 'object' || from == null) return base;
    for (const [k, v] of Object.entries(from)) {
      if (!skip.includes(k) && k in out && typeof v === typeof out[k] && typeof v !== 'object') out[k] = v;
    }
    return out as T;
  };
  const out = { ...pick(current, saved, ['steamId', 'language']), overlay: pick(current.overlay, saved.overlay) };
  if (!LOCALES.some((l) => l.id === out.uiLanguage)) out.uiLanguage = current.uiLanguage;
  if (!OVERLAY_CORNERS.includes(out.overlay.corner)) out.overlay.corner = current.overlay.corner;
  return out;
}

/** "A, B, C +2 more" for notifications. */
function nameList(list: { name: string }[], max = 3): string {
  const names = list.slice(0, max).map((a) => a.name).join(', ');
  return list.length > max ? `${names} ${t('notify.more', { n: list.length - max })}` : names;
}

/** App-wide reactive state. */
class AppState {
  ready = $state(false);
  configured = $state(false);
  settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  games = $state<Game[]>([]);
  progress = $state<SyncProgress | null>(null);
  runningAppIds = $state<number[]>([]);
  lastSync = $state<number | null>(null);
  error = $state<string | null>(null);
  /** Steam rejected the API key: the UI points to the account settings. */
  authError = $state(false);
  /** The app could not start (e.g. a database from a newer version). */
  initError = $state<string | null>(null);
  /** Bumped on every new unlock, so views showing unlocks can reload. */
  unlockSeq = $state(0);
  /** Earned app achievements (the app's own, not Steam's), see appAchievements.ts. */
  appAchievements = $state<Earned>({});
  version = $state('');
  update = $state<AppUpdate | null>(null);
  updateState = $state<'idle' | 'checking' | 'current' | 'installing' | 'error'>('idle');
  updateProgress = $state<number | null>(null);
  updateError = $state<string | null>(null);
  /** Why the overlay hotkey could not be bound (invalid or taken by another app). */
  overlayError = $state<string | null>(null);
  /** The guided tour is running (see tour.ts). */
  touring = $state(false);
  /** The one-time "take the tour?" card is shown. */
  tourOffer = $state(false);
  /** Achievement (apiname) the game page should expand and scroll to, e.g. from the search. */
  focusAchievement = $state<string | null>(null);

  repo!: Repo;
  /** Only while the overlay window exists does the main window send it updates. */
  private overlayOpen = false;
  /** The overlay window is the short progress popup. */
  private overlayToast = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  /** Game of the latest popup; the overlay prefers it when several games run. */
  private overlayAppId: number | null = null;
  /** Game the full overlay shows: the one in focus when it opened, or the one switched to. Beats overlayAppId. */
  private overlayChoice: number | null = null;
  /** Game the overlay shows right now, the starting point for switching. */
  private overlayShown: number | null = null;
  /** The tour shows this game in the overlay (see tourOverlay). */
  private overlayPreview: number | null = null;
  /** The tour opened the overlay window and closes it again. */
  private previewOpened = false;
  private tracker = new ProgressTracker();
  private engine: SyncEngine | null = null;
  private local: LocalSteam | null = null;
  private scheduler: Scheduler | null = null;
  private appAchTimer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  /** Progress of games started while the app ran, for the session recap. */
  private sessions = new Map<number, { unlocked: number; total: number | null }>();
  /** Games already warned about missables in this app session. */
  private missableWarned = new Set<number>();

  async init() {
    initLog();
    this.repo = await openRepo();
    const raw = await this.repo.getMeta('settings');
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      // Settings from before the language switch: keep the app in the language the achievements are in.
      const uiLanguage = saved.uiLanguage ?? (saved.language === 'english' ? 'en' : 'de');
      this.settings = { ...DEFAULT_SETTINGS, ...saved, uiLanguage, overlay: { ...DEFAULT_OVERLAY, ...saved.overlay } };
    }
    this.applyLocale();
    await onOverlayEvents({
      ready: () => {
        this.overlayOpen = true;
        void this.focusOverlay().then(() => this.pushOverlay());
      },
      closed: () => {
        this.overlayOpen = this.overlayToast = this.previewOpened = false;
        this.clearToastTimer();
      },
      full: () => {
        // The hotkey turned the popup (or the tour's overlay) into the user's own overlay.
        this.overlayToast = this.previewOpened = false;
        this.clearToastTimer();
        void this.focusOverlay().then(() => this.pushOverlay());
      },
      switch: () => {
        if (!this.overlayOpen || this.overlayToast || this.overlayPreview != null) return;
        const next = nextGame(this.overlayGames().map((g) => g.appid), this.overlayShown);
        if (next == null || next === this.overlayShown) return;
        this.overlayChoice = next;
        void this.pushOverlay();
      },
    });
    await this.applyOverlayHotkey();
    this.games = await this.repo.getGames();
    const last = await this.repo.getMeta('lastSync');
    this.lastSync = last ? Number(last) : null;
    await this.loadAppAchievements();
    const key = await loadApiKey();
    this.configured = !!key && !!(await this.repo.getMeta('steamid64'));
    this.tourOffer = !(await this.repo.getMeta('tourOffered'));
    this.ready = true;
    this.version = await appVersion();
    log.info(`Start ${this.version}, ${this.games.length} games, schema ${this.repo.schemaVersion ?? '-'}`);
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
      log.warn('Update check failed', e);
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
      log.error('Update install failed', e);
    }
  }

  /**
   * First setup (or the key went missing): validates key + profile with real calls, then stores both.
   * Data of a different account is backed up and cleared without asking: this screen starts over anyway.
   */
  async setup(apiKey: string, steamIdInput: string, language: string) {
    const steamid = await this.validate(apiKey, steamIdInput, language);
    await this.switchTo(apiKey, steamid, steamIdInput, language);
  }

  /**
   * Changes the API key and/or the Steam account from the settings. An empty key keeps the stored one.
   * For a different account it first returns `{ confirm }`; called again with `confirmed`, the current
   * data goes to a backup file and is cleared, so two accounts never mix. Throws like the Steam API.
   */
  async changeAccount(apiKeyInput: string, steamIdInput: string, confirmed = false): Promise<{ confirm: string } | { backup: string | null }> {
    const apiKey = apiKeyInput.trim() || (await loadApiKey());
    if (!apiKey) throw new SteamApiError('auth', 'No API key stored');
    const steamid = await this.validate(apiKey, steamIdInput, this.settings.language);
    const current = await this.repo.getMeta('steamid64');
    if (current && current !== steamid && !confirmed) return { confirm: steamid };
    return { backup: await this.switchTo(apiKey, steamid, steamIdInput, this.settings.language) };
  }

  /** Resolves the profile and checks key and privacy with real calls (2 at most). Returns the SteamID64. */
  private async validate(apiKey: string, steamIdInput: string, language: string): Promise<string> {
    const transport = await steamTransport();
    const api = new SteamApi({ apiKey, language, ...transport });
    const steamid = await api.resolveSteamId(steamIdInput);
    await api.getOwnedGames(steamid); // throws on bad key or private profile
    return steamid;
  }

  /** Stores key and account and (re)starts syncing. Returns the backup path when another account's data was cleared. */
  private async switchTo(apiKey: string, steamid: string, steamIdInput: string, language: string): Promise<string | null> {
    // Nothing may write while the account changes: stop the running engine first.
    this.scheduler?.stop();
    this.scheduler = null;
    await this.engine?.stop();
    this.engine = null;
    const current = await this.repo.getMeta('steamid64');
    let backup: string | null = null;
    if (current && current !== steamid) {
      // Saved first: if that fails, nothing is cleared.
      if ((await this.repo.getGames()).length) backup = await this.exportBackup();
      await this.repo.clearAccountData();
      this.games = [];
      this.appAchievements = {};
      this.lastSync = null;
      this.progress = null;
      this.runningAppIds = [];
      this.sessions.clear();
      this.missableWarned.clear();
      this.descriptionsTried.clear();
      this.tracker = new ProgressTracker();
      log.info('Switched to another Steam account; the previous data was backed up and cleared');
    }
    await saveApiKey(apiKey);
    await this.repo.setMeta('steamid64', steamid);
    await this.saveSettings({ ...this.settings, steamId: steamIdInput, language });
    this.configured = true;
    this.authError = false;
    this.error = null;
    await this.start(apiKey);
    return backup;
  }

  /** Saves a backup of the user's own data (see backup.ts) to Downloads. Returns where it went. */
  async exportBackup(): Promise<string> {
    const backup = await createBackup(this.repo, this.version);
    const path = await saveBackupFile(`achievement-hunter-backup-${dayKey(Date.now())}.json`, JSON.stringify(backup, null, 1));
    log.info(`Backup saved: ${backup.games.length} games, ${backup.snapshots.length} snapshots`);
    return path;
  }

  /** Adds a backup's data to the current data. Games not synced yet follow after later syncs. */
  async importBackup(backup: Backup): Promise<RestoreResult> {
    // Wait for a sync in flight, so it doesn't save over the restored pins and notes.
    await this.engine?.idle();
    const res = await restoreBackup(this.repo, backup);
    for (const g of res.games) this.upsertLocal(g);
    // Milestones stay earned; each keeps its earliest date.
    const earned = { ...this.appAchievements };
    for (const [id, at] of Object.entries(backup.appAchievements)) earned[id] = Math.min(earned[id] ?? at, at);
    this.appAchievements = earned;
    await this.repo.setMeta('appAchievements', JSON.stringify(earned));
    if (backup.settings) await this.saveSettings(restoredSettings(this.settings, backup.settings));
    this.unlockSeq++;
    log.info(`Backup restored: ${res.games.length} games, ${res.pending} waiting, ${res.snapshots} snapshots`);
    return res;
  }

  /** Text for a bug report: versions, counts, settings and the log, without key or SteamID. */
  async diagnostics(): Promise<string> {
    const [sys, logText] = await Promise.all([
      systemInfo().catch(() => ({ os: 'unknown', steamInstalled: null })),
      readLog().catch((e) => `(log unreadable: ${e})`),
    ]);
    return buildDiagnostics({
      version: this.version,
      os: sys.os,
      steamInstalled: sys.steamInstalled,
      localCache: this.local != null,
      schemaVersion: this.repo.schemaVersion ?? null,
      games: this.games,
      lastSync: this.lastSync,
      error: this.error,
      settings: this.settings,
      log: logText,
    });
  }

  startTour() {
    this.dismissTourOffer();
    this.touring = true;
  }

  /** The tour is offered once; afterwards it starts only from the sidebar or the settings. */
  dismissTourOffer() {
    if (!this.tourOffer) return;
    this.tourOffer = false;
    void this.repo.setMeta('tourOffered', String(Date.now()));
  }

  async saveSettings(s: Settings) {
    this.settings = s;
    this.applyLocale();
    await this.repo.setMeta('settings', JSON.stringify(s));
    await this.applyOverlayHotkey();
    if (this.overlayOpen) void this.pushOverlay();
  }

  private async applyOverlayHotkey() {
    try {
      const { hotkey, switchHotkey, corner } = this.settings.overlay;
      await setOverlayHotkey(hotkey, switchHotkey, corner);
      this.overlayError = null;
    } catch (e) {
      this.overlayError = errorText(e);
      log.warn('Overlay hotkey', e);
    }
  }

  /** Sends the running game to the overlay: from SQLite and Steam's cache, no API call. */
  private async pushOverlay() {
    const preview = this.overlayPreview;
    const toast = this.overlayToast && preview == null;
    const running = preview != null ? this.overlayGames([preview]) : this.overlayGames();
    // The popup shows the game whose counter moved; the full overlay the chosen one,
    // so an idle game counting up in the background doesn't take it over.
    const find = (id: number | null) => running.find((g) => g.appid === id);
    let game = (toast ? null : find(this.overlayChoice)) ?? find(this.overlayAppId) ?? null;
    let list = game ? await this.repo.getAchievements(game.appid) : [];
    if (!game) {
      // Several games running (idle games next to the real one): prefer one with pinned achievements.
      for (const g of running) {
        const l = await this.repo.getAchievements(g.appid);
        const pins = l.some((a) => a.pinned && !a.achieved);
        if (!game || pins) [game, list] = [g, l];
        if (pins) break;
      }
    }
    const progress = game ? await this.localProgress(game.appid) : new Map();
    const { overlay, uiLanguage, revealHidden } = this.settings;
    const data = buildOverlayData(game, list, overlay, {
      locale: uiLanguage,
      revealHidden,
      mode: toast ? 'toast' : 'full',
      progress,
      bumps: game && preview == null ? this.tracker.recent(game.appid) : [],
      running: running.map((g) => g.appid),
    });
    this.overlayShown = game?.appid ?? null;
    await sendOverlayData(data).catch(() => {});
  }

  /** Running games the overlay can show (those with achievements), in a stable order. */
  private overlayGames(ids = this.runningAppIds): Game[] {
    return ids
      .map((id) => this.games.find((g) => g.appid === id))
      .filter((g): g is Game => !!g && (g.total ?? 0) > 0);
  }

  /**
   * The user opened the overlay: show the game in the foreground window. Idle games run next to
   * the real one, and Steam can't tell them apart. Not found (e.g. the app itself is in front):
   * keep the last choice.
   */
  private async focusOverlay() {
    if (this.overlayToast || this.overlayPreview != null) return;
    const running = this.overlayGames().map((g) => g.appid);
    if (running.length < 2) return;
    const focused = await focusedAppId(running).catch(() => null);
    if (focused != null) this.overlayChoice = focused;
  }

  /**
   * The tour shows the real overlay with this game (null = stop). It opens the window if needed
   * and closes it again afterwards; an overlay the user had open stays open.
   */
  async tourOverlay(appid: number | null) {
    if (appid === this.overlayPreview) return;
    this.overlayPreview = appid;
    if (appid != null) {
      if (this.overlayToast) {
        // A progress popup is open: keep it for the tour, its timer must not close it.
        this.clearToastTimer();
        this.overlayToast = false;
        this.previewOpened = true;
      } else if (!this.overlayOpen) {
        const opened = await openOverlayToast().catch(() => false);
        // The tour moved on while the window opened.
        if (opened && this.overlayPreview == null) return void (await closeOverlayToast().catch(() => {}));
        this.previewOpened ||= opened;
      }
      // A window that is still loading asks for its data with overlay:ready.
      if (this.overlayOpen) await this.pushOverlay();
    } else if (this.previewOpened) {
      this.previewOpened = false;
      await closeOverlayToast().catch(() => {});
    } else if (this.overlayOpen) {
      await this.pushOverlay();
    }
  }

  /** A running game was synced: look for counters that went up and show them. */
  private async onRunningGameUpdated(appid: number) {
    const bumps = this.local ? this.tracker.update(appid, await this.localProgress(appid), Date.now()) : [];
    const fullOpen = this.overlayOpen && !this.overlayToast;
    if (bumps.some((b) => b.notable) && this.settings.overlay.progressPopup && !fullOpen) {
      this.overlayAppId = appid;
      await this.showProgressToast();
    } else if (this.overlayOpen) {
      if (bumps.length) this.overlayAppId = appid;
      await this.pushOverlay();
    }
  }

  /** Pops the overlay up briefly; further bumps keep it open and update it (bundled, BUNDLE_MS). */
  private async showProgressToast() {
    if (!this.overlayOpen && !this.overlayToast) {
      this.overlayToast = true;
      // False when the full overlay is just loading; it then gets the update on its own.
      if (!(await openOverlayToast().catch(() => false))) this.overlayToast = false;
    }
    // A window that is still loading asks for its data with overlay:ready.
    if (this.overlayOpen) await this.pushOverlay();
    if (!this.overlayToast) return;
    this.clearToastTimer();
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      if (this.overlayToast) void closeOverlayToast().catch(() => {});
    }, BUNDLE_MS);
  }

  private clearToastTimer() {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
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
    this.local = await openLocalSteam(steamid, this.settings.language);
    this.engine = new SyncEngine({
      api,
      repo: this.repo,
      steamid,
      local: this.local,
      staleDays: this.settings.staleDays,
      onProgress: (p) => (this.progress = p.done < p.total ? p : null),
      onGameUpdated: (g) => this.upsertLocal(g),
      onUnlock: (e) => this.onUnlock(e),
      onAchievementsAdded: (g, added) => {
        if (this.settings.notifyUnlocks) void notify(t('notify.newAch', { game: g.name, n: added.length }), nameList(added));
      },
    });
    this.scheduler?.stop();
    this.startedAt = Date.now();
    this.scheduler = new Scheduler({
      engine: this.engine,
      intervalMs: this.settings.intervalMinutes * 60_000,
      getRunningAppIds: runningAppIds,
      onRunningChange: (ids) => {
        const started = ids.filter((id) => !this.runningAppIds.includes(id));
        for (const id of this.runningAppIds) if (!ids.includes(id)) this.tracker.forget(id);
        this.runningAppIds = ids;
        // Baseline for started games, so their first counter step counts.
        for (const id of started) void this.localProgress(id).then((p) => this.tracker.update(id, p, Date.now()));
        if (Date.now() - this.startedAt > ALREADY_RUNNING_MS) for (const id of started) void this.onGameStarted(id);
        if (this.overlayOpen) void this.pushOverlay();
      },
      onClosed: (id, startedAt) => this.onGameClosed(id, startedAt),
      onError: (e) => {
        this.error = errorText(e);
        log.warn('Live update', e);
      },
      // Through sync(), so a later good run clears the error of an earlier one.
      librarySync: (force) => this.sync(force),
    });
    this.scheduler.start();
    void this.sync();
    void this.engine.backfillHiddenDescriptions().catch(() => {});
    void this.engine
      .backfillPace()
      .then((games) => games.forEach((g) => this.upsertLocal(g)))
      .catch((e) => log.warn('Pace backfill', e));
  }

  async sync(force = false) {
    const engine = this.engine;
    if (!engine) return;
    this.error = null;
    const started = Date.now();
    let failure: unknown = null;
    try {
      const res = await engine.sync({ force });
      if (res.aborted) this.error = res.abortedError ? errorText(res.abortedError) : res.aborted;
      else if (res.errors.length) this.error = t('sync.failedGames', { n: res.errors.length });
      this.lastSync = Date.now();
      failure = res.abortedError ?? null;
      log.info(`Sync${force ? ' (force)' : ''}: ${res.tasks} tasks, ${res.updated} updated, ${res.errors.length} errors, ${Date.now() - started} ms`);
      if (res.aborted) log.warn('Sync aborted', res.abortedError ?? res.aborted);
      for (const e of res.errors.slice(0, 5)) log.warn(`Game ${e.appid} failed: ${e.message}`);
    } catch (e) {
      this.error = errorText(e);
      failure = e;
      log.error('Sync failed', e);
    }
    this.authError = failure instanceof SteamApiError && failure.kind === 'auth';
    // The account changed meanwhile: this run's results belong to nobody.
    if (engine !== this.engine) return;
    this.progress = null;
    await applyPendingRestore(this.repo).catch((e) => log.warn('Pending restore', e));
    this.games = await this.repo.getGames();
    this.scheduleAppAchCheck();
  }

  async syncGame(appid: number) {
    await this.engine?.syncGame(appid);
  }

  /** Stat progress of a game's open achievements, read fresh from Steam's cache (free; empty without it). */
  async localProgress(appid: number): Promise<Map<string, StatProgress>> {
    const g = await this.local?.game(appid);
    return new Map((g?.achievements ?? []).flatMap((a) => (a.progress ? [[a.apiname, a.progress] as const] : [])));
  }

  private descriptionsTried = new Set<number>();

  /** Fetches missing hidden descriptions for a stored game, at most once per session. True when something changed. */
  async fillHiddenDescriptions(appid: number): Promise<boolean> {
    if (!this.engine || this.descriptionsTried.has(appid)) return false;
    this.descriptionsTried.add(appid);
    return this.engine.fillHiddenDescriptions(appid).catch(() => {
      // A failed attempt is retried the next time the game is opened.
      this.descriptionsTried.delete(appid);
      return false;
    });
  }

  private upsertLocal(g: Game) {
    const i = this.games.findIndex((x) => x.appid === g.appid);
    if (i >= 0) this.games[i] = g;
    else this.games.push(g);
    this.scheduleAppAchCheck();
    if (this.runningAppIds.includes(g.appid)) void this.onRunningGameUpdated(g.appid);
  }

  private async loadAppAchievements() {
    const raw = await this.repo.getMeta('appAchievements');
    if (raw) this.appAchievements = JSON.parse(raw) as Earned;
    this.scheduleAppAchCheck();
  }

  /** Bundles the many game updates of one sync into a single check. */
  private scheduleAppAchCheck() {
    if (this.appAchTimer) clearTimeout(this.appAchTimer);
    this.appAchTimer = setTimeout(() => {
      this.appAchTimer = null;
      void this.checkAppAchievements();
    }, 1000);
  }

  private async checkAppAchievements() {
    const fresh = newlyEarned(libraryStats(this.games, Math.floor(Date.now() / 1000)), this.appAchievements);
    if (!fresh.length) return;
    const now = Date.now();
    this.appAchievements = { ...this.appAchievements, ...Object.fromEntries(fresh.map((a) => [a.id, now])) };
    await this.repo.setMeta('appAchievements', JSON.stringify(this.appAchievements));
    if (this.settings.milestoneSound) playMilestoneSound();
    if (!this.settings.notifyUnlocks) return;
    // The first sync can earn a whole shelf at once: one summary instead of a burst.
    if (fresh.length > 2) void notify(t('appAchs.notifyMany', { n: fresh.length }), fresh.map((a) => a.icon).join(' '));
    else for (const a of fresh) void notify(t('appAchs.notify', { icon: a.icon }), t(`appAch.${a.id}` as MessageKey));
  }

  /** A game started while the app runs: remember where it stood, warn about missables. */
  private async onGameStarted(appid: number) {
    const g = this.games.find((x) => x.appid === appid);
    if (!g?.total) return;
    this.sessions.set(appid, { unlocked: g.unlocked, total: g.total });
    if (!this.settings.warnMissable || this.missableWarned.has(appid)) return;
    const open = missableOpen(await this.repo.getAchievements(appid));
    if (!open.length) return;
    this.missableWarned.add(appid);
    void notify(t('notify.missable', { game: g.name, n: open.length }), nameList(open));
  }

  /** A game closed and got its final refresh: sum up the session. */
  private onGameClosed(appid: number, startedAt: number) {
    const before = this.sessions.get(appid);
    this.sessions.delete(appid);
    const g = this.games.find((x) => x.appid === appid);
    if (!before || !g?.total || !this.settings.sessionRecap) return;
    const n = Math.max(0, g.unlocked - before.unlocked);
    const ms = Date.now() - startedAt;
    if (!n && ms < RECAP_MIN_MS) return;
    const pct = (x: { unlocked: number; total: number | null }) => `${Math.floor(completion(x) ?? 0)} %`;
    void notify(
      t('notify.session', { game: g.name }),
      t('notify.sessionBody', { n, time: fmtHours(Math.round(ms / 60_000)), from: pct(before), to: pct(g) }),
    );
  }

  private onUnlock(e: UnlockEvent) {
    this.unlockSeq++;
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
    // Pins and exclusions show in the overlay right away.
    if (this.overlayOpen) void this.pushOverlay();
  }
}

export const app = new AppState();
