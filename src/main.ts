import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { logUncaught } from './lib/log';
import { isMock } from './lib/platform';

logUncaught();

export default mount(App, { target: document.getElementById('app')! });

if (import.meta.env.DEV && isMock) void import('./dev/panel').then((m) => m.mountPanel());
