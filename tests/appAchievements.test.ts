import { describe, expect, it } from 'vitest';
import { isMessageKey } from '../src/lib/i18n.svelte';
import { APP_ACHIEVEMENTS, appAchievementProgress, libraryStats, newlyEarned, nextAppAchievement } from '../src/lib/appAchievements';
import { emptyGame, type Game } from '../src/lib/types';

const now = 2_000_000_000;
const game = (appid: number, over: Partial<Game> = {}): Game => ({ ...emptyGame(appid, `Game ${appid}`), total: 10, ...over });
const ids = (list: { id: string }[]) => list.map((a) => a.id);

describe('app achievements', () => {
  it('has unique ids and a name and description for each', () => {
    expect(new Set(ids(APP_ACHIEVEMENTS)).size).toBe(APP_ACHIEVEMENTS.length);
    for (const a of APP_ACHIEVEMENTS) {
      expect(isMessageKey(`appAch.${a.id}`)).toBe(true);
      expect(isMessageKey(`appAch.${a.id}.desc`)).toBe(true);
    }
  });

  it('earns achievements from the library numbers', () => {
    const games = [
      game(1, { unlocked: 10, playtime: 90, lastUnlock: now - 3600 }),
      game(2, { unlocked: 3, lastUnlock: now - 3600 }),
      game(3, { status: 'dropped' }),
      game(4, { total: 0 }),
    ];
    const fresh = ids(newlyEarned(libraryStats(games, now), {}));
    expect(fresh).toEqual(expect.arrayContaining(['perfect1', 'quickie', 'lettingGo', 'touched']));
    expect(fresh).not.toContain('perfect5');
    expect(fresh).not.toContain('marathon');
    expect(fresh).not.toContain('perfectWeek');
  });

  it('recognises the harder ones', () => {
    const games = [
      // 250 achievements, 600 h, average unlock rate of 4 % (rarityScore = 250 * 100/4).
      game(1, { total: 250, unlocked: 250, playtime: 600 * 60, rarityScore: 6250, lastUnlock: now - DAY }),
      game(2, { unlocked: 10, lastUnlock: now - 2 * DAY }),
    ];
    const fresh = ids(newlyEarned(libraryStats(games, now), {}));
    expect(fresh).toEqual(expect.arrayContaining(['titan', 'epic', 'hardcore', 'gem', 'perfectWeek']));
    // Only a week later, the two 100 %s are no longer within 7 days.
    expect(ids(newlyEarned(libraryStats(games, now + 8 * DAY), {}))).not.toContain('perfectWeek');
  });

  it('keeps earned ones and does not hand them out twice', () => {
    const stats = libraryStats([game(1, { unlocked: 10 })], now);
    expect(ids(newlyEarned(stats, { perfect1: 1 }))).not.toContain('perfect1');
    // Earned stays earned, even when the library no longer qualifies.
    const lost = appAchievementProgress(libraryStats([game(1, { unlocked: 9 })], now), { perfect1: 1 });
    expect(lost.find((p) => p.achievement.id === 'perfect1')!.earnedAt).toBe(1);
  });

  it('suggests the closest open one', () => {
    const games = Array.from({ length: 4 }, (_, i) => game(i + 1, { unlocked: 10 }));
    const next = nextAppAchievement(appAchievementProgress(libraryStats(games, now), { perfect1: 1 }));
    expect(next?.achievement.id).toBe('perfect5');
    expect(next?.current).toBe(4);
  });
});

const DAY = 86400;
