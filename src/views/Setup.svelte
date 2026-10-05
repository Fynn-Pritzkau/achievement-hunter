<script lang="ts">
  import { app } from '../lib/app.svelte';

  let apiKey = $state('');
  let steamId = $state('');
  let language = $state('german');
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      await app.setup(apiKey.trim(), steamId.trim(), language);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="wrap">
  <form onsubmit={submit}>
    <h1>🏆 Achievement Hunter</h1>
    <p class="muted">Verbinde deinen Steam-Account. Der Key wird im Windows-Anmeldeinformationsspeicher abgelegt, nicht im Klartext.</p>

    <label>
      Steam Web API Key
      <input type="password" bind:value={apiKey} required autocomplete="off" placeholder="32 Zeichen" />
      <span class="small muted">Bekommst du unter steamcommunity.com/dev/apikey</span>
    </label>

    <label>
      Steam-Profil
      <input bind:value={steamId} required placeholder="SteamID64, Profil-URL oder eigener Name" />
      <span class="small muted">Die Spieldetails im Profil müssen öffentlich sein.</span>
    </label>

    <label>
      Sprache der Achievements
      <select bind:value={language}>
        <option value="german">Deutsch</option>
        <option value="english">English</option>
      </select>
    </label>

    {#if error}<p class="error">{error}</p>{/if}

    <button class="primary" disabled={busy}>{busy ? 'Prüfe …' : 'Verbinden'}</button>
  </form>
</div>

<style>
  .wrap { height: 100%; display: grid; place-items: center; padding: 16px; }
  form {
    width: min(420px, 100%);
    display: grid;
    gap: 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px;
  }
  h1 { margin: 0; font-size: 20px; }
  p { margin: 0; }
  label { display: grid; gap: 4px; font-weight: 500; }
  label span { font-weight: 400; }
  .error { color: var(--warn); }
</style>
