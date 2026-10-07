<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { LOCALES, t, type MessageKey } from '../lib/i18n.svelte';
  import { MAX_SUGGESTIONS, OVERLAY_CORNERS } from '../lib/overlay';
  import { hasDesktop } from '../lib/platform';
  import AccountSettings from './AccountSettings.svelte';
  import DataSettings from './DataSettings.svelte';

  let { onClose }: { onClose: () => void } = $props();

  let s = $state({ ...app.settings, overlay: { ...app.settings.overlay } });

  async function save() {
    const suggestions = Math.max(0, Math.min(MAX_SUGGESTIONS, Math.round(Number(s.overlay.suggestions) || 0)));
    await app.saveSettings({
      ...s,
      intervalMinutes: Math.max(15, Number(s.intervalMinutes) || 60),
      overlay: { ...s.overlay, hotkey: s.overlay.hotkey.trim(), switchHotkey: s.overlay.switchHotkey.trim(), suggestions },
    });
    // Stay open when the hotkey didn't work, so the message is seen.
    if (!app.overlayError) onClose();
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
    <label class="check"><input type="checkbox" bind:checked={s.warnMissable} /> {t('settings.warnMissable')}</label>
    <label class="check"><input type="checkbox" bind:checked={s.sessionRecap} /> {t('settings.sessionRecap')}</label>
    <label class="check"><input type="checkbox" bind:checked={s.milestoneSound} /> {t('settings.milestoneSound')}</label>
    <label class="check"><input type="checkbox" bind:checked={s.revealHidden} /> {t('settings.revealHidden')}</label>
    {#if hasDesktop}
      <fieldset>
        <legend>{t('settings.overlay')}</legend>
        <div class="pair">
          <label>
            {t('settings.overlayHotkey')}
            <input bind:value={s.overlay.hotkey} placeholder="Ctrl+Shift+A" spellcheck="false" />
          </label>
          <label>
            {t('settings.overlaySwitchHotkey')}
            <input bind:value={s.overlay.switchHotkey} placeholder="Ctrl+Shift+S" spellcheck="false" />
          </label>
        </div>
        <span class="small muted">{t('settings.overlayHotkeyHint')}</span>
        <span class="small muted">{t('settings.overlaySwitchHotkeyHint')}</span>
        {#if app.overlayError}<span class="small error">{t('settings.overlayError', { e: app.overlayError })}</span>{/if}
        <label>
          {t('settings.overlayCorner')}
          <select bind:value={s.overlay.corner}>
            {#each OVERLAY_CORNERS as c}<option value={c}>{t(`settings.overlayCorner.${c}` as MessageKey)}</option>{/each}
          </select>
        </label>
        <label class="check"><input type="checkbox" bind:checked={s.overlay.showProgress} /> {t('settings.overlayProgress')}</label>
        <label class="check"><input type="checkbox" bind:checked={s.overlay.showPinned} /> {t('settings.overlayPinned')}</label>
        <label>
          {t('settings.overlaySuggestions', { n: MAX_SUGGESTIONS })}
          <input type="number" min="0" max={MAX_SUGGESTIONS} bind:value={s.overlay.suggestions} />
        </label>
        <label class="check"><input type="checkbox" bind:checked={s.overlay.progressPopup} /> {t('settings.overlayProgressPopup')}</label>
        <span class="small muted">{t('settings.overlayProgressPopupHint')}</span>
      </fieldset>
    {/if}
    <AccountSettings />
    <DataSettings />
    <div class="row">
      <button class="ghost" onclick={() => app.sync(true)} title={t('settings.reloadAllHint')}>{t('settings.reloadAll')}</button>
      <span></span>
      <button onclick={onClose}>{t('settings.cancel')}</button>
      <button class="primary" onclick={save}>{t('settings.save')}</button>
    </div>
    <p class="small muted">{t('settings.restartHint')}</p>
    <button class="ghost tour" onclick={() => { app.startTour(); onClose(); }}>? {t('settings.tour')}</button>
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
  .box { width: min(460px, 100%); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; display: grid; gap: 14px; max-height: 100%; overflow-y: auto; }
  h2 { margin: 0; font-size: 18px; }
  label { display: grid; gap: 4px; }
  label.check { display: flex; gap: 8px; align-items: center; }
  fieldset { border: 1px solid var(--border); border-radius: var(--radius); margin: 0; padding: 10px 12px 12px; display: grid; gap: 10px; }
  legend { padding: 0 4px; font-weight: 600; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .row { display: flex; gap: 6px; }
  .row span { flex: 1; }
  p { margin: 0; }
  .version { align-items: center; border-top: 1px solid var(--border); padding-top: 12px; }
  .error { color: var(--warn); }
  .tour { justify-self: start; color: var(--accent); padding-left: 0; }
</style>
