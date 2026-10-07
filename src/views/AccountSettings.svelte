<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { errorText, t } from '../lib/i18n.svelte';
  import { revealFile } from '../lib/platform';

  // A rejected key opens the form right away.
  let open = $state(app.authError);
  let apiKey = $state('');
  let profile = $state(app.settings.steamId);
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** Set when the profile is another account: the user has to confirm the switch. */
  let confirming = $state(false);
  let done = $state<{ text: string; path: string | null } | null>(null);

  async function apply(confirmed = false) {
    busy = true;
    error = null;
    done = null;
    try {
      const res = await app.changeAccount(apiKey, profile.trim(), confirmed);
      if ('confirm' in res) {
        confirming = true;
        return;
      }
      confirming = false;
      open = false;
      apiKey = '';
      done = res.backup
        ? { text: t('settings.accountSwitched', { path: res.backup }), path: res.backup }
        : { text: t('settings.accountSaved'), path: null };
    } catch (e) {
      error = errorText(e);
    } finally {
      busy = false;
    }
  }
</script>

<fieldset>
  <legend>{t('settings.account')}</legend>
  <span class="small muted ellipsis">{t('settings.accountProfile', { profile: app.settings.steamId })}</span>
  {#if open}
    {#if app.authError}<span class="small error">{t('settings.authHint')}</span>{/if}
    <label>
      {t('setup.apiKey')}
      <input type="password" bind:value={apiKey} autocomplete="off" placeholder={t('setup.apiKeyPlaceholder')} />
      <span class="small muted">{t('settings.accountKeyHint')} {t('setup.apiKeyHint')}</span>
    </label>
    <label>
      {t('setup.profile')}
      <input bind:value={profile} oninput={() => (confirming = false)} required placeholder={t('setup.profilePlaceholder')} spellcheck="false" />
    </label>
    {#if error}<span class="small error">{error}</span>{/if}
    {#if confirming}
      <p class="small warn">{t('settings.accountSwitchWarn')}</p>
      <div class="row">
        <span></span>
        <button onclick={() => (confirming = false)} disabled={busy}>{t('settings.cancel')}</button>
        <button class="primary" onclick={() => apply(true)} disabled={busy}>{busy ? t('setup.checking') : t('settings.accountSwitchConfirm')}</button>
      </div>
    {:else}
      <div class="row">
        <span></span>
        <button onclick={() => (open = false)} disabled={busy}>{t('settings.cancel')}</button>
        <button class="primary" onclick={() => apply()} disabled={busy || !profile.trim()}>{busy ? t('setup.checking') : t('settings.accountApply')}</button>
      </div>
    {/if}
  {:else}
    <button class="ghost link" onclick={() => (open = true)}>{t('settings.accountChange')}</button>
  {/if}
  {#if done}
    <span class="small">
      {done.text}
      {#if done.path}<button class="ghost link small" onclick={() => revealFile(done!.path!)}>{t('settings.showFile')}</button>{/if}
    </span>
  {/if}
</fieldset>

<style>
  fieldset { border: 1px solid var(--border); border-radius: var(--radius); margin: 0; padding: 10px 12px 12px; display: grid; gap: 10px; min-width: 0; }
  legend { padding: 0 4px; font-weight: 600; }
  label { display: grid; gap: 4px; }
  .row { display: flex; gap: 6px; }
  .row span { flex: 1; }
  p { margin: 0; }
  .error, .warn { color: var(--warn); }
  .link { justify-self: start; color: var(--accent); padding-left: 0; }
  .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
