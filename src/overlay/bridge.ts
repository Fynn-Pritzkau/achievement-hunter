import type { OverlayData } from '../lib/overlay';

/** The mock mode runs the overlay in an iframe and talks over a BroadcastChannel (see src/dev/desktop.ts). */
const isMock = import.meta.env.DEV && new URLSearchParams(location.search).has('mock');

/**
 * Receives data from the main window and asks for the first batch once it can receive it.
 * Returns the disconnect function.
 */
export async function connectOverlay(onData: (d: OverlayData) => void): Promise<() => void> {
  if (import.meta.env.DEV && isMock) {
    const { OVERLAY_CHANNEL } = await import('../dev/desktop');
    const ch = new BroadcastChannel(OVERLAY_CHANNEL);
    ch.onmessage = (e) => {
      if (e.data?.type === 'data') onData(e.data.payload);
    };
    ch.postMessage({ type: 'ready' });
    return () => ch.close();
  }
  const { emit, listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<OverlayData>('overlay:data', (e) => onData(e.payload));
  await emit('overlay:ready');
  return unlisten;
}
