<script lang="ts">
  import { app } from '../lib/app.svelte';
  import type { UnlockRow } from '../lib/db/repo';
  import { t } from '../lib/i18n.svelte';
  import { DAY_MS, dayKey, fmtDate, fmtPercent, pad } from '../lib/util';

  let { onOpen }: { onOpen: (appid: number) => void } = $props();

  const PAGE = 50;
  const WEEKS = 53;

  let rows = $state<UnlockRow[]>([]);
  let perDay = $state(new Map<string, number>());
  let more = $state(false);
  let loading = $state(false);

  /** Heatmap days: whole weeks (Monday first) ending with today. */
  const days = $derived.by(() => {
    app.unlockSeq; // a new day may have started since the last unlock
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekday = (today.getDay() + 6) % 7;
    const start = new Date(today);
    start.setDate(start.getDate() - (WEEKS - 1) * 7 - weekday);
    const out: string[] = [];
    for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) out.push(dayKey(d.getTime()));
    return out;
  });
  const max = $derived(Math.max(1, ...perDay.values()));
  const level = (n: number) => (n === 0 ? 0 : Math.ceil((n / max) * 4));

  /** Unlocks in the last `n` days, today included. */
  function lastDays(n: number): number {
    const from = dayKey(Date.now() - (n - 1) * DAY_MS);
    let sum = 0;
    for (const [day, c] of perDay) if (day >= from) sum += c;
    return sum;
  }

  async function reload() {
    const [y, m, d] = days[0].split('-').map(Number);
    const since = Math.floor(new Date(y, m - 1, d).getTime() / 1000);
    const [counts, first] = await Promise.all([app.repo.unlocksPerDay(since), app.repo.getUnlocks({ limit: PAGE })]);
    perDay = new Map(counts.map((c) => [c.day, c.n]));
    rows = first;
    more = first.length === PAGE;
  }

  async function loadMore() {
    if (loading || !rows.length) return;
    loading = true;
    try {
      const next = await app.repo.getUnlocks({ before: rows[rows.length - 1].unlocktime, limit: PAGE });
      rows = [...rows, ...next];
      more = next.length === PAGE;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // New unlocks (live or from a sync) show up without leaving the view.
    app.unlockSeq;
    app.lastSync;
    void reload();
  });

  const groups = $derived.by(() => {
    const out: { day: string; items: UnlockRow[] }[] = [];
    for (const r of rows) {
      const day = dayKey(r.unlocktime * 1000);
      if (out.at(-1)?.day !== day) out.push({ day, items: [] });
      out.at(-1)!.items.push(r);
    }
    return out;
  });

  function dayLabel(day: string): string {
    if (day === dayKey(Date.now())) return t('history.today');
    if (day === dayKey(Date.now() - DAY_MS)) return t('history.yesterday');
    return day;
  }

  const time = (unix: number) => {
    const d = new Date(unix * 1000);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
</script>

<div class="toolbar">
  <div>
    <h2>{t('history.title')}</h2>
    <span class="muted small">{t('history.intro')}</span>
  </div>
</div>

<div class="content">
  <div class="stats">
    <div><b>{lastDays(7)}</b><span class="muted small">{t('history.week')}</span></div>
    <div><b>{lastDays(30)}</b><span class="muted small">{t('history.month')}</span></div>
    <div><b>{lastDays(365)}</b><span class="muted small">{t('history.year')}</span></div>
  </div>

  <div class="heatmap">
    {#each days as day (day)}
      {@const n = perDay.get(day) ?? 0}
      <i class="l{level(n)}" title={t('history.dayCount', { date: day, n })}></i>
    {/each}
  </div>

  {#if rows.length === 0}
    <p class="muted">{t('history.empty')}</p>
  {:else}
    {#each groups as g (g.day)}
      <section>
        <h3 class="small muted">{dayLabel(g.day)}</h3>
        <ul>
          {#each g.items as a (a.appid + ':' + a.apiname)}
            <li>
              {#if a.icon}<img src={a.icon} alt="" loading="lazy" />{:else}<span class="img"></span>{/if}
              <div class="main">
                <b class="ellipsis">{a.name}</b>
                <button class="link small ellipsis" onclick={() => onOpen(a.appid)}>{a.gameName}</button>
              </div>
              {#if a.percent != null}<span class="small" class:gold={a.percent < 5}>{fmtPercent(a.percent)}</span>{/if}
              <span class="small muted time" title={fmtDate(a.unlocktime)}>{time(a.unlocktime)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
    {#if more}
      <button class="more" onclick={loadMore} disabled={loading}>{t('history.more')}</button>
    {/if}
  {/if}
</div>

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
  h2 { margin: 0; font-size: 17px; }
  h3 { margin: 4px 0 6px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .content { padding: 12px 16px; display: grid; gap: 12px; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .stats div { display: grid; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 12px; }
  .stats b { font-size: 20px; }
  .heatmap {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(7, 1fr);
    grid-auto-columns: 1fr;
    gap: 2px;
    max-width: 760px;
  }
  .heatmap i { aspect-ratio: 1; border-radius: 2px; background: var(--surface-2); }
  .heatmap .l1 { background: color-mix(in srgb, var(--accent) 30%, var(--surface-2)); }
  .heatmap .l2 { background: color-mix(in srgb, var(--accent) 55%, var(--surface-2)); }
  .heatmap .l3 { background: color-mix(in srgb, var(--accent) 80%, var(--surface-2)); }
  .heatmap .l4 { background: var(--accent); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px 6px 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  img, .img { width: 36px; height: 36px; border-radius: 4px; flex: none; background: var(--surface-2); }
  .main { flex: 1; min-width: 0; display: grid; justify-items: start; }
  .ellipsis { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .link { padding: 0; border: none; background: none; color: var(--muted); text-align: left; }
  .link:hover { color: var(--accent); text-decoration: underline; }
  .time { font-variant-numeric: tabular-nums; }
  .gold { color: var(--gold); }
  .more { justify-self: center; }
</style>
