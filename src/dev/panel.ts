import { mount } from 'svelte';
import { app } from '../lib/app.svelte';
import DevPanel from './DevPanel.svelte';
import { backups, desktop, world } from './mock';

/** Mounts the mock controls and exposes the mock in the console as `mock`. */
export function mountPanel() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mount(DevPanel, { target });
  const internals = app as unknown as { scheduler?: { tick(): Promise<void> }; engine?: { busy: boolean }; startedAt: number };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  Object.assign(window, {
    mock: {
      world,
      desktop,
      app,
      /** Backups the app saved (export, account switch). */
      backups,
      /** The scheduler's 15 s poll (running games, Steam cache), right now. */
      tick: () => internals.scheduler?.tick(),
      /**
       * Resolves once the startup sync is done. `live: true` also waits out the first 10 s after
       * the start, in which games count as already running (no start warning, no session recap).
       */
      async ready({ live = false } = {}) {
        while (!app.ready || (app.configured && (!internals.engine || internals.engine.busy || app.lastSync == null))) await sleep(100);
        if (live) await sleep(Math.max(0, internals.startedAt + 10_500 - Date.now()));
      },
      sleep,
    },
  });
}
