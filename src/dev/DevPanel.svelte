<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/app.svelte';
  import { desktop, scenario, world } from './mock';
  import { SCENARIOS, type MockNotification } from './world';

  /** Bumped whenever the fake Steam or the desktop changes. */
  let tick = $state(0);
  // Small windows start with the panel collapsed, so it doesn't hide the sidebar.
  const panelParam = new URLSearchParams(location.search).get('panel');
  let open = $state(panelParam ? panelParam !== '0' : innerWidth >= 1200);
  let appid = $state<number>(world.running[0] ?? world.fixtures.find((f) => f.lastPlayed && f.achievements.length)?.appid ?? 0);
  let minutes = $state(30);
  // Raw: the entries are compared by identity when they expire.
  let toasts = $state.raw<MockNotification[]>([]);
  let lastNote = 0;

  onMount(() => {
    const offs = [
      world.subscribe(() => {
        tick++;
        const fresh = world.notifications.filter((n) => n.at > lastNote);
        if (fresh.length) {
          lastNote = fresh[0].at;
          toasts = [...fresh, ...toasts].slice(0, 4);
          for (const n of fresh) setTimeout(() => (toasts = toasts.filter((x) => x !== n)), 6000);
        }
      }),
      desktop.subscribe(() => tick++),
    ];
    return () => offs.forEach((f) => f());
  });

  const v = $derived.by(() => {
    void tick;
    const g = world.game(appid);
    const byEndpoint = new Map<string, number>();
    for (const c of world.steam.calls) {
      const name = c.split('/')[2] ?? c;
      byEndpoint.set(name, (byEndpoint.get(name) ?? 0) + 1);
    }
    const progress = world.local?.games.get(appid)?.progress ?? {};
    return {
      game: g,
      open: world.open(appid).length,
      total: g ? Object.keys(g.achievements).length : 0,
      stats: Object.entries(progress).filter(([n]) => !g?.achievements[n]?.[0]),
      running: [...world.running],
      foreground: world.foreground,
      calls: world.steam.calls.length,
      byEndpoint: [...byEndpoint].sort((a, b) => b[1] - a[1]),
      recent: world.steam.calls.slice(-6).reverse(),
      faults: {
        privateProfile: world.steam.privateProfile,
        emptyOwnedNext: world.steam.emptyOwnedNext,
        rateLimitNext: world.steam.rateLimitNext,
        serverErrorNext: world.steam.serverErrorNext,
        playerPrivate: !!g?.playerPrivate,
      },
      overlay: { ...desktop.state },
      notifications: world.notifications.slice(0, 5),
    };
  });

  // The scheduler's 15 s poll, on demand.
  const schedulerTick = () => (app as unknown as { scheduler?: { tick(): Promise<void> } }).scheduler?.tick();
  const name = (id: number) => world.game(id)?.name ?? String(id);
  const time = (ms: number) => new Date(ms).toLocaleTimeString();

  function reload(next: string) {
    const p = new URLSearchParams(location.search);
    p.set('mock', next);
    location.search = p.toString();
  }

  function fault(f: () => void) {
    f();
    world.changed();
  }
</script>

