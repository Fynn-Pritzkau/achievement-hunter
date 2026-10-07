import type { Settings } from './app.svelte';
import { redact } from './log';
import type { Game } from './types';

export interface DiagnosticsInput {
  version: string;
  os: string;
  steamInstalled: boolean | null;
  localCache: boolean;
  schemaVersion: number | null;
  games: Game[];
  lastSync: number | null;
  error: string | null;
  settings: Settings;
  log: string;
}

/** Text for bug reports. No API key, no SteamID, no profile name; the log is redacted again. */
export function buildDiagnostics(d: DiagnosticsInput): string {
  const { steamId: _profile, ...settings } = d.settings;
  const withAch = d.games.filter((g) => (g.total ?? 0) > 0);
  const unknown = d.games.filter((g) => g.total == null).length;
  const yesNo = (v: boolean | null) => (v == null ? 'unknown' : v ? 'yes' : 'no');
  const lines = [
    `Achievement Hunter ${d.version}`,
    `OS: ${d.os}`,
    `Steam client installed: ${yesNo(d.steamInstalled)}`,
    `Reads Steam's local cache: ${yesNo(d.localCache)}`,
    `Database schema: ${d.schemaVersion ?? 'n/a'}`,
    `Games: ${d.games.length} (with achievements: ${withAch.length}, not loaded yet: ${unknown}, not owned: ${d.games.filter((g) => !g.owned).length})`,
    `Last library sync: ${d.lastSync ? new Date(d.lastSync).toISOString() : 'never'}`,
    `Current error: ${d.error ?? 'none'}`,
    `Settings: ${JSON.stringify(settings)}`,
    '',
    '--- log ---',
    d.log.trim() || '(empty)',
  ];
  return redact(lines.join('\n'));
}
