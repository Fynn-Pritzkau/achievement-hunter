<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { LOCALES, errorText, steamLanguage, t, type Locale } from '../lib/i18n.svelte';

  let apiKey = $state('');
  let steamId = $state('');
  let language = $state(steamLanguage(app.settings.uiLanguage));
  let busy = $state(false);
  let error = $state<string | null>(null);

  // Picking the app language also suggests the same language for achievements.
  function setUiLanguage(l: Locale) {
    void app.saveSettings({ ...app.settings, uiLanguage: l });
    language = steamLanguage(l);
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      await app.setup(apiKey.trim(), steamId.trim(), language);
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="wrap">
  <form onsubmit={submit}>
    <div class="top">
      <h1>🏆 Achievement Hunter</h1>
      <select
        aria-label={t('settings.uiLanguage')}
        value={app.settings.uiLanguage}
        onchange={(e) => setUiLanguage(e.currentTarget.value as Locale)}
      >
        {#each LOCALES as l}<option value={l.id}>{l.label}</option>{/each}
      </select>
    </div>
    <p class="muted">{t('setup.intro')}</p>

    <label>
      {t('setup.apiKey')}
      <input type="password" bind:value={apiKey} required autocomplete="off" placeholder={t('setup.apiKeyPlaceholder')} />
      <span class="small muted">{t('setup.apiKeyHint')}</span>
    </label>

    <label>
      {t('setup.profile')}
      <input bind:value={steamId} required placeholder={t('setup.profilePlaceholder')} />
      <span class="small muted">{t('setup.profileHint')}</span>
    </label>

    <label>
      {t('setup.achLanguage')}
      <select bind:value={language}>
        <option value="german">Deutsch</option>
        <option value="english">English</option>
      </select>
    </label>

    {#if error}<p class="error">{error}</p>{/if}

    <button class="primary" disabled={busy}>{busy ? t('setup.checking') : t('setup.connect')}</button>
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
  .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  h1 { margin: 0; font-size: 20px; }
  p { margin: 0; }
  label { display: grid; gap: 4px; font-weight: 500; }
  label span { font-weight: 400; }
  .error { color: var(--warn); }
</style>
