<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { BackupError, parseBackup } from '../lib/backup';
  import { errorText, t } from '../lib/i18n.svelte';
  import { log } from '../lib/log';
  import { hasDesktop, openExternal, revealFile } from '../lib/platform';

  const ISSUES = 'https://github.com/Fynn-Pritzkau/achievement-hunter/issues/new/choose';

  let busy = $state(false);
  let message = $state<{ text: string; error?: boolean; path?: string } | null>(null);
  let copied = $state<string | null>(null);
  let fileInput: HTMLInputElement;

  async function run(fn: () => Promise<typeof message>) {
    busy = true;
    message = null;
    try {
      message = await fn();
    } catch (e) {
      log.error('Backup', e);
      const text =
        e instanceof BackupError ? t(e.kind === 'newer' ? 'settings.importNewer' : 'settings.importInvalid') : errorText(e);
      message = { text, error: true };
    } finally {
      busy = false;
    }
  }

  const exportNow = () => run(async () => {
    const path = await app.exportBackup();
    return { text: t('settings.exported', { path }), path: hasDesktop ? path : undefined };
  });

  function importFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void run(async () => {
      const res = await app.importBackup(parseBackup(await file.text()));
      const text = t('settings.imported', { n: res.games.length });
      return { text: res.pending ? `${text} ${t('settings.importedPending', { n: res.pending })}` : text };
    });
  }

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(await app.diagnostics());
      copied = t('settings.copied');
    } catch (e) {
      log.warn('Copy diagnostics', e);
      copied = t('settings.copyFailed');
    }
  }
</script>

<fieldset>
  <legend>{t('settings.data')}</legend>
  <span class="small muted">{t('settings.dataHint')}</span>
  <div class="row">
    <button onclick={exportNow} disabled={busy}>{t('settings.export')}</button>
    <button onclick={() => fileInput.click()} disabled={busy}>{t('settings.import')}</button>
    <input bind:this={fileInput} type="file" accept=".json,application/json" onchange={importFile} hidden />
  </div>
  {#if message}
    <span class="small" class:error={message.error}>
      {message.text}
      {#if message.path}<button class="ghost link small" onclick={() => revealFile(message!.path!)}>{t('settings.showFile')}</button>{/if}
    </span>
  {/if}
</fieldset>

<fieldset>
  <legend>{t('settings.support')}</legend>
  <span class="small muted">{t('settings.supportHint')}</span>
  <div class="row">
    <button onclick={copyDiagnostics}>{t('settings.copyDiagnostics')}</button>
    <button class="ghost link" onclick={() => openExternal(ISSUES)}>{t('settings.reportBug')} ↗</button>
  </div>
  {#if copied}<span class="small">{copied}</span>{/if}
</fieldset>

<style>
  fieldset { border: 1px solid var(--border); border-radius: var(--radius); margin: 0; padding: 10px 12px 12px; display: grid; gap: 10px; min-width: 0; }
  legend { padding: 0 4px; font-weight: 600; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .error { color: var(--warn); }
  .link { color: var(--accent); }
  span { overflow-wrap: anywhere; }
</style>
