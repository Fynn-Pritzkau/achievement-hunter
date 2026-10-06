<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { app } from './lib/app.svelte';
  import { t } from './lib/i18n.svelte';
  import { isTauri, openExternal } from './lib/platform';
  import { tourGame, tourSteps, type TourStep } from './lib/tour';
  import Setup from './views/Setup.svelte';
  import Sidebar from './views/Sidebar.svelte';
  import Library from './views/Library.svelte';
  import GameDetail from './views/GameDetail.svelte';
  import Palette from './views/Palette.svelte';
  import SettingsView from './views/Settings.svelte';
  import AppAchievements from './views/AppAchievements.svelte';
  import History from './views/History.svelte';
  import Tour from './views/Tour.svelte';

  let listId = $state('all');
  let openAppId = $state<number | null>(null);
  let paletteOpen = $state(false);
  let settingsOpen = $state(false);

  /** The running tour: its steps, the game it shows, and the view to return to afterwards. */
  let tour = $state<{ steps: TourStep[]; game: number | null; back: { listId: string; openAppId: number | null } } | null>(null);

  $effect(() => {
    if (!app.touring) return;
    untrack(() => {
      if (tour) return;
      const game = tourGame(app.games, app.runningAppIds);
      tour = { steps: tourSteps(!!game, isTauri), game: game?.appid ?? null, back: { listId, openAppId } };
      paletteOpen = settingsOpen = false;
    });
  });

  function tourStep(s: TourStep) {
    void app.tourOverlay(s.overlay ? (tour?.game ?? null) : null);
    if (!s.view) return;
    if ('game' in s.view) openAppId = tour?.game ?? null;
    else {
      listId = s.view.list;
      openAppId = null;
    }
  }

  function endTour() {
    void app.tourOverlay(null);
    if (tour) ({ listId, openAppId } = tour.back);
    tour = null;
    app.touring = false;
  }

  onMount(() => {
    app.init().catch((e) => (app.error = e.message));
  });

  function onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      paletteOpen = !paletteOpen;
    } else if (e.key === 'Escape' && !paletteOpen && !settingsOpen && openAppId) {
      openAppId = null;
    }
  }

  /** External links (guides, steam://run) go to the system browser or Steam instead of the WebView. */
  function onClick(e: MouseEvent) {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || !/^(https?|steam):/i.test(a.href)) return;
    e.preventDefault();
    openExternal(a.href).catch((err) => (app.error = String(err)));
  }

  const openGame = $derived(openAppId ? app.games.find((g) => g.appid === openAppId) ?? null : null);
</script>

<svelte:window onkeydown={onKey} onclick={onClick} />

{#if !app.ready}
  <div class="center muted">{t('app.loading')}</div>
{:else if !app.configured}
  <Setup />
{:else}
  <div class="layout">
    <Sidebar
      bind:listId
      onSelect={() => (openAppId = null)}
      onSettings={() => (settingsOpen = true)}
      onSearch={() => (paletteOpen = true)}
    />
    <main>
      {#if openGame}
        <GameDetail game={openGame} onBack={() => (openAppId = null)} />
      {:else if listId === 'appAchievements'}
        <AppAchievements />
      {:else if listId === 'history'}
        <History onOpen={(id) => (openAppId = id)} />
      {:else}
        <Library {listId} onOpen={(id) => (openAppId = id)} />
      {/if}
    </main>
  </div>
  {#if paletteOpen}
    <Palette
      onClose={() => (paletteOpen = false)}
      onOpen={(id) => {
        openAppId = id;
        paletteOpen = false;
      }}
    />
  {/if}
  {#if settingsOpen}
    <SettingsView onClose={() => (settingsOpen = false)} />
  {/if}
  {#if tour}
    <Tour steps={tour.steps} onStep={tourStep} onEnd={endTour} />
  {:else if app.tourOffer}
    <div class="offer" role="dialog">
      <p>👋 {t('tour.offer')}</p>
      <div class="row">
        <span class="small muted">{t('tour.offerLater')}</span>
        <button class="ghost" onclick={() => app.dismissTourOffer()}>{t('tour.offerNo')}</button>
        <button class="primary" onclick={() => app.startTour()}>{t('tour.offerStart')}</button>
      </div>
    </div>
  {/if}
{/if}

<style>
  .center { height: 100%; display: grid; place-items: center; }
  .layout { display: grid; grid-template-columns: 240px 1fr; height: 100%; }
  main { overflow: auto; min-width: 0; }
  .offer {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 5;
    width: min(380px, calc(100% - 32px));
    display: grid;
    gap: 10px;
    padding: 14px 16px;
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    box-shadow: 0 12px 40px rgb(0 0 0 / 0.25);
  }
  .offer p { margin: 0; }
  .offer .row { display: flex; gap: 6px; align-items: center; }
  .offer .row span { flex: 1; }
</style>
