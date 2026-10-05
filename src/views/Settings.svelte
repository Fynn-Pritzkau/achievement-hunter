<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { LOCALES, t } from '../lib/i18n.svelte';

  let { onClose }: { onClose: () => void } = $props();

  let s = $state({ ...app.settings });

  async function save() {
    await app.saveSettings({ ...s, intervalMinutes: Math.max(15, Number(s.intervalMinutes) || 60) });
    onClose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="box" onclick={(e) => e.stopPropagation()}>
    <h2>{t('settings.title')}</h2>
    <label>
      {t('settings.uiLanguage')}
      <select bind:value={s.uiLanguage}>
        {#each LOCALES as l}<option value={l.id}>{l.label}</option>{/each}
      </select>
    </label>
    <label>
      {t('settings.interval')}
      <input type="number" min="15" bind:value={s.intervalMinutes} />
      <span class="small muted">{t('settings.intervalHint')}</span>
    </label>
    <label>
      {t('settings.staleDays')}
      <input type="number" min="0" bind:value={s.staleDays} />
    </label>
    <label class="check"><input type="checkbox" bind:checked={s.notifyUnlocks} /> {t('settings.notify')}</label>
    <label class="check"><input type="checkbox" bind:checked={s.revealHidden} /> {t('settings.revealHidden')}</label>
    <div class="row">
      <button class="ghost" onclick={() => app.sync(true)} title={t('settings.reloadAllHint')}>{t('settings.reloadAll')}</button>
      <span></span>
      <button onclick={onClose}>{t('settings.cancel')}</button>
      <button class="primary" onclick={save}>{t('settings.save')}</button>
    </div>
    <p class="small muted">{t('settings.restartHint')}</p>
    <div class="row version">
      <span class="small muted">
        {t('settings.version', { v: app.version })}
        {#if app.updateState === 'checking'} · {t('settings.updChecking')}
        {:else if app.update} · {t('settings.updAvailable', { v: app.update.version })}
        {:else if app.updateState === 'current'} · {t('settings.updCurrent')}
        {:else if app.updateState === 'error'} · <span class="error" title={app.updateError}>{t('settings.updFailed')}</span>
        {/if}
      </span>
      {#if app.update}
        <button class="primary" onclick={() => app.installUpdate()} disabled={app.updateState === 'installing'}>{t('settings.installNow')}</button>
      {:else}
        <button class="ghost" onclick={() => app.checkUpdate(true)} disabled={app.updateState === 'checking'}>{t('settings.checkUpdates')}</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 0.35); display: grid; place-items: center; z-index: 10; padding: 16px; }
  .box { width: min(460px, 100%); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; display: grid; gap: 14px; }
  h2 { margin: 0; font-size: 18px; }
  label { display: grid; gap: 4px; }
  label.check { display: flex; gap: 8px; align-items: center; }
  .row { display: flex; gap: 6px; }
  .row span { flex: 1; }
  p { margin: 0; }
  .version { align-items: center; border-top: 1px solid var(--border); padding-top: 12px; }
  .error { color: var(--warn); }
</style>
