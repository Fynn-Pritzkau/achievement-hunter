<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { SMART_LISTS, SORTS, matchesQuery, sortGames, type SortKey } from '../lib/lists';
  import { completion, isPerfect } from '../lib/types';
  import { capsuleUrl, fmtDate, fmtHours, fmtPercent } from '../lib/util';

  let { listId, onOpen }: { listId: string; onOpen: (appid: number) => void } = $props();

  let query = $state('');
  let sortOverride = $state<SortKey | null>(null);

  const list = $derived(SMART_LISTS.find((l) => l.id === listId) ?? SMART_LISTS[1]);
  const sort = $derived(sortOverride ?? list.sort);
  const ctx = $derived({ runningAppId: app.runningAppId, now: Math.floor(Date.now() / 1000) });
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

<div class="toolbar">
  <div>
    <h2>{list.label}</h2>
    <span class="muted small">{games.length} Spiele · {list.hint}</span>
  </div>
  <input placeholder="Filtern … (z. B. min:50 status:paused)" bind:value={query} />
  <select value={sort} onchange={(e) => (sortOverride = e.currentTarget.value as SortKey)}>
    {#each SORTS as s}<option value={s.key}>{s.label}</option>{/each}
  </select>
</div>

{#if games.length === 0}
  <p class="muted empty">
    {app.games.length === 0 ? 'Bibliothek wird geladen …' : 'Nichts in dieser Liste.'}
  </p>
{:else}
  <ul>
    {#each games as g (g.appid)}
      {@const pct = completion(g)}
      <li>
        <button class="row" onclick={() => onOpen(g.appid)}>
          <img src={capsuleUrl(g.appid)} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
          <div class="main">
            <div class="title">
              {#if g.pinned}<span title="Angeheftet">📌</span>{/if}
              <span class="name">{g.name}</span>
              {#if g.appid === app.runningAppId}<span class="chip accent">läuft</span>{/if}
              {#if g.wasPerfect && !isPerfect(g)}<span class="chip warn" title="War 100 %, neue Achievements">Perfect verloren</span>{/if}
            </div>
            {#if g.total}
              <div class="bar" class:perfect={isPerfect(g)}><i style="width:{pct}%"></i></div>
            {/if}
            <div class="meta small muted">
              {#if g.total}<span>{g.unlocked}/{g.total}</span>{:else if g.total === 0}<span>keine Achievements</span>{:else}<span>…</span>{/if}
              {#if g.easyOpen}<span class="chip accent" title="Offene Achievements, die über 50 % der Spieler haben">{g.easyOpen} easy</span>{/if}
              {#if g.rarestOpen != null && !isPerfect(g)}<span title="Seltenstes offenes Achievement">seltenstes {fmtPercent(g.rarestOpen)}</span>{/if}
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
