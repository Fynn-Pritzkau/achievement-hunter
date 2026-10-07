/**
 * Mock mode (`npm run dev:mock`, or any dev URL with `?mock`): the whole app runs in the browser
 * against a fake Steam (Web API + local cache) and an emulated desktop (overlay, hotkeys, running
 * games, notifications). The real AppState, SyncEngine and Scheduler run unchanged, so what works
 * here works in the app. Nothing persists: a reload starts the scenario over.
 *
 * URL parameters:
 *   mock=<scenario>  library (default) | fresh (setup screen) | nolocal (no Steam cache, API live mode)
 *                    | empty (no games) | private (game details private)
 *   lang=de|en       UI language (default en)
 *   latency=<ms>     delay of each fake API answer (default 25)
 *   tour             offer the tour like on a first start
 *   update           pretend a newer version is available
 *   panel=0          start with the dev panel collapsed
 *
 * In the console: `mock.world` (Steam), `mock.desktop` (overlay), `mock.app` (app state).
 */
import { MemoryRepo, type Repo } from '../lib/db/repo';
import type { AppUpdate } from '../lib/platform';
import type { OverlayCorner, OverlayData } from '../lib/overlay';
import type { FetchFn } from '../lib/steam/api';
import type { LocalSteam } from '../lib/steam/local';
import { dayKey } from '../lib/util';
import { MockDesktop } from './desktop';
import { MockWorld, SCENARIOS, type Scenario } from './world';

const params = new URLSearchParams(location.search);
const scenarioParam = params.get('mock') as Scenario | null;
export const scenario: Scenario = scenarioParam && SCENARIOS.includes(scenarioParam) ? scenarioParam : 'library';
export const world = new MockWorld(scenario);
export const desktop = new MockDesktop();
if (params.has('latency')) world.steam.latencyMs = Number(params.get('latency')) || 0;

let apiKey: string | null = scenario === 'fresh' ? null : 'mock-key';

export async function openRepo(): Promise<Repo> {
  const repo = new MemoryRepo();
  const lang = params.get('lang') === 'de' ? 'de' : 'en';
  await repo.setMeta('settings', JSON.stringify({ uiLanguage: lang, ...(scenario === 'fresh' ? {} : { steamId: 'mock', language: 'english' }) }));
  if (!params.has('tour')) await repo.setMeta('tourOffered', String(Date.now()));
  if (scenario !== 'fresh') await repo.setMeta('steamid64', world.steam.steamid);
  // As if the app ran before: the first local pass then sees changes made right after the start.
  await repo.setMeta('localScan', String(Math.floor(Date.now() / 1000) - 1));
  if (scenario === 'library' || scenario === 'nolocal') await seedSnapshots(repo);
  return repo;
}

/** Two months of daily snapshots for recently played games, so timelines have a history. */
async function seedSnapshots(repo: Repo) {
  const now = Date.now();
  const snaps = [];
  for (const f of world.fixtures) {
    const ago = (now / 1000 - f.lastPlayed) / 86_400;
    if (!f.lastPlayed || ago > 60) continue;
    for (let d = 60; d >= Math.ceil(ago); d--) {
      const t = now / 1000 - d * 86_400;
      const share = Math.max(0, 1 - (d - ago) / 90);
      snaps.push({
        date: dayKey(t * 1000),
        appid: f.appid,
        playtime: Math.round(f.playtime * share),
        unlocked: f.achievements.filter((a) => a.unlocked && a.unlocktime <= t).length,
      });
    }
  }
  await repo.addSnapshots(snaps);
}

export async function steamTransport(): Promise<{ fetch: FetchFn; baseUrl: string }> {
  return { fetch: world.steam.fetch, baseUrl: 'http://mock-steam' };
}

export const loadApiKey = async () => apiKey;
export async function saveApiKey(value: string) {
  apiKey = value;
}

export const runningAppIds = async () => [...world.running];

export async function setTrayLabels(open: string, quit: string) {
  world.trayLabels = [open, quit];
  world.changed();
}

export async function setOverlayHotkey(hotkey: string, switchHotkey: string, corner: OverlayCorner) {
  desktop.setHotkeys(hotkey.trim() || null, switchHotkey.trim() || null, corner);
}

export async function focusedAppId(candidates: number[]) {
  return world.foreground != null && candidates.includes(world.foreground) ? world.foreground : null;
}

export async function onOverlayEvents(on: { ready: () => void; closed: () => void; full: () => void; switch: () => void }) {
  desktop.listen(on);
}

export const openOverlayToast = async () => desktop.openToast();
export const closeOverlayToast = async () => desktop.closeToast();
export const sendOverlayData = async (data: OverlayData) => desktop.send(data);

export const openLocalSteam = async (): Promise<LocalSteam | null> => world.local;

export const appVersion = async () => `mock · ${scenario}`;

export async function checkForUpdate(): Promise<AppUpdate | null> {
  if (!params.has('update')) return null;
  return {
    version: '99.0.0',
    notes: 'Mock update: nothing is installed.',
    async install(onProgress) {
      for (let p = 0; p <= 100; p += 10) {
        onProgress?.(p);
        await new Promise((r) => setTimeout(r, 150));
      }
      location.reload();
    },
  };
}

export async function notify(title: string, body: string) {
  world.notify(title, body);
}
