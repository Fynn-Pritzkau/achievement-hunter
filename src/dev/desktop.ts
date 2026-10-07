/**
 * Stands in for the Rust side of the overlay (src-tauri/src/lib.rs) in the mock mode: the same
 * window states (closed / toast / full), the same events, the hotkeys bound to this page's keys.
 * The overlay page runs in an iframe in the chosen corner and talks over a BroadcastChannel
 * (see src/overlay/bridge.ts), so a second tab with overlay.html?mock receives the data too.
 */
import type { OverlayCorner, OverlayData } from '../lib/overlay';

export const OVERLAY_CHANNEL = 'achievement-hunter-overlay';
const SIZE = { w: 360, h: 520 };
const MARGIN = 16;

type Handlers = { ready: () => void; closed: () => void; full: () => void; switch: () => void };

export interface DesktopState {
  open: boolean;
  toast: boolean;
  hotkey: string | null;
  switchHotkey: string | null;
  corner: OverlayCorner;
  /** Last data the main window sent, for the panel. */
  last: OverlayData | null;
}

const MODIFIERS = new Set(['ctrl', 'control', 'shift', 'alt', 'super', 'cmd', 'commandorcontrol', 'meta']);

/** Same rules as the global-hotkey crate, roughly: modifiers + exactly one key. */
export function parseHotkey(h: string): { mods: Set<string>; key: string } {
  const parts = h.split('+').map((p) => p.trim().toLowerCase());
  const mods = new Set(parts.filter((p) => MODIFIERS.has(p)).map((p) => (p === 'control' || p === 'commandorcontrol' ? 'ctrl' : p)));
  const keys = parts.filter((p) => !MODIFIERS.has(p));
  if (keys.length !== 1 || !/^([a-z0-9]|f\d{1,2}|space|tab|enter|escape|backquote)$/.test(keys[0])) {
    throw new Error(`Couldn't parse "${h}" as a hotkey`);
  }
  return { mods, key: keys[0] };
}

function matches(e: KeyboardEvent, h: string | null): boolean {
  if (!h) return false;
  try {
    const { mods, key } = parseHotkey(h);
    const k = e.code.replace(/^Key|^Digit/, '').toLowerCase();
    return (
      k === key &&
      e.ctrlKey === mods.has('ctrl') &&
      e.shiftKey === mods.has('shift') &&
      e.altKey === mods.has('alt') &&
      e.metaKey === (mods.has('super') || mods.has('cmd') || mods.has('meta'))
    );
  } catch {
    return false;
  }
}

export class MockDesktop {
  state: DesktopState = { open: false, toast: false, hotkey: null, switchHotkey: null, corner: 'tr', last: null };
  private handlers: Handlers | null = null;
  private frame: HTMLIFrameElement | null = null;
  private channel = new BroadcastChannel(OVERLAY_CHANNEL);
  private listeners = new Set<() => void>();

  constructor() {
    this.channel.onmessage = (e) => {
      if (e.data?.type === 'ready') this.handlers?.ready();
    };
    window.addEventListener('keydown', (e) => {
      if (matches(e, this.state.hotkey)) {
        e.preventDefault();
        this.pressHotkey();
      } else if (matches(e, this.state.switchHotkey)) {
        e.preventDefault();
        this.pressSwitch();
      }
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }

  listen(h: Handlers) {
    this.handlers = h;
  }

  setHotkeys(hotkey: string | null, switchHotkey: string | null, corner: OverlayCorner) {
    if (hotkey) parseHotkey(hotkey);
    if (switchHotkey) parseHotkey(switchHotkey);
    this.state.hotkey = hotkey;
    this.state.switchHotkey = switchHotkey && switchHotkey.toLowerCase() !== hotkey?.toLowerCase() ? switchHotkey : null;
    this.state.corner = corner;
    this.changed();
  }

  /** open_overlay_toast */
  openToast(): boolean {
    if (this.state.open) return false;
    this.state.toast = true;
    this.openWindow();
    return true;
  }

  /** close_overlay_toast */
  closeToast() {
    if (this.state.toast) this.destroy();
  }

  /** The global hotkey (toggle_overlay). */
  pressHotkey() {
    const wasToast = this.state.toast;
    this.state.toast = false;
    if (this.state.open) {
      if (wasToast) this.handlers?.full();
      else this.destroy();
    } else {
      this.openWindow();
    }
    this.changed();
  }

  /** The switch hotkey is only bound while the full overlay is open. */
  pressSwitch() {
    if (this.state.open && !this.state.toast) this.handlers?.switch();
  }

  send(data: OverlayData) {
    this.state.last = data;
    this.channel.postMessage({ type: 'data', payload: plain(data) });
    this.changed();
  }

  private openWindow() {
    this.state.open = true;
    const f = document.createElement('iframe');
    f.src = '/overlay.html?mock';
    f.title = 'Overlay';
    f.dataset.mockOverlay = '';
    const { corner } = this.state;
    Object.assign(f.style, {
      position: 'fixed',
      width: `${SIZE.w}px`,
      height: `${SIZE.h}px`,
      border: '0',
      background: 'transparent',
      colorScheme: 'normal',
      pointerEvents: 'none',
      zIndex: '2147483000',
      [corner.startsWith('t') ? 'top' : 'bottom']: `${MARGIN}px`,
      [corner.endsWith('l') ? 'left' : 'right']: `${MARGIN}px`,
    });
    f.setAttribute('allowtransparency', 'true');
    document.body.appendChild(f);
    this.frame = f;
    this.changed();
  }

  private destroy() {
    this.frame?.remove();
    this.frame = null;
    this.state.open = this.state.toast = false;
    this.state.last = null;
    this.handlers?.closed();
    this.changed();
  }
}

/** Plain copy of reactive data; BroadcastChannel can't clone Svelte proxies. */
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
