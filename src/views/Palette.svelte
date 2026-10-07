<script lang="ts">
  import { app } from '../lib/app.svelte';
  import type { UnlockRow } from '../lib/db/repo';
  import { t } from '../lib/i18n.svelte';
  import { completion, type Game } from '../lib/types';
  import { fmtPercent } from '../lib/util';

  let { onClose, onOpen }: { onClose: () => void; onOpen: (appid: number, apiname?: string) => void } = $props();

  /** Achievement search starts at this many characters; shorter queries match almost everything. */
  const MIN_ACH_QUERY = 3;
  const MAX_ACH = 8;

  let query = $state('');
  let index = $state(0);
  let achievements = $state<UnlockRow[]>([]);

  /** Simple fuzzy match: all characters in order; earlier and denser matches score higher. */
  function score(name: string, q: string): number {
    const n = name.toLowerCase();
    if (!q) return 1;
    const direct = n.indexOf(q);
    if (direct >= 0) return 1000 - direct;
    let pos = -1;
    let gaps = 0;
    for (const ch of q) {
      const next = n.indexOf(ch, pos + 1);
      if (next < 0) return 0;
      gaps += next - pos - 1;
      pos = next;
    }
    return 500 - gaps;
  }

  const games = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return app.games
      .map((g) => ({ g, s: score(g.name, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || b.g.lastPlayed - a.g.lastPlayed)
      .slice(0, achievements.length ? 6 : 12)
      .map((r) => r.g);
  });

  // Achievements come from SQLite, not memory: query a moment after typing stops.
  $effect(() => {
    const q = query.trim();
    if (q.length < MIN_ACH_QUERY) {
      achievements = [];
      return;
    }
    const timer = setTimeout(async () => {
      const found = await app.repo.searchAchievements(q, MAX_ACH, app.settings.revealHidden);
      if (query.trim() === q) achievements = found;
    }, 150);
    return () => clearTimeout(timer);
  });

  type Item = { kind: 'game'; g: Game } | { kind: 'ach'; a: UnlockRow };
  const items = $derived<Item[]>([
    ...games.map((g) => ({ kind: 'game' as const, g })),
    ...achievements.map((a) => ({ kind: 'ach' as const, a })),
  ]);

  $effect(() => {
    query;
    index = 0;
  });

  function open(it: Item) {
    if (it.kind === 'game') onOpen(it.g.appid);
    else onOpen(it.a.appid, it.a.apiname);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(index + 1, items.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(index - 1, 0); }
    else if (e.key === 'Enter' && items[index]) open(items[index]);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="box" onclick={(e) => e.stopPropagation()}>
    <!-- svelte-ignore a11y_autofocus -->
    <input autofocus placeholder={t('palette.placeholder')} bind:value={query} onkeydown={onKey} />
    <ul>
      {#each items as it, i (it.kind === 'game' ? `g${it.g.appid}` : `a${it.a.appid}:${it.a.apiname}`)}
        {#if achievements.length && (i === 0 || i === games.length)}
          <li class="head small muted">{it.kind === 'game' ? t('palette.games') : t('palette.achievements')}</li>
        {/if}
        <li>
          <button class="ghost" class:active={i === index} onmouseenter={() => (index = i)} onclick={() => open(it)}>
            {#if it.kind === 'game'}
              {@const pct = completion(it.g)}
              <span>{it.g.name}</span>
              <span class="muted small">{pct != null ? `${Math.floor(pct)} %` : ''}</span>
            {:else}
              <span class="ach">
                <span class:done={it.a.achieved}>{it.a.achieved ? '✓ ' : ''}{it.a.name}</span>
                <span class="muted small">{it.a.gameName}</span>
              </span>
              <span class="muted small">{fmtPercent(it.a.percent)}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 0.35); display: grid; justify-items: center; align-items: start; padding-top: 12vh; z-index: 10; }
  .box { width: min(520px, calc(100% - 32px)); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 12px 40px rgb(0 0 0 / 0.3); overflow: hidden; }
  input { width: 100%; border: none; border-bottom: 1px solid var(--border); border-radius: 0; padding: 12px 14px; font-size: 15px; outline: none; }
  ul { list-style: none; margin: 0; padding: 6px; max-height: 50vh; overflow: auto; }
  .head { padding: 6px 10px 2px; text-transform: uppercase; letter-spacing: 0.05em; }
  button { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; text-align: left; padding: 7px 10px; }
  button.active { background: var(--accent-soft); }
  .ach { display: grid; min-width: 0; }
  .ach > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .done { color: var(--muted); }
</style>
