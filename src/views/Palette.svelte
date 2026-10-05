<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { t } from '../lib/i18n.svelte';
  import { completion } from '../lib/types';

  let { onClose, onOpen }: { onClose: () => void; onOpen: (appid: number) => void } = $props();

  let query = $state('');
  let index = $state(0);

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

  const results = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return app.games
      .map((g) => ({ g, s: score(g.name, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || b.g.lastPlayed - a.g.lastPlayed)
      .slice(0, 12)
      .map((r) => r.g);
  });

  $effect(() => {
    query;
    index = 0;
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(index + 1, results.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(index - 1, 0); }
    else if (e.key === 'Enter' && results[index]) onOpen(results[index].appid);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="box" onclick={(e) => e.stopPropagation()}>
    <!-- svelte-ignore a11y_autofocus -->
    <input autofocus placeholder={t('palette.placeholder')} bind:value={query} onkeydown={onKey} />
    <ul>
      {#each results as g, i (g.appid)}
        {@const pct = completion(g)}
        <li>
          <button class="ghost" class:active={i === index} onmouseenter={() => (index = i)} onclick={() => onOpen(g.appid)}>
            <span>{g.name}</span>
            <span class="muted small">{pct != null ? `${Math.floor(pct)} %` : ''}</span>
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
  button { width: 100%; display: flex; justify-content: space-between; text-align: left; padding: 7px 10px; }
  button.active { background: var(--accent-soft); }
</style>