{#if open}
  <aside class="panel" aria-label="Mock controls" data-mock-panel>
    <header>
      <strong>Mock</strong>
      <select value={scenario} onchange={(e) => reload(e.currentTarget.value)} title="Scenario (reloads)">
        {#each SCENARIOS as s}<option value={s}>{s}</option>{/each}
      </select>
      <span class="grow"></span>
      <button class="icon" onclick={() => (open = false)} title="Collapse">–</button>
    </header>

    <section>
      <h4>Game</h4>
      <select bind:value={appid}>
        {#each world.games as g}<option value={g.appid}>{g.name}{g.notOwned ? ' (shared)' : ''}</option>{/each}
      </select>
      {#if v.game}
        <div class="small muted">
          {v.total - v.open}/{v.total} · {Math.round(v.game.playtime / 60)} h{v.running.includes(appid) ? ' · running' : ''}{v.foreground === appid ? ' · in front' : ''}
        </div>
      {/if}
      <div class="row">
        {#if v.running.includes(appid)}
          <button onclick={() => world.stop(appid, minutes)}>■ Stop</button>
          <label class="small">after <input type="number" min="1" bind:value={minutes} /> min</label>
          {#if v.foreground !== appid}<button onclick={() => fault(() => (world.foreground = appid))}>To front</button>{/if}
        {:else}
          <button onclick={() => world.start(appid)}>▶ Start</button>
        {/if}
      </div>
      <div class="row">
        <button disabled={!v.open} onclick={() => world.unlock(appid)}>Unlock next</button>
        <button disabled={!v.stats.length} onclick={() => world.bump(appid, undefined, 1)} title={v.stats.map(([n, [c, m]]) => `${n} ${c}/${m}`).join('\n')}>Stat +1</button>
        <button disabled={!v.stats.length} onclick={() => world.bump(appid, undefined, 'step')} title="Up to the next overlay popup step">+1 step</button>
      </div>
      <div class="row">
        <button disabled={!v.open} onclick={() => world.playElsewhere(appid)} title="Unlock + 45 min on the servers only; this PC's cache stays old">Played elsewhere</button>
        <button onclick={() => world.gameUpdate(appid)} title="Adds 3 achievements">Game update</button>
      </div>
    </section>

    <section>
      <h4>App</h4>
      <div class="row">
        <button onclick={() => app.sync()}>Sync</button>
        <button onclick={() => app.sync(true)}>Force sync</button>
        <button onclick={() => schedulerTick()} title="Running games + Steam cache poll (every 15 s)">Tick</button>
      </div>
      <div class="row">
        <button onclick={() => desktop.pressHotkey()} title={v.overlay.hotkey ?? 'no hotkey'}>Overlay hotkey</button>
        <button disabled={!v.overlay.open || v.overlay.toast} onclick={() => desktop.pressSwitch()} title={v.overlay.switchHotkey ?? 'no hotkey'}>Switch</button>
        <span class="small muted">{v.overlay.open ? (v.overlay.toast ? 'toast' : 'full') : 'closed'}</span>
      </div>
    </section>

    <section>
      <h4>Steam faults</h4>
      <div class="row">
        <button onclick={() => fault(() => (world.steam.emptyOwnedNext += 3))} title="More than the retries cover">Empty library ×3 {v.faults.emptyOwnedNext ? `(${v.faults.emptyOwnedNext})` : ''}</button>
        <button onclick={() => fault(() => (world.steam.rateLimitNext += 6))}>429 ×6 {v.faults.rateLimitNext ? `(${v.faults.rateLimitNext})` : ''}</button>
        <button onclick={() => fault(() => (world.steam.serverErrorNext += 2))}>503 ×2 {v.faults.serverErrorNext ? `(${v.faults.serverErrorNext})` : ''}</button>
      </div>
      <label class="check"><input type="checkbox" checked={v.faults.privateProfile} onchange={(e) => fault(() => (world.steam.privateProfile = e.currentTarget.checked))} /> Game details private</label>
      <label class="check"><input type="checkbox" checked={v.faults.playerPrivate} disabled={!v.game} onchange={(e) => fault(() => v.game && (v.game.playerPrivate = e.currentTarget.checked))} /> “Not public” for this game</label>
    </section>

    <section>
      <h4>API calls <span class="muted">{v.calls}</span> <button class="link" onclick={() => fault(() => (world.steam.calls = []))}>reset</button></h4>
      <ul class="small mono">
        {#each v.byEndpoint as [endpoint, n]}<li>{n} × {endpoint}</li>{/each}
      </ul>
      {#if v.recent.length}<div class="small muted mono recent">{v.recent.join('\n')}</div>{/if}
    </section>

    {#if v.notifications.length}
      <section>
        <h4>Notifications</h4>
        <ul class="small">
          {#each v.notifications as n}<li><span class="muted">{time(n.at)}</span> <b>{n.title}</b> {n.body}</li>{/each}
        </ul>
      </section>
    {/if}
    {#if v.running.length}<div class="small muted">Running: {v.running.map(name).join(', ')}</div>{/if}
  </aside>
{:else}
  <button class="pill" onclick={() => (open = true)} data-mock-panel>Mock{v.calls ? ` · ${v.calls}` : ''}</button>
{/if}

<div class="toasts" aria-live="polite">
  {#each toasts as n (n)}
    <div class="toast" data-mock-notification><b>{n.title}</b><span>{n.body}</span></div>
  {/each}
</div>

<style>
  .panel {
    position: fixed;
    left: 12px;
    bottom: 12px;
    z-index: 2147483100;
    width: 300px;
    max-height: calc(100vh - 24px);
    overflow: auto;
    padding: 10px 12px;
    display: grid;
    gap: 10px;
    background: var(--surface);
    border: 1px dashed #a35bd6;
    border-radius: var(--radius);
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.25);
    font-size: 12.5px;
  }
  header { display: flex; gap: 6px; align-items: center; }
  header strong { color: #a35bd6; }
  .grow { flex: 1; }
  section { display: grid; gap: 5px; }
  h4 { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); display: flex; gap: 6px; align-items: baseline; }
  .row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  button { padding: 3px 8px; font-size: 12px; }
  button.icon { padding: 0 8px; }
  button.link { background: none; border: 0; padding: 0; color: var(--accent); text-transform: none; letter-spacing: 0; cursor: pointer; }
  select { width: 100%; font-size: 12px; }
  header select { width: auto; }
  input[type='number'] { width: 52px; padding: 1px 4px; }
  .check { display: flex; gap: 6px; align-items: center; }
  .small { font-size: 11.5px; }
  .muted { color: var(--muted); }
  .mono { font-family: ui-monospace, Consolas, monospace; }
  ul { margin: 0; padding-left: 16px; }
  .recent { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
  .pill {
    position: fixed;
    left: 12px;
    bottom: 12px;
    z-index: 2147483100;
    border: 1px dashed #a35bd6;
    color: #a35bd6;
    background: var(--surface);
    border-radius: 999px;
    font-size: 12px;
  }
  .toasts {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 2147483200;
    display: grid;
    gap: 8px;
    width: 320px;
    pointer-events: none;
  }
  .toast {
    display: grid;
    gap: 2px;
    padding: 10px 12px;
    background: #23262d;
    color: #f2f3f5;
    border-radius: 8px;
    box-shadow: 0 6px 22px rgb(0 0 0 / 0.35);
    font-size: 12.5px;
    animation: slide 0.2s ease-out;
  }
  .toast span { color: #c4c8d0; }
  @keyframes slide { from { transform: translateX(20px); opacity: 0; } }
</style>
