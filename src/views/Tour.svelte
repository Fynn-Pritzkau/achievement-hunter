<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { t, type MessageKey } from '../lib/i18n.svelte';
  import { placeCard, type Rect, type TourStep } from '../lib/tour';

  let { steps, onStep, onEnd }: { steps: TourStep[]; onStep: (s: TourStep) => void; onEnd: () => void } = $props();

  const PAD = 6;

  let index = $state(0);
  let target = $state<Element | null>(null);
  let rect = $state<Rect | null>(null);
  /** Hidden while the next step's view loads, so the card doesn't jump. */
  let ready = $state(false);
  let cardW = $state(340);
  let cardH = $state(180);
  let vw = $state(window.innerWidth);
  let vh = $state(window.innerHeight);

  const step = $derived(steps[index]);
  const last = $derived(index === steps.length - 1);
  const pos = $derived(placeCard(rect, { width: cardW, height: cardH }, { width: vw, height: vh }));

  let seq = 0;
  async function show(i: number) {
    const my = ++seq;
    const s = steps[i];
    ready = false;
    onStep(s);
    await tick();
    // Views fill in asynchronously (a game's achievements come from the database), so look for a moment.
    let el: Element | null = null;
    for (let n = 0; s.target && !el && n < 25; n++) {
      el = document.querySelector(`[data-tour="${s.target}"]`);
      if (!el) await new Promise((r) => setTimeout(r, 20));
      if (my !== seq) return;
    }
    el?.scrollIntoView({ block: 'nearest' });
    target = el;
    measure();
    ready = true;
  }

  function measure() {
    const r = target?.getBoundingClientRect();
    rect = r && r.width ? { left: r.left - PAD, top: r.top - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD } : null;
  }

  $effect(() => {
    const i = index;
    untrack(() => void show(i));
  });

  const next = () => (last ? onEnd() : index++);
  const back = () => index > 0 && index--;

  function onKey(e: KeyboardEvent) {
    // The tour owns the keyboard while it runs (no Ctrl+K, no Escape closing the game page).
    e.stopImmediatePropagation();
    if (e.key === 'Escape') onEnd();
    else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') next();
    else if (e.key === 'ArrowLeft') back();
    else return;
    e.preventDefault();
  }
</script>

<svelte:window
  bind:innerWidth={vw}
  bind:innerHeight={vh}
  onresize={measure}
  onscrollcapture={measure}
  onkeydowncapture={onKey}
/>

<!-- Clicking anywhere moves on; the app below is not clickable during the tour. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="catcher" onclick={next}>
  {#if rect && ready}
    <div class="spot" style="left:{rect.left}px;top:{rect.top}px;width:{rect.width}px;height:{rect.height}px"></div>
  {:else}
    <div class="dim"></div>
  {/if}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="card"
    class:ready
    role="dialog"
    tabindex="-1"
    aria-live="polite"
    aria-label={t(`tour.${step.id}` as MessageKey)}
    bind:offsetWidth={cardW}
    bind:offsetHeight={cardH}
    style="left:{pos.left}px;top:{pos.top}px"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="bar"><i style="width:{((index + 1) / steps.length) * 100}%"></i></div>
    <h3>{t(`tour.${step.id}` as MessageKey)}</h3>
    <p>{t(`tour.${step.id}.body` as MessageKey)}</p>
    <div class="row">
      <span class="small muted">{index + 1} / {steps.length}</span>
      {#if !last}<button class="ghost small" onclick={onEnd}>{t('tour.skip')}</button>{/if}
      {#if index > 0}<button onclick={back}>{t('tour.back')}</button>{/if}
      <!-- svelte-ignore a11y_autofocus -->
      <button class="primary" autofocus onclick={next}>{last ? t('tour.finish') : t('tour.next')}</button>
    </div>
    {#if index === 0}<div class="small muted">{t('tour.keys')}</div>{/if}
  </div>
</div>

<style>
  .catcher { position: fixed; inset: 0; z-index: 20; cursor: pointer; }
  .dim { position: absolute; inset: 0; background: rgb(0 0 0 / 0.55); }
  .spot {
    position: absolute;
    border-radius: var(--radius);
    box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.55), 0 0 0 2px var(--accent) inset;
    pointer-events: none;
    transition: left 0.18s, top 0.18s, width 0.18s, height 0.18s;
  }
  .card {
    position: absolute;
    width: min(340px, calc(100vw - 24px));
    display: grid;
    gap: 8px;
    padding: 14px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 12px 40px rgb(0 0 0 / 0.35);
    cursor: default;
    opacity: 0;
    transition: left 0.18s, top 0.18s, opacity 0.12s;
  }
  .card.ready { opacity: 1; }
  h3 { margin: 4px 0 0; font-size: 15px; }
  p { margin: 0; }
  .row { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
  .row span { flex: 1; font-variant-numeric: tabular-nums; }
</style>
