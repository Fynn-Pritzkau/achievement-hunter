/**
 * Small app log for bug reports. In the app, lines go to a rotating file (Rust, see diag.rs);
 * elsewhere only to a short in-memory buffer. Everything is redacted before it leaves this file.
 */

type Level = 'info' | 'warn' | 'error';
type Sink = (level: Level, message: string) => Promise<void>;

/** Lines kept in memory when there is no log file (browser and mock mode). */
const BUFFER_LINES = 200;
const buffer: string[] = [];
let sink: Sink | null = null;

/**
 * Removes what must never end up in a log or a bug report: the API key (also in URLs),
 * SteamIDs and the Windows user name in paths.
 */
export function redact(text: string): string {
  return text
    .replace(/([?&]key=)[^&\s"']+/gi, '$1<key>')
    .replace(/\b[0-9A-F]{32}\b/gi, '<key>')
    .replace(/\b7656119\d{10}\b/g, '<steamid>')
    .replace(/([\\/](?:Users|home)[\\/])[^\\/\s"']+/gi, '$1<user>');
}

/** Where lines go besides the memory buffer. Set once by the platform at start. */
export function setLogSink(s: Sink | null) {
  sink = s;
}

function write(level: Level, message: string, err?: unknown) {
  const detail = err == null ? '' : `: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`;
  const line = redact(`${message}${detail}`);
  buffer.push(`${new Date().toISOString()} ${level.toUpperCase()} ${line}`);
  if (buffer.length > BUFFER_LINES) buffer.shift();
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  sink?.(level, line).catch(() => {});
}

export const log = {
  info: (message: string) => write('info', message),
  warn: (message: string, err?: unknown) => write('warn', message, err),
  error: (message: string, err?: unknown) => write('error', message, err),
};

/** Lines logged in this session (the fallback when there is no log file). */
export const sessionLog = () => buffer.join('\n');

/** Logs errors nothing else caught. */
export function logUncaught() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => log.error(`Uncaught at ${e.filename?.split('/').pop()}:${e.lineno}`, e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => log.error('Unhandled rejection', e.reason));
}
