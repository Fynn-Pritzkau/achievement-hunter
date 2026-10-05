<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { t, type MessageKey } from '../lib/i18n.svelte';
  import { LIST_SECTIONS, SMART_LISTS, totals } from '../lib/lists';
  import { APP_ACHIEVEMENTS } from '../lib/appAchievements';

  let {
    listId = $bindable(),
    onSelect,
    onSettings,
    onSearch,
  }: { listId: string; onSelect: () => void; onSettings: () => void; onSearch: () => void } = $props();

  const ctx = $derived({ runningAppIds: app.runningAppIds, now: Math.floor(Date.now() / 1000) });
  const counts = $derived(
    Object.fromEntries(SMART_LISTS.map((l) => [l.id, app.games.filter((g) => l.filter(g, ctx)).length])),
  );
  const stats = $derived(totals(app.games));
  const appAchCount = $derived(Object.keys(app.appAchievements).length);
  const running = $derived(app.games.filter((g) => app.runningAppIds.includes(g.appid)));
  /** Lists with entries ('all' always), grouped; empty sections disappear. */
  const sections = $derived(
    LIST_SECTIONS.map((s) => ({ ...s, lists: s.lists.filter((id) => counts[id] > 0 || id === 'all') })).filter((s) => s.lists.length),
  );

  // Collapsed sections are a per-machine view preference, so localStorage is enough.
  const COLLAPSED_KEY = 'sidebar.collapsed';
  let collapsed = $state<Record<string, boolean>>(loadCollapsed());

  function loadCollapsed(): Record<string, boolean> {
    const defaults = Object.fromEntries(LIST_SECTIONS.map((s) => [s.id, !!s.collapsed]));
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}') };
    } catch {
      return defaults;
    }
  }

  function toggle(id: string) {
    collapsed[id] = !collapsed[id];
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
    } catch {}
  }

  function select(id: string) {
    listId = id;
    onSelect();
  }

  function lastSyncLabel(ms: number | null) {
    if (!ms) return t('sidebar.never');
    const min = Math.round((Date.now() - ms) / 60000);
    return min < 1 ? t('sidebar.justNow') : min < 60 ? t('sidebar.minAgo', { n: min }) : t('sidebar.hAgo', { n: Math.round(min / 60) });
  }
</script>

<aside>
  <button class="search" data-tour="search" onclick={onSearch}><span>{t('sidebar.search')}</span><kbd>Ctrl K</kbd></button>

  {#each running as g (g.appid)}
    <button class="live" data-tour="live" onclick={() => select('running')}>
      <span class="dot"></span>
      <span class="name">{g.name}</span>
      <span class="small">{g.unlocked}/{g.total ?? '?'}</span>
    </button>
  {/each}

  <nav data-tour="lists">
    {#each sections as s (s.id)}
      <!-- The active list stays visible even in a collapsed section. -->
      {@const open = !collapsed[s.id] || s.lists.includes(listId)}
      <div class="section">
        {#if s.id !== 'library'}
          <button class="ghost head" onclick={() => toggle(s.id)} aria-expanded={open}>
            <span>{t(`section.${s.id}` as MessageKey)}</span><span class="chev" class:open>›</span>
          </button>
        {/if}
        {#if open}
          {#each s.lists as id (id)}
            <button class="ghost item" class:active={listId === id} title={t(`list.${id}.hint` as MessageKey)} onclick={() => select(id)}>
              <span>{t(`list.${id}` as MessageKey)}</span><span class="muted small">{counts[id]}</span>
            </button>
          {/each}
        {/if}
      </div>
    {/each}
  </nav>

  <button class="ghost item" data-tour="history" class:active={listId === 'history'} onclick={() => select('history')}>
    <span>{t('sidebar.history')}</span>
  </button>

  <button class="profile" data-tour="milestones" class:active={listId === 'appAchievements'} onclick={() => select('appAchievements')} title={t('sidebar.openMilestones')}>
    <div class="stats">
      <div><b>{stats.perfect}</b><span class="muted small">{t('sidebar.perfect')}</span></div>
      <div><b>{Math.round(stats.avgCompletion)} %</b><span class="muted small">{t('sidebar.avgCompletion')}</span></div>
      <div><b>{stats.unlocked}</b><span class="muted small">{t('sidebar.achievements')}</span></div>
      <div><b>{stats.rarityScore}</b><span class="muted small">{t('sidebar.rarityPoints')}</span></div>
    </div>
    <div class="milestones">
      <span class="small">🏅 {t('sidebar.appAchievements')}</span>
      <span class="muted small">{appAchCount}/{APP_ACHIEVEMENTS.length}</span>
    </div>
    <div class="bar" class:perfect={appAchCount === APP_ACHIEVEMENTS.length}>
      <i style="width:{(appAchCount / APP_ACHIEVEMENTS.length) * 100}%"></i>
    </div>
  </button>

  <footer data-tour="sync">
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
        <button class="ghost small" data-tour="tour" onclick={() => app.startTour()} title={t('sidebar.tour')}>?</button>
        <button class="ghost small" data-tour="settings" onclick={onSettings} title={t('settings.title')}>⚙</button>
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
  nav { display: grid; gap: 10px; }
  .section { display: grid; gap: 1px; }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .chev { transition: transform 0.15s; }
  .chev.open { transform: rotate(90deg); }
  .item { display: flex; justify-content: space-between; text-align: left; padding: 6px 8px; }
  .item.active { background: var(--accent-soft); color: var(--accent); }
  .profile { display: grid; gap: 6px; margin-top: auto; padding: 8px; text-align: left; background: var(--surface-2); border-color: transparent; }
  .profile:hover, .profile.active { border-color: var(--accent); }
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .stats div { display: grid; background: var(--surface); border-radius: 6px; padding: 6px 8px; }
  .milestones { display: flex; justify-content: space-between; align-items: center; padding: 2px 2px 0; }
  footer { display: grid; gap: 4px; }
  .row { display: flex; align-items: center; gap: 2px; }
  .row span { flex: 1; }
  .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .error { color: var(--warn); }
  .update { background: var(--accent-soft); color: var(--accent); border-color: transparent; text-align: left; }
</style>
