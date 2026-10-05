<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { t, type MessageKey } from '../lib/i18n.svelte';
  import { appAchievementProgress, libraryStats, nextAppAchievement, type AppAchievement } from '../lib/appAchievements';
  import { dayKey } from '../lib/util';

  let show = $state<'all' | 'open' | 'done'>('all');

  const progress = $derived(appAchievementProgress(libraryStats(app.games, Math.floor(Date.now() / 1000)), app.appAchievements));
  const earned = $derived(progress.filter((p) => p.earnedAt != null).length);
  const next = $derived(nextAppAchievement(progress));
  const shown = $derived(progress.filter((p) => show === 'all' || (show === 'done') === (p.earnedAt != null)));

  const name = (a: AppAchievement) => t(`appAch.${a.id}` as MessageKey);
  const desc = (a: AppAchievement) => t(`appAch.${a.id}.desc` as MessageKey, { n: a.goal });
</script>

<div class="toolbar">
  <div>
    <h2>{t('appAchs.title')}</h2>
    <span class="muted small">{t('appAchs.count', { n: earned, total: progress.length })} · {t('appAchs.intro')}</span>
  </div>
  <div class="tabs">
    <button class="ghost" class:active={show === 'all'} onclick={() => (show = 'all')}>{t('game.all')}</button>
    <button class="ghost" class:active={show === 'open'} onclick={() => (show = 'open')}>{t('game.open', { n: progress.length - earned })}</button>
    <button class="ghost" class:active={show === 'done'} onclick={() => (show = 'done')}>{t('game.done', { n: earned })}</button>
  </div>
</div>

<div class="content">
  <div class="bar total" class:perfect={earned === progress.length}><i style="width:{(earned / progress.length) * 100}%"></i></div>
  {#if earned === progress.length}
    <p class="hero">{t('appAchs.allDone')}</p>
  {:else if next}
    <p class="hero">
      {t('appAchs.next', { icon: next.achievement.icon, name: name(next.achievement), left: next.achievement.goal - next.current })}
    </p>
  {/if}

  <ul>
    {#each shown as p (p.achievement.id)}
      {@const a = p.achievement}
      {@const done = p.earnedAt != null}
      <li class:done class="tier{a.tier}">
        <span class="icon">{a.icon}</span>
        <div class="main">
          <div class="title">
            <b>{name(a)}</b>
            <span class="chip tier">{t(`appAchs.tier${a.tier}`)}</span>
          </div>
          <span class="small muted">{desc(a)}</span>
          {#if done}
            <span class="small gold">{t('appAchs.earnedAt', { date: dayKey(p.earnedAt!) })}</span>
          {:else if a.goal > 1}
            <div class="progress">
              <div class="bar"><i style="width:{(p.current / a.goal) * 100}%"></i></div>
              <span class="small muted">{p.current}/{a.goal}</span>
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
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
  .toolbar > div:first-child { flex: 1; min-width: 0; }
  .tabs { display: flex; gap: 2px; flex: none; }
  .tabs .active { background: var(--accent-soft); color: var(--accent); }
  h2 { margin: 0; font-size: 17px; }
  .content { padding: 12px 16px; display: grid; gap: 12px; }
  .total { height: 8px; }
  .hero { margin: 0; padding: 10px 12px; border-radius: var(--radius); background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
  li {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 10px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  li:not(.done) .icon { filter: grayscale(1); opacity: 0.45; }
  li.done { border-color: color-mix(in srgb, var(--gold) 55%, var(--border)); }
  li.done.tier3 { background: color-mix(in srgb, var(--gold) 10%, var(--surface)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--gold) 40%, transparent); }
  .icon { font-size: 28px; line-height: 1; width: 34px; text-align: center; flex: none; }
  .main { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .title { display: flex; gap: 6px; align-items: center; justify-content: space-between; }
  .tier2 .tier { color: var(--accent); }
  .tier3 .tier { color: var(--warn); }
  .gold { color: var(--gold); }
  .progress { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
  .progress .bar { flex: 1; }
</style>
