<script lang="ts">
  import { app } from '../lib/app.svelte';
  import type { UnlockRow } from '../lib/db/repo';
  import { t } from '../lib/i18n.svelte';
  import type { StatProgress } from '../lib/steam/local';
  import { fmtPercent } from '../lib/util';

  let { onOpen }: { onOpen: (appid: number) => void } = $props();

  let rows = $state<UnlockRow[]>([]);
  /** Stat progress per game, straight from Steam's cache; never stored. */
  let progress = $state(new Map<number, Map<string, StatProgress>>());

  /** Changes whenever a pin is set, removed or unlocked anywhere. */
  const pinKey = $derived(app.games.map((g) => g.pinnedOpen ?? 0).join());

  async function reload() {
    rows = await app.repo.getPinnedOpen();
    const ids = [...new Set(rows.map((r) => r.appid))];
    progress = new Map(await Promise.all(ids.map(async (id) => [id, await app.localProgress(id)] as const)));
  }

  $effect(() => {
    pinKey;
    void reload();
  });

  const groups = $derived.by(() => {
    const out: { appid: number; name: string; items: UnlockRow[] }[] = [];
    for (const r of rows) {
      if (out.at(-1)?.appid !== r.appid) out.push({ appid: r.appid, name: r.gameName, items: [] });
      out.at(-1)!.items.push(r);
    }
    return out;
  });

  async function unpin(r: UnlockRow) {
    const game = app.games.find((g) => g.appid === r.appid);
    if (!game) return;
    const list = await app.repo.getAchievements(r.appid);
    for (const a of list) if (a.apiname === r.apiname) a.pinned = false;
    await app.updateAchievements(game, list);
  }

  function openAchievement(r: UnlockRow) {
    app.focusAchievement = r.apiname;
    onOpen(r.appid);
  }

  const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
</script>

<div class="toolbar" data-tour="focus">
  <div>
    <h2>{t('list.focus')}</h2>
    <span class="muted small">
      {t('focus.count', { n: rows.length, g: groups.length })} · {t('list.focus.hint')}
    </span>
  </div>
</div>

<div class="content">
  {#if rows.length === 0}
    <p class="muted">{t('focus.empty')}</p>
  {:else}
    {#each groups as g (g.appid)}
      <section>
        <h3><button class="link" onclick={() => onOpen(g.appid)}>{g.name}</button></h3>
        <ul>
          {#each g.items as a (a.apiname)}
            {@const pr = progress.get(a.appid)?.get(a.apiname)}
            {@const spoiler = a.hidden && !app.settings.revealHidden}
            <li>
              {#if a.icongray || a.icon}<img src={a.icongray || a.icon} alt="" loading="lazy" />{:else}<span class="img"></span>{/if}
              <button class="ghost main" onclick={() => openAchievement(a)}>
                <b class="ellipsis">{a.name}</b>
                <span class="small muted ellipsis">{spoiler ? t('game.spoiler') : a.description || '—'}</span>
                {#if pr}
                  <span class="prog">
                    <span class="bar"><i style="width:{(pr.current / pr.max) * 100}%"></i></span>
                    <span class="small muted">{fmtNum(pr.current)} / {fmtNum(pr.max)}</span>
                  </span>
                {/if}
              </button>
              {#if a.percent != null}<span class="small" class:gold={a.percent < 5}>{fmtPercent(a.percent)}</span>{/if}
              <button class="ghost" title={t('game.unfocus')} onclick={() => unpin(a)}>📌</button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>

<style>
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px 16px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .toolbar > div { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: 17px; }
  h3 { margin: 4px 0 6px; font-size: 14px; }
  .content { padding: 12px 16px; display: grid; gap: 12px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 6px 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  img, .img { width: 40px; height: 40px; border-radius: 4px; flex: none; background: var(--surface-2); }
  .main { flex: 1; min-width: 0; display: grid; justify-items: start; text-align: left; padding: 2px 4px; }
  .ellipsis { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prog { display: flex; align-items: center; gap: 8px; width: 100%; max-width: 320px; margin-top: 2px; }
  .prog .bar { flex: 1; }
  .link { padding: 0; border: none; background: none; color: var(--text); font-weight: 600; }
  .link:hover { color: var(--accent); text-decoration: underline; }
  .gold { color: var(--gold); }
</style>
