<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { STATUSES, completion, isPerfect, type Achievement, type Game, type Status } from '../lib/types';
  import { coverUrl, fmtDate, fmtDateTime, fmtHours, fmtPercent } from '../lib/util';
  import { isMessageKey, t } from '../lib/i18n.svelte';
  import { autoTags } from '../lib/tags';

  let { game, onBack }: { game: Game; onBack: () => void } = $props();

  // Auto tags have translations; manual tags are shown as typed.
  const tagLabel = (tag: string) => {
    const key = `tag.${tag}`;
    return isMessageKey(key) ? t(key) : tag;
  };
  const tagHint = (tag: string) => {
    const key = `tag.${tag}.hint`;
    return isMessageKey(key) ? t(key) : null;
  };

  type View = 'open' | 'pinned' | 'done' | 'all';
  type Order = 'easy' | 'rare' | 'name' | 'recent';

  let list = $state<Achievement[]>([]);
  let view = $state<View>('open');
  let order = $state<Order>('easy');
  let tag = $state<string | null>(null);
  let expanded = $state<string | null>(null);
  let revealed = $state(new Set<string>());
  let refreshing = $state(false);

  async function load(appid: number) {
    // Stored tags only change on a schema refresh; add the ones from newer rules right away.
    list = (await app.repo.getAchievements(appid)).map((a) => ({ ...a, tags: [...new Set([...a.tags, ...autoTags(a)])] }));
  }
  $effect(() => {
    // Reload when the game changes or the sync updated it.
    game.appid;
    game.unlocked;
    game.total;
    void load(game.appid);
  });

  const pinnedCount = $derived(list.filter((a) => a.pinned && !a.achieved).length);
  const tags = $derived([...new Set(list.flatMap((a) => a.tags))].sort());
  const shown = $derived.by(() => {
    let l = list.filter((a) =>
      view === 'open' ? !a.achieved : view === 'done' ? a.achieved : view === 'pinned' ? a.pinned && !a.achieved : true,
    );
    if (tag) l = l.filter((a) => a.tags.includes(tag!));
    const p = (a: Achievement) => a.percent ?? -1;
    const cmp: Record<Order, (a: Achievement, b: Achievement) => number> = {
      easy: (a, b) => p(b) - p(a),
      rare: (a, b) => (a.percent ?? 101) - (b.percent ?? 101),
      name: (a, b) => a.name.localeCompare(b.name),
      recent: (a, b) => b.unlocktime - a.unlocktime,
    };
    // Pinned first, excluded last.
    return l.sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(a.excluded) - Number(b.excluded) || cmp[order](a, b));
  });

  /** Position among the achievements with a known rate, rarest first. */
  const rarityRank = $derived.by(() => {
    const known = list.filter((a) => a.percent != null).sort((a, b) => a.percent! - b.percent!);
    return { total: known.length, of: new Map(known.map((a, i) => [a.apiname, i + 1])) };
  });
  const rarityLabel = (p: number) =>
    p < 5 ? t('game.rarityVeryRare') : p < 15 ? t('game.rarityRare') : p <= 50 ? t('game.rarityUncommon') : t('game.rarityCommon');
  const reveal = (a: Achievement) => (revealed = new Set([...revealed, a.apiname]));

  async function save(a: Achievement, patch: Partial<Achievement>) {
    Object.assign(a, patch);
    await app.updateAchievements(game, $state.snapshot(list) as Achievement[]);
  }

  async function refresh() {
    refreshing = true;
    try {
      await app.syncGame(game.appid);
      await load(game.appid);
    } finally {
      refreshing = false;
    }
  }

  const q = (s: string) => encodeURIComponent(s);
  function guides(a: Achievement) {
    return [
      { label: 'Steam Guides', url: `https://steamcommunity.com/app/${game.appid}/guides/?searchText=${q(a.name)}` },
      { label: 'YouTube', url: `https://www.youtube.com/results?search_query=${q(`${game.name} ${a.name} achievement`)}` },
      { label: 'SteamHunters', url: `https://steamhunters.com/apps/${game.appid}/achievements` },
      { label: 'TrueSteamAchievements', url: `https://www.truesteamachievements.com/searchresults.aspx?search=${q(game.name)}` },
    ];
  }

  const pct = $derived(completion(game));
</script>

