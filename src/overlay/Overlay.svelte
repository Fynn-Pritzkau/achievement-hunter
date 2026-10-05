<script lang="ts">
  import { onMount } from 'svelte';
  import { emit, listen } from '@tauri-apps/api/event';
  import { setLocale, t } from '../lib/i18n.svelte';
  import { BUNDLE_MS, type OverlayAch, type OverlayData } from '../lib/overlay';
  import { fmtPercent } from '../lib/util';

  let data = $state<OverlayData | null>(null);
  let game = $derived(data?.game ?? null);
  let percent = $derived(game && game.total ? Math.round((game.unlocked / game.total) * 100) : 0);

  onMount(() => {
    const unlisten = listen<OverlayData>('overlay:data', (e) => {
      setLocale(e.payload.locale);
      data = e.payload;
    });
    // Ask the main window for data only once we can receive it.
    void unlisten.then(() => emit('overlay:ready'));
    return () => void unlisten.then((f) => f());
  });

  const fmtNum = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));
  /** Only bumps that just happened flash; an old one would replay when the overlay opens. */
  const fresh = (a: OverlayAch) => !!a.bump && Date.now() - a.bump.at < BUNDLE_MS;
</script>

{#snippet item(a: OverlayAch)}
  <li>
    {#if a.icon}<img src={a.icon} alt="" />{:else}<span class="noicon">🏆</span>{/if}
    <div class="text">
      <div class="name">{a.name}</div>
      {#if a.progress}
        <div class="progress">
          <div class="bar small"><i style:width="{Math.min(100, (a.progress.current / a.progress.max) * 100)}%"></i></div>
          <span class="nums">{fmtNum(a.progress.current)} / {fmtNum(a.progress.max)}</span>
          {#if a.bump && fresh(a)}
            {#key a.bump.at}<span class="delta">+{fmtNum(a.bump.delta)}</span>{/key}
          {/if}
        </div>
      {:else if a.description}
        <div class="desc">{a.description}</div>
      {/if}
    </div>
    <span class="pct">{fmtPercent(a.percent)}</span>
  </li>
{/snippet}

{#if data && (data.mode === 'full' || data.recent.length)}
  <main class={data.corner}>
    <div class="card" class:toast={data.mode === 'toast'}>
      {#if !game}
        <div class="muted">{t('overlay.noGame')}</div>
      {:else}
        {#if data.showProgress}
          <div class="head">
            <span class="title">{game.name}</span>
            <span class="count">{game.unlocked}/{game.total}</span>
          </div>
          <div class="bar"><i style:width="{percent}%"></i></div>
        {/if}
        {#if data.recent.length}
          <h3>{data.mode === 'toast' ? game.name : t('overlay.progress')}</h3>
          <ul>{#each data.recent as a (a.apiname)}{@render item(a)}{/each}</ul>
        {/if}
        {#if data.pinned.length}
          <h3>{t('overlay.pinned')}</h3>
          <ul>{#each data.pinned as a (a.apiname)}{@render item(a)}{/each}</ul>
        {/if}
        {#if data.next.length}
          <h3>{t('overlay.next')}</h3>
          <ul>{#each data.next as a (a.apiname)}{@render item(a)}{/each}</ul>
        {/if}
        {#if data.mode === 'full' && game.unlocked >= game.total}<div class="muted">{t('overlay.perfect')}</div>{/if}
      {/if}
    </div>
  </main>
{/if}

<style>
  /* The window is transparent; only the card is visible, and it never takes the mouse. */
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: transparent;
    overflow: hidden;
    user-select: none;
    font: 13px/1.35 system-ui, 'Segoe UI', sans-serif;
    color: #e9ecf1;
  }
  main { position: fixed; inset: 0; display: flex; flex-direction: column; }
  main.tl, main.tr { justify-content: flex-start; }
  main.bl, main.br { justify-content: flex-end; }
  main.tl, main.bl { align-items: flex-start; }
  main.tr, main.br { align-items: flex-end; }
  .card {
    width: 100%;
    max-height: 100%;
    overflow: hidden;
    box-sizing: border-box;
    padding: 10px 12px;
    background: rgb(16 18 22 / 0.82);
    border: 1px solid rgb(255 255 255 / 0.08);
    border-radius: 10px;
    display: grid;
    gap: 6px;
  }
  .card.toast { animation: slide-in 180ms ease-out; border-color: rgb(240 194 90 / 0.35); }
  @keyframes slide-in { from { opacity: 0; transform: translateY(-6px); } }
  .head { display: flex; gap: 8px; align-items: baseline; }
  .title { flex: 1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { font-variant-numeric: tabular-nums; color: #f0c25a; }
  .bar { height: 4px; border-radius: 2px; background: rgb(255 255 255 / 0.12); overflow: hidden; }
  .bar i { display: block; height: 100%; background: #f0c25a; transition: width 400ms ease-out; }
  .bar.small { flex: 1; height: 3px; }
  h3 { margin: 4px 0 0; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #9aa3b2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  li { display: flex; gap: 8px; align-items: center; }
  img, .noicon { width: 32px; height: 32px; border-radius: 4px; flex: none; }
  .noicon { display: grid; place-items: center; background: rgb(255 255 255 / 0.08); }
  .text { flex: 1; min-width: 0; }
  .name, .desc { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .desc { font-size: 12px; color: #9aa3b2; }
  .progress { display: flex; gap: 6px; align-items: center; font-size: 12px; color: #9aa3b2; }
  .nums { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .delta { color: #f0c25a; font-weight: 600; animation: flash 4s ease-out forwards; }
  @keyframes flash { 0% { opacity: 0; transform: translateY(3px); } 8%, 70% { opacity: 1; transform: none; } 100% { opacity: 0; } }
  .pct { font-size: 12px; color: #9aa3b2; font-variant-numeric: tabular-nums; }
  .muted { color: #9aa3b2; }
</style>
