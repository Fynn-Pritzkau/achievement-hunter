<script lang="ts">
  import { app } from '../lib/app.svelte';

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
    <h2>Einstellungen</h2>
    <label>
      Bibliothek synchronisieren alle (Minuten)
      <input type="number" min="15" bind:value={s.intervalMinutes} />
      <span class="small muted">Kostet pro Sync meist nur 1 API-Call. Neue Achievements liest die App zusätzlich alle 15 s aus Steams lokalem Cache, ohne API-Call.</span>
    </label>
    <label>
      „Spiele ich“ wird „Pausiert“ nach (Tagen ohne Spielen, 0 = nie)
      <input type="number" min="0" bind:value={s.staleDays} />
    </label>
    <label class="check"><input type="checkbox" bind:checked={s.notifyUnlocks} /> Benachrichtigung bei neuen Achievements</label>
    <label class="check"><input type="checkbox" bind:checked={s.revealHidden} /> Versteckte Achievements immer aufdecken</label>
    <div class="row">
      <button class="ghost" onclick={() => app.sync(true)} title="Lädt alle Achievements neu — viele API-Calls">Alles neu laden</button>
      <span></span>
      <button onclick={onClose}>Abbrechen</button>
      <button class="primary" onclick={save}>Speichern</button>
    </div>
    <p class="small muted">Intervall und Pausier-Regel greifen nach einem Neustart der App.</p>
    <div class="row version">
      <span class="small muted">
        Version {app.version}
        {#if app.updateState === 'checking'} · suche …
        {:else if app.update} · {app.update.version} verfügbar
        {:else if app.updateState === 'current'} · aktuell
        {:else if app.updateState === 'error'} · <span class="error" title={app.updateError}>Update-Prüfung fehlgeschlagen</span>
        {/if}
      </span>
      {#if app.update}
        <button class="primary" onclick={() => app.installUpdate()} disabled={app.updateState === 'installing'}>Jetzt installieren</button>
      {:else}
        <button class="ghost" onclick={() => app.checkUpdate(true)} disabled={app.updateState === 'checking'}>Nach Updates suchen</button>
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
