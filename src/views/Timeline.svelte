<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { t } from '../lib/i18n.svelte';
  import { playtimePoints, timelinePoints } from '../lib/timeline';
  import type { Achievement, Game, Snapshot } from '../lib/types';
  import { fmtDate, fmtPercent } from '../lib/util';

  let { game, list }: { game: Game; list: Achievement[] } = $props();

  // The chart is drawn in pixels of its actual width, so dots stay round.
  let W = $state(600);
  const H = 110;
  const PAD = 4;
  const RARE = 10;

  // Collapsed state is a per-machine view preference, so localStorage is enough.
  const KEY = 'game.timeline.collapsed';
  let collapsed = $state(load());
  function load() {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  }
  function toggle() {
    collapsed = !collapsed;
    try {
      localStorage.setItem(KEY, collapsed ? '1' : '0');
    } catch {}
  }

  let snapshots = $state<Snapshot[]>([]);
  $effect(() => {
    const appid = game.appid;
    if (collapsed) return;
    void app.repo.getSnapshots('0000-00-00', appid).then((s) => {
      if (game.appid === appid) snapshots = s;
    });
  });

  const points = $derived(timelinePoints(list, game.total ?? 0));
  const play = $derived(playtimePoints(snapshots));
  const now = Math.floor(Date.now() / 1000);
  const start = $derived(Math.min(points[0]?.t ?? now, play[0]?.t ?? now));
  const x = (ts: number) => PAD + ((ts - start) / Math.max(now - start, 1)) * (W - 2 * PAD);
  const y = (pct: number) => H - PAD - (pct / 100) * (H - 2 * PAD);

  /** Steps: flat until the next unlock, then up. */
  const path = $derived.by(() => {
    if (!points.length) return '';
    const base = points[0].pct - 100 / (game.total ?? 1);
    let d = `M${x(start)},${y(base)}`;
    for (const p of points) d += ` H${x(p.t)} V${y(p.pct)}`;
    return d + ` H${x(now)}`;
  });
  const playPath = $derived.by(() => {
    const max = Math.max(...play.map((p) => p.min), 1);
    return play.map((p, i) => `${i ? 'L' : 'M'}${x(p.t)},${H - PAD - (p.min / max) * (H - 2 * PAD)}`).join(' ');
  });
  const rare = $derived(points.filter((p) => p.a.percent != null && p.a.percent < RARE));
</script>

<section data-tour="timeline">
  <button class="ghost head" onclick={toggle} aria-expanded={!collapsed}>
    <span>{t('game.timeline')}</span>
    <span class="small muted">{t('game.timelineHint')}</span>
    <span class="chev" class:open={!collapsed}>›</span>
  </button>
  {#if !collapsed}
    <div bind:clientWidth={W}>
      <svg viewBox="0 0 {W} {H}" role="img" aria-label={t('game.timeline')}>
        <line class="grid" x1={PAD} x2={W - PAD} y1={y(50)} y2={y(50)} />
        <line class="grid" x1={PAD} x2={W - PAD} y1={y(100)} y2={y(100)} />
        {#if play.length > 1}<path class="play" d={playPath} />{/if}
        <path class="curve" d={path} />
        {#each rare as p (p.a.apiname)}
          <circle cx={x(p.t)} cy={y(p.pct)} r="3.5">
            <title>{fmtDate(p.t)}: {p.a.name} ({fmtPercent(p.a.percent)})</title>
          </circle>
        {/each}
      </svg>
    </div>
    <div class="axis small muted">
      <span>{fmtDate(start)}</span>
      <span>{fmtDate(now)}</span>
    </div>
  {/if}
</section>

<style>
  section { padding: 8px 16px 10px; border-bottom: 1px solid var(--border); display: grid; gap: 4px; }
  .head { display: flex; gap: 10px; align-items: baseline; padding: 2px 0; text-align: left; font-weight: 600; }
  .head .muted { font-weight: 400; flex: 1; }
  .chev { transition: transform 0.15s; }
  .chev.open { transform: rotate(90deg); }
  svg { width: 100%; height: 110px; display: block; }
  .grid { stroke: var(--border); stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
  .curve { fill: none; stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; }
  .play { fill: none; stroke: var(--muted); stroke-width: 1; opacity: 0.5; vector-effect: non-scaling-stroke; }
  circle { fill: var(--gold); }
  .axis { display: flex; justify-content: space-between; }
</style>