<header style="--cover:url({coverUrl(game.appid)})">
  <button class="ghost back" onclick={onBack}>{t('game.back')}</button>
  <div class="head">
    <h1>{game.name}</h1>
    <div class="meta">
      {#if game.total}
        <b class:gold={isPerfect(game)}>{game.unlocked}/{game.total} · {Math.floor(pct ?? 0)} %</b>
      {:else if game.total === 0}
        <b>{t('game.noAchievements')}</b>
      {/if}
      <span>{fmtHours(game.playtime)}</span>
      {#if game.lastPlayed}<span>{t('game.lastPlayed', { date: fmtDate(game.lastPlayed) ?? '' })}</span>{/if}
      <span>{t('game.rarityPoints', { n: Math.round(game.rarityScore) })}</span>
    </div>
    {#if game.total}<div class="bar" class:perfect={isPerfect(game)}><i style="width:{pct}%"></i></div>{/if}
  </div>
  <div class="actions">
    <select
      value={game.status ?? ''}
      onchange={(e) => app.updateGame({ ...game, status: (e.currentTarget.value || null) as Status | null, statusManual: true })}
    >
      <option value="">{t('game.statusNone')}</option>
      {#each STATUSES as s}<option value={s}>{t(`status.${s}`)}</option>{/each}
    </select>
    {#if game.statusManual}
      <button class="ghost small" title={t('game.statusAuto')} onclick={() => app.updateGame({ ...game, statusManual: false })}>auto</button>
    {/if}
    <button onclick={() => app.updateGame({ ...game, pinned: !game.pinned })}>{game.pinned ? t('game.unpin') : t('game.pin')}</button>
    <button onclick={() => app.updateGame({ ...game, hidden: !game.hidden })}>{game.hidden ? t('game.show') : t('game.hide')}</button>
    <button onclick={refresh} disabled={refreshing}>{refreshing ? '…' : '↻'}</button>
    <a class="btn" href={`steam://run/${game.appid}`}>{t('game.launch')}</a>
  </div>
</header>

{#if list.length}
  <div class="filters">
    <div class="tabs">
      <button class:active={view === 'open'} onclick={() => (view = 'open')}>{t('game.open', { n: list.filter((a) => !a.achieved).length })}</button>
      {#if pinnedCount}<button class:active={view === 'pinned'} onclick={() => (view = 'pinned')}>{t('game.focus', { n: pinnedCount })}</button>{/if}
      <button class:active={view === 'done'} onclick={() => (view = 'done')}>{t('game.done', { n: game.unlocked })}</button>
      <button class:active={view === 'all'} onclick={() => (view = 'all')}>{t('game.all')}</button>
    </div>
    <div class="tags">
      {#each tags as tg}
        <button class="chip" class:accent={tag === tg} onclick={() => (tag = tag === tg ? null : tg)}>{tagLabel(tg)}</button>
      {/each}
    </div>
    <select bind:value={order}>
      <option value="easy">{t('game.orderEasy')}</option>
      <option value="rare">{t('game.orderRare')}</option>
      <option value="recent">{t('game.orderRecent')}</option>
      <option value="name">{t('game.orderName')}</option>
    </select>
  </div>

  <ul>
    {#each shown as a (a.apiname)}
      {@const spoiler = a.hidden && !a.achieved && !app.settings.revealHidden && !revealed.has(a.apiname)}
      <li class:done={a.achieved} class:excluded={a.excluded}>
        <div class="ach">
          {#if a.icon}<img src={a.achieved ? a.icon : a.icongray || a.icon} alt="" loading="lazy" />{:else}<span class="noicon">🏆</span>{/if}
          <button class="ghost text" onclick={() => (expanded = expanded === a.apiname ? null : a.apiname)}>
            <div class="name">
              {a.name}
              {#each a.tags as tg}<span class="chip">{tagLabel(tg)}</span>{/each}
              {#if a.note}<span class="chip" title={a.note}>📝</span>{/if}
            </div>
            {#if spoiler}
              <span
                class="spoiler small"
                role="button"
                tabindex="0"
                onclick={(e) => { e.stopPropagation(); reveal(a); }}
                onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); reveal(a); } }}
              >{t('game.spoiler')}</span>
            {:else}
              <div class="small muted">{a.description || '—'}</div>
            {/if}
          </button>
          <div class="side">
            <span class="pct" class:rare={a.percent != null && a.percent < 5}>{fmtPercent(a.percent)}</span>
            {#if a.achieved}
              <span class="small muted">{fmtDate(a.unlocktime)}</span>
            {:else}
              <button class="ghost" title={a.pinned ? t('game.unfocus') : t('game.focusAdd')} onclick={() => save(a, { pinned: !a.pinned })}>
                {a.pinned ? '📌' : '📍'}
              </button>
            {/if}
          </div>
        </div>
        {#if expanded === a.apiname}
          {@const rank = rarityRank.of.get(a.apiname)}
          <div class="extra">
            {#if a.tags.includes('missable') && !a.achieved}
              <div class="warn">
                <b>{t('game.missableWarn')}</b>
                <span class="small muted">{t('game.missableGuess')}</span>
              </div>
            {/if}
            <dl>
              <dt>{t('game.description')}</dt>
              <dd>
                {#if spoiler}
                  <button class="ghost small spoiler" onclick={() => reveal(a)}>{t('game.spoiler')}</button>
                {:else}
                  {a.description || '—'}
                {/if}
              </dd>
              <dt>{t('game.rarity')}</dt>
              <dd>
                {#if a.percent != null}
                  {fmtPercent(a.percent)} · {rarityLabel(a.percent)}
                  {#if rank}<span class="muted"> · {t('game.rarityRank', { n: rank, total: rarityRank.total })}</span>{/if}
                {:else}–{/if}
              </dd>
              <dt>{t('game.unlockedAt')}</dt>
              <dd>{a.achieved ? (fmtDateTime(a.unlocktime) ?? '✓') : t('game.notUnlocked')}</dd>
              {#each a.tags as tg}
                <dt><span class="chip">{tagLabel(tg)}</span></dt>
                <dd class="small muted">{tagHint(tg) ?? ''}</dd>
              {/each}
            </dl>
            <textarea
              rows="2"
              placeholder={t('game.notePlaceholder')}
              value={a.note}
              onchange={(e) => save(a, { note: e.currentTarget.value })}
            ></textarea>
            <div class="links">
              {#each guides(a) as g}<a href={g.url} target="_blank" rel="noreferrer">{g.label} ↗</a>{/each}
              <label class="small">
                <input type="checkbox" checked={a.excluded} onchange={(e) => save(a, { excluded: e.currentTarget.checked })} />
                {t('game.exclude')}
              </label>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{:else if game.total === null}
  <p class="muted pad">{t('game.loadingNext')}</p>
{/if}

<style>
  header {
    position: relative;
    display: grid;
    gap: 10px;
    padding: 16px;
    border-bottom: 1px solid var(--border);
    background:
      linear-gradient(to right, var(--bg) 35%, color-mix(in srgb, var(--bg) 70%, transparent)),
      var(--cover) right / auto 100% no-repeat;
  }
  .back { justify-self: start; padding-left: 0; }
  h1 { margin: 0; font-size: 22px; }
  .head { display: grid; gap: 6px; max-width: 560px; }
  .meta { display: flex; gap: 14px; flex-wrap: wrap; color: var(--muted); }
  .meta b { color: var(--text); }
  .gold { color: var(--gold) !important; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .btn {
    padding: 5px 10px;
    border-radius: 6px;
    background: var(--accent);
    color: #fff;
    text-decoration: none;
  }
  .filters {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    padding: 10px 16px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .tabs { display: flex; gap: 4px; }
  .tabs .active { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
  .tags { display: flex; gap: 4px; flex: 1; flex-wrap: wrap; }
  .tags .chip { border: none; cursor: pointer; }
  ul { list-style: none; margin: 0; padding: 8px; display: grid; gap: 4px; }
  li { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
  li.done { opacity: 0.75; }
  li.excluded { opacity: 0.45; }
  .ach { display: flex; align-items: center; gap: 10px; padding: 6px 10px 6px 6px; }
  img, .noicon { width: 48px; height: 48px; border-radius: 4px; flex: none; background: var(--surface-2); }
  .noicon { display: grid; place-items: center; opacity: 0.4; }
  .text { flex: 1; min-width: 0; text-align: left; padding: 2px 4px; }
  .name { font-weight: 600; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .spoiler { color: var(--muted); font-style: italic; cursor: pointer; }
  .side { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; min-width: 70px; }
  .pct { font-variant-numeric: tabular-nums; font-weight: 600; }
  .pct.rare { color: var(--gold); }
  .extra { display: grid; gap: 8px; padding: 0 10px 10px 64px; }
  .warn {
    display: grid;
    gap: 2px;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--gold) 50%, transparent);
    background: color-mix(in srgb, var(--gold) 12%, transparent);
  }
  .warn b { color: var(--gold); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; align-items: baseline; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  dd .spoiler { padding: 0; }
  textarea { width: 100%; resize: vertical; }
  .links { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
  .links a { color: var(--accent); }
  .links label { margin-left: auto; display: flex; gap: 6px; align-items: center; }
  .pad { padding: 16px; }
</style>
