import { describe, expect, it } from 'vitest';
import { restoredSettings, type Settings } from '../src/lib/app.svelte';
import { buildDiagnostics } from '../src/lib/diagnostics';
import { log, redact, sessionLog } from '../src/lib/log';
import { DEFAULT_OVERLAY } from '../src/lib/overlay';
import { SyncEngine } from '../src/lib/sync/engine';
import { MemoryRepo } from '../src/lib/db/repo';
import { FakeSteam } from '../src/dev/fakeSteam';
import { emptyGame } from '../src/lib/types';

const KEY = '0123456789ABCDEF0123456789ABCDEF';
const STEAMID = '76561198012345678';

const settings: Settings = {
  steamId: 'https://steamcommunity.com/id/someone',
  uiLanguage: 'en',
  language: 'english',
  intervalMinutes: 60,
  staleDays: 14,
  revealHidden: false,
  notifyUnlocks: true,
  warnMissable: true,
  sessionRecap: true,
  milestoneSound: true,
  overlay: DEFAULT_OVERLAY,
};

describe('redact', () => {
  it('removes API keys, SteamIDs and the Windows user name', () => {
    const text = redact(
      `GET https://api.steampowered.com/x?key=${KEY}&steamid=${STEAMID} failed; raw ${KEY.toLowerCase()} in C:\\Users\\Fynn\\AppData and /Users/fynn/x`,
    );
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(KEY.toLowerCase());
    expect(text).not.toContain(STEAMID);
    expect(text).not.toMatch(/fynn/i);
    expect(text).toContain('key=<key>');
    expect(text).toContain('C:\\Users\\<user>\\AppData');
  });

  it('leaves icon hashes (40 hex) and appids alone', () => {
    const hash = 'a'.repeat(40);
    expect(redact(`icon ${hash} appid 1145360`)).toBe(`icon ${hash} appid 1145360`);
  });

  it('the log redacts before anything is stored', () => {
    log.warn('Request failed', new Error(`key=${KEY}`));
    expect(sessionLog()).toContain('Request failed: Error: key=<key>');
    expect(sessionLog()).not.toContain(KEY);
  });
});

describe('diagnostics', () => {
  it('reports the state without the profile or the key', () => {
    const text = buildDiagnostics({
      version: '1.0.0',
      os: 'Windows 11 24H2 (build 26100)',
      steamInstalled: true,
      localCache: true,
      schemaVersion: 1,
      games: [{ ...emptyGame(1, 'A'), total: 10 }, { ...emptyGame(2, 'B'), total: null }],
      lastSync: Date.UTC(2026, 9, 7, 12),
      error: null,
      settings,
      log: `2026-10-07 INFO started for ${STEAMID} with ${KEY}`,
    });
    expect(text).toContain('Achievement Hunter 1.0.0');
    expect(text).toContain('Games: 2 (with achievements: 1, not loaded yet: 1, not owned: 0)');
    expect(text).toContain('Last library sync: 2026-10-07T12:00:00.000Z');
    expect(text).toContain('"intervalMinutes":60');
    expect(text).not.toContain('someone');
    expect(text).not.toContain(STEAMID);
    expect(text).not.toContain(KEY);
  });
});

describe('restoredSettings', () => {
  it('takes known settings, keeps account and achievement language', () => {
    const out = restoredSettings(settings, {
      steamId: 'other',
      language: 'german',
      intervalMinutes: 30,
      revealHidden: true,
      overlay: { ...DEFAULT_OVERLAY, hotkey: 'Ctrl+F9' },
    });
    expect(out).toMatchObject({ steamId: settings.steamId, language: 'english', intervalMinutes: 30, revealHidden: true });
    expect(out.overlay.hotkey).toBe('Ctrl+F9');
  });

  it('ignores unknown keys, wrong types and invalid choices', () => {
    const out = restoredSettings(settings, {
      uiLanguage: 'xx',
      intervalMinutes: '5',
      bogus: 1,
      overlay: { corner: 'middle' },
    } as never);
    expect(out).toEqual(settings);
  });
});

describe('SyncEngine.stop', () => {
  it('waits for a run in flight, which skips its remaining games', async () => {
    const steam = new FakeSteam();
    for (let i = 1; i <= 20; i++) steam.add({ appid: i, name: `G${i}`, playtime: 10, lastPlayed: 1, achievements: { a: [false, 0, 50] } });
    steam.latencyMs = 5;
    const repo = new MemoryRepo();
    const engine = new SyncEngine({ api: steam.api(), repo, steamid: STEAMID });
    const run = engine.sync();
    await new Promise((r) => setTimeout(r, 20));
    await engine.stop();
    // Nothing writes after stop() resolved.
    const saved = JSON.stringify([...repo.games.values()]);
    await run;
    await new Promise((r) => setTimeout(r, 50));
    expect(JSON.stringify([...repo.games.values()])).toBe(saved);
    expect([...repo.games.values()].filter((g) => g.total != null).length).toBeLessThan(20);
    expect((await engine.syncGame(1)).tasks).toBe(0);
  });
});
