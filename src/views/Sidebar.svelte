<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { t, type MessageKey } from '../lib/i18n.svelte';
  import { SMART_LISTS, totals } from '../lib/lists';

  let {
    listId = $bindable(),
    onSelect,
    onSettings,
    onSearch,
  }: { listId: string; onSelect: () => void; onSettings: () => void; onSearch: () => void } = $props();

  const ctx = $derived({ runningAppId: app.runningAppId, now: Math.floor(Date.now() / 1000) });
  const counts = $derived(
    Object.fromEntries(SMART_LISTS.map((l) => [l.id, app.games.filter((g) => l.filter(g, ctx)).length])),
  );
  const stats = $derived(totals(app.games));
  const running = $derived(app.games.find((g) => g.appid === app.runningAppId));

  function lastSyncLabel(ms: number | null) {
    if (!ms) return t('sidebar.never');
    const min = Math.round((Date.now() - ms) / 60000);
    return min < 1 ? t('sidebar.justNow') : min < 60 ? t('sidebar.minAgo', { n: min }) : t('sidebar.hAgo', { n: Math.round(min / 60) });
  }
</script>

<aside>
  <button class="search" onclick={onSearch}><span>{t('sidebar.search')}</span><kbd>Ctrl K</kbd></button>

  {#if running}
    <button class="live" onclick={() => { listId = 'running'; onSelect(); }}>
      <span class="dot"></span>
      <span class="name">{running.name}</span>
      <span class="small">{running.unlocked}/{running.total ?? '?'}</span>
    </button>
  {/if}

  <nav>
    {#each SMART_LISTS as l (l.id)}
      {#if l.id !== 'running' && (counts[l.id] > 0 || l.id === 'all')}
        <button
          class="ghost item"
          class:active={listId === l.id}
          title={t(`list.${l.id}.hint` as MessageKey)}
          onclick={() => { listId = l.id; onSelect(); }}
        >
          <span>{t(`list.${l.id}` as MessageKey)}</span><span class="muted small">{counts[l.id]}</span>
        </button>
      {/if}
    {/each}
  </nav>

  <div class="stats">
    <div><b>{stats.perfect}</b><span class="muted small">{t('sidebar.perfect')}</span></div>
    <div><b>{Math.round(stats.avgCompletion)} %</b><span class="muted small">{t('sidebar.avgCompletion')}</span></div>
    <div><b>{stats.unlocked}</b><span class="muted small">{t('sidebar.achievements')}</span></div>
    <div><b>{stats.rarityScore}</b><span class="muted small">{t('sidebar.rarityPoints')}</span></div>
  </div>

  <footer>
    {#if app.update}
      <button class="update" onclick={() => app.installUpdate()} disabled={app.updateState === 'installing'} title={app.update.notes || undefined}>
        {#if app.updateState === 'installing'}
          {app.updateProgress != null ? t('sidebar.installingPct', { p: Math.round(app.updateProgress) }) : t('sidebar.installing')}
        {:else}
          {t('sidebar.installUpdate', { v: app.update.version })}
        {/if}
      </button>
    {/if}
    {#if app.progress}
      <div class="small">{t('sidebar.syncProgress', { done: app.progress.done, total: app.progress.total })}</div>
      <div class="bar"><i style="width:{(app.progress.done / Math.max(app.progress.total, 1)) * 100}%"></i></div>
      {#if app.progress.current}<div class="small muted ellipsis">{app.progress.current}</div>{/if}
    {:else}
      <div class="row">
        <span class="small muted">{t('sidebar.lastSync', { when: lastSyncLabel(app.lastSync) })}</span>
        <button class="ghost small" onclick={() => app.sync()} title={t('sidebar.syncNow')}>↻</button>
        <button class="ghost small" onclick={onSettings} title={t('settings.title')}>⚙</button>
      </div>
    {/if}
    {#if app.error}<div class="small error">{app.error}</div>{/if}
  </footer>
</aside>

<style>
  aside {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    overflow: auto;
  }
  .search { display: flex; justify-content: space-between; align-items: center; color: var(--muted); }
  .live {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--accent-soft);
    border-color: transparent;
    text-align: left;
  }
  .live .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); box-shadow: 0 0 0 3px color-mix(in srgb, var(--good) 30%, transparent); }
  nav { display: grid; gap: 1px; }
  .item { display: flex; justify-content: space-between; text-align: left; padding: 6px 8px; }
  .item.active { background: var(--accent-soft); color: var(--accent); }
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: auto; }
  .stats div { display: grid; background: var(--surface-2); border-radius: 6px; padding: 6px 8px; }
  footer { display: grid; gap: 4px; }
  .row { display: flex; align-items: center; gap: 2px; }
  .row span { flex: 1; }
  .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .error { color: var(--warn); }
  .update { background: var(--accent-soft); color: var(--accent); border-color: transparent; text-align: left; }
</style>
