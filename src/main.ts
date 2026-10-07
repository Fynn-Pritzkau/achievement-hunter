import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { logUncaught } from './lib/log';
import { isMock } from './lib/platform';

logUncaught();

export default mount(App, { target: document.getElementById('app')! });

if (import.meta.env.DEV && isMock) void import('./dev/panel').then((m) => m.mountPanel());

if (import.meta.env.DEV) {
  /** Console: `await estimateBacktest()` compares the old and new "to 100 %" estimate on the stored history. */
  (window as any).estimateBacktest = async () => {
    const [{ app }, { backtest }] = await Promise.all([import('./lib/app.svelte'), import('./lib/estimate')]);
    const r = await backtest(app.repo);
    console.table(r.games);
    return r.summary;
  };
}
