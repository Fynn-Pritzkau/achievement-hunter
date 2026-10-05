<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { t, type MessageKey } from '../lib/i18n.svelte';
  import { SMART_LISTS, SORTS, matchesQuery, sortGames, type SortKey } from '../lib/lists';
  import { completion, isPerfect } from '../lib/types';
  import { capsuleUrls, fmtDate, fmtHours, fmtPercent } from '../lib/util';

  let { listId, onOpen }: { listId: string; onOpen: (appid: number) => void } = $props();

  let query = $state('');

  /** Falls back to the next candidate URL; hides the image when none loads. */
  function nextImage(e: Event, urls: string[]) {
    const img = e.currentTarget as HTMLImageElement;
    const i = Number(img.dataset.try ?? 0) + 1;
    img.dataset.try = String(i);
    if (i < urls.length) img.src = urls[i];
    else img.style.visibility = 'hidden';
  }
  let sortOverride = $state<SortKey | null>(null);

  const list = $derived(SMART_LISTS.find((l) => l.id === listId) ?? SMART_LISTS[1]);
  const sort = $derived(sortOverride ?? list.sort);
  const ctx = $derived({ runningAppIds: app.runningAppIds, now: Math.floor(Date.now() / 1000) });
  const games = $derived(
    sortGames(
      app.games.filter((g) => list.filter(g, ctx) && matchesQuery(g, query)),
      sort,
    ),
  );

  // A new list starts with its own default order.
  $effect(() => {
    listId;
    sortOverride = null;
  });
</script>

<div class="toolbar" data-tour="toolbar">
  <div>
    <h2>{t(`list.${list.id}` as MessageKey)}</h2>
    <span class="muted small">{t('library.count', { n: games.length })} · {t(`list.${list.id}.hint` as MessageKey)}</span>
  </div>
  <input placeholder={t('library.filter')} bind:value={query} />
  <select value={sort} onchange={(e) => (sortOverride = e.currentTarget.value as SortKey)}>
    {#each SORTS as s}<option value={s}>{t(`sort.${s}`)}</option>{/each}
  </select>
</div>

{#if games.length === 0}
  <p class="muted empty">
    {app.games.length === 0 ? t('library.loading') : t('library.empty')}
  </p>
{:else}
  <ul>
    {#each games as g, i (g.appid)}
      {@const pct = completion(g)}
      <li data-tour={i === 0 ? 'row' : undefined}>
        <button class="row" onclick={() => onOpen(g.appid)}>
          <img src={capsuleUrls(g.appid, g.iconHash)[0]} alt="" loading="lazy" onerror={(e) => nextImage(e, capsuleUrls(g.appid, g.iconHash))} />
          <div class="main">
            <div class="title">
              {#if g.pinned}<span title={t('library.pinned')}>📌</span>{/if}
              <span class="name">{g.name}</span>
              {#if app.runningAppIds.includes(g.appid)}<span class="chip accent">{t('library.running')}</span>{/if}
              {#if g.wasPerfect && !isPerfect(g)}<span class="chip warn" title={t('library.lostHint')}>{t('list.lost')}</span>{/if}
            </div>
            {#if g.total}
              <div class="bar" class:perfect={isPerfect(g)}><i style="width:{pct}%"></i></div>
            {/if}
            <div class="meta small muted">
              {#if g.total}<span>{g.unlocked}/{g.total}</span>{:else if g.total === 0}<span>{t('library.noAchievements')}</span>{:else}<span>…</span>{/if}
              {#if g.easyOpen}<span class="chip accent" title={t('library.easyHint')}>{t('library.easy', { n: g.easyOpen })}</span>{/if}
              {#if g.rarestOpen != null && !isPerfect(g)}<span title={t('library.rarestHint')}>{t('library.rarest', { p: fmtPercent(g.rarestOpen) })}</span>{/if}
              <span>{fmtHours(g.playtime)}</span>
              {#if g.lastPlayed}<span>{fmtDate(g.lastPlayed)}</span>{/if}
            </div>
          </div>
          {#if pct != null}<div class="pct" class:gold={isPerfect(g)}>{Math.floor(pct)} %</div>{/if}
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px 16px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .toolbar > div { flex: 1; min-width: 0; }
  .toolbar input { width: 260px; }
  h2 { margin: 0; font-size: 17px; }
  .empty { padding: 24px 16px; }
  ul { list-style: none; margin: 0; padding: 8px; display: grid; gap: 4px; }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--surface);
    border-color: var(--border);
    text-align: left;
    padding: 6px 12px 6px 6px;
  }
  img { width: 120px; height: 45px; object-fit: cover; border-radius: 4px; background: var(--surface-2); flex: none; }
  .main { flex: 1; min-width: 0; display: grid; gap: 4px; }
  .title { display: flex; gap: 6px; align-items: center; }
  .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .pct { font-variant-numeric: tabular-nums; font-weight: 600; width: 48px; text-align: right; }
  .pct.gold { color: var(--gold); }
</style>
