<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/app.svelte';
  import Setup from './views/Setup.svelte';
  import Sidebar from './views/Sidebar.svelte';
  import Library from './views/Library.svelte';
  import GameDetail from './views/GameDetail.svelte';
  import Palette from './views/Palette.svelte';
  import SettingsView from './views/Settings.svelte';

  let listId = $state('all');
  let openAppId = $state<number | null>(null);
  let paletteOpen = $state(false);
  let settingsOpen = $state(false);

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

  const openGame = $derived(openAppId ? app.games.find((g) => g.appid === openAppId) ?? null : null);
</script>

<svelte:window onkeydown={onKey} />

{#if !app.ready}
  <div class="center muted">Lade …</div>
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
{/if}

<style>
  .center { height: 100%; display: grid; place-items: center; }
  .layout { display: grid; grid-template-columns: 240px 1fr; height: 100%; }
  main { overflow: auto; min-width: 0; }
</style>
