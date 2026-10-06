/**
 * Everything that differs between the Tauri app and a plain browser tab
 * (`npm run dev` without Tauri, handy for working on the UI).
 */
import { MemoryRepo, type Repo } from './db/repo';
import type { OverlayCorner, OverlayData } from './overlay';
import type { FetchFn } from './steam/api';
import { tauriLocalSteam, type LocalSteam } from './steam/local';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function openRepo(): Promise<Repo> {
  if (isTauri) {
    const { SqliteRepo } = await import('./db/sqlite');
    return SqliteRepo.open();
  }
  return new LocalStorageRepo();
}

export async function steamTransport(): Promise<{ fetch: FetchFn; baseUrl: string }> {
  if (isTauri) {
    const http = await import('@tauri-apps/plugin-http');
    return { fetch: http.fetch as FetchFn, baseUrl: 'https://api.steampowered.com' };
  }
  // Vite dev proxy, see vite.config.ts
  return { fetch: (u, i) => fetch(u, i), baseUrl: '/steam-api' };
}

const KEY_NAME = 'steam-api-key';

/** The API key lives in the Windows Credential Manager in the app; in the browser, in localStorage. */
export async function loadApiKey(): Promise<string | null> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string | null>('get_secret', { name: KEY_NAME });
  }
  return localStorage.getItem(KEY_NAME);
}

export async function saveApiKey(value: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_secret', { name: KEY_NAME, value });
    return;
  }
  localStorage.setItem(KEY_NAME, value);
}

/** AppIDs of the games Steam is running right now, read from the registry. Free — no API call. */
export async function runningAppIds(): Promise<number[]> {
  if (!isTauri) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<number[]>('running_app_ids');
}

/** Texts of the tray menu, which Rust creates before the UI knows the language. */
export async function setTrayLabels(open: string, quit: string): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_tray_labels', { open, quit });
}

/**
 * Binds the global overlay hotkey (empty = off). Rejects with a message when a shortcut is invalid or taken.
 * The switch hotkey is only bound while the overlay is open.
 */
export async function setOverlayHotkey(hotkey: string, switchHotkey: string, corner: OverlayCorner): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_overlay_hotkey', { hotkey: hotkey.trim() || null, switchHotkey: switchHotkey.trim() || null, corner });
}

/** Which of these games owns the foreground window, from its exe path and Steam's app manifests. */
export async function focusedAppId(candidates: number[]): Promise<number | null> {
  if (!isTauri || !candidates.length) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke<number | null>('focused_app_id', { candidates })) ?? null;
}

/**
 * The overlay announces itself when it is ready for data; Rust reports when it was closed,
 * when the hotkey turned a progress popup into the full overlay, and when the switch hotkey was pressed.
 */
export async function onOverlayEvents(on: {
  ready: () => void;
  closed: () => void;
  full: () => void;
  switch: () => void;
}): Promise<void> {
  if (!isTauri) return;
  const { listen } = await import('@tauri-apps/api/event');
  await listen('overlay:ready', on.ready);
  await listen('overlay:closed', on.closed);
  await listen('overlay:full', on.full);
  await listen('overlay:switch', on.switch);
}

/** Opens the overlay as a short popup. False when it is already open. */
export async function openOverlayToast(): Promise<boolean> {
  if (!isTauri) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<boolean>('open_overlay_toast');
}

export async function closeOverlayToast(): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('close_overlay_toast');
}

export async function sendOverlayData(data: OverlayData): Promise<void> {
  if (!isTauri) return;
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo('overlay', 'overlay:data', data);
}

/** Steam's local cache (read-only). null in the browser, where there is no file access. */
export async function openLocalSteam(steamid64: string, language: string): Promise<LocalSteam | null> {
  if (!isTauri) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return tauriLocalSteam(invoke, steamid64, language);
}

export async function appVersion(): Promise<string> {
  if (!isTauri) return 'dev';
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

export interface AppUpdate {
  version: string;
  notes: string;
  /** Downloads, verifies the signature, installs and restarts. Progress in percent, null = unknown size. */
  install(onProgress?: (percent: number | null) => void): Promise<void>;
}

/** Asks the release feed for a newer signed version. null = up to date (or not the desktop app). */
export async function checkForUpdate(): Promise<AppUpdate | null> {
  if (!isTauri) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const u = await check();
  if (!u) return null;
  return {
    version: u.version,
    notes: u.body ?? '',
    async install(onProgress) {
      let total = 0;
      let got = 0;
      await u.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0;
        else if (e.event === 'Progress') {
          got += e.data.chunkLength;
          onProgress?.(total ? Math.min(100, (got / total) * 100) : null);
        }
      });
      // On Windows the installer usually closes the app itself; this covers the rest.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}

/** Opens a link in the default browser (or Steam for steam://). The WebView ignores target="_blank". */
export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noreferrer');
}

export async function notify(title: string, body: string): Promise<void> {
  if (isTauri) {
    const n = await import('@tauri-apps/plugin-notification');
    if (!(await n.isPermissionGranted()) && (await n.requestPermission()) !== 'granted') return;
    n.sendNotification({ title, body });
    return;
  }
  if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
}

/** Browser fallback: the in-memory repo, persisted to localStorage after each write. */
class LocalStorageRepo extends MemoryRepo {
  private static KEY = 'achievement-hunter-db';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    try {
      const raw = localStorage.getItem(LocalStorageRepo.KEY);
      if (raw) {
        const d = JSON.parse(raw);
        this.games = new Map(d.games);
        this.achievements = new Map(d.achievements);
        this.snapshots = d.snapshots ?? [];
        this.meta = new Map(d.meta);
      }
    } catch {
      /* start empty */
    }
  }

  private persist() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try {
        localStorage.setItem(
          LocalStorageRepo.KEY,
          JSON.stringify({
            games: [...this.games],
            achievements: [...this.achievements],
            snapshots: this.snapshots,
            meta: [...this.meta],
          }),
        );
      } catch {
        /* quota exceeded — dev only */
      }
    }, 500);
  }

  override async saveGame(g: Parameters<MemoryRepo['saveGame']>[0]) {
    await super.saveGame(g);
    this.persist();
  }
  override async saveGames(g: Parameters<MemoryRepo['saveGames']>[0]) {
    await super.saveGames(g);
    this.persist();
  }
  override async saveAchievements(appid: number, list: Parameters<MemoryRepo['saveAchievements']>[1]) {
    await super.saveAchievements(appid, list);
    this.persist();
  }
  override async addSnapshots(s: Parameters<MemoryRepo['addSnapshots']>[0]) {
    await super.addSnapshots(s);
    this.persist();
  }
  override async setMeta(k: string, v: string) {
    await super.setMeta(k, v);
    this.persist();
  }
}
