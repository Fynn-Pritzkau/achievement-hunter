import { describe, expect, it } from 'vitest';
import { effortLevel, estimateLeftMin, SMART_LISTS } from '../src/lib/lists';
import { aggregate, cleanTag, manualTags, mergeSchema } from '../src/lib/sync/merge';
import { missableOpen } from '../src/lib/tags';
import { timelinePoints } from '../src/lib/timeline';
import { emptyGame, type Achievement, type SchemaAchievement } from '../src/lib/types';

const schema = (apiname: string, description = ''): SchemaAchievement => ({
  apiname,
  name: apiname,
  description,
  hidden: false,
  icon: '',
  icongray: '',
});
const ach = (apiname: string, patch: Partial<Achievement> = {}): Achievement => ({
  ...schema(apiname),
  achieved: false,
  unlocktime: 0,
  percent: null,
  pinned: false,
  excluded: false,
  note: '',
  tags: [],
  ...patch,
});
const game = (patch: Partial<ReturnType<typeof emptyGame>>) => ({ ...emptyGame(1, 'G'), ...patch });

describe('effortLevel', () => {
  it('grades what is left and skips perfect or unknown games', () => {
    expect(effortLevel(game({ total: 10, unlocked: 5, effort: 10 }))).toBe('easy');
    expect(effortLevel(game({ total: 10, unlocked: 5, effort: 100 }))).toBe('medium');
    expect(effortLevel(game({ total: 10, unlocked: 5, effort: 1000 }))).toBe('hard');
    expect(effortLevel(game({ total: 10, unlocked: 5, effort: 5000 }))).toBe('brutal');
    expect(effortLevel(game({ total: 10, unlocked: 10, effort: 0 }))).toBeNull();
    expect(effortLevel(game({ total: null }))).toBeNull();
  });
});

describe('estimateLeftMin', () => {
  it('scales the pace so far by the open rarity points', () => {
    // 600 min for 100 points → 6 min per point; 50 points open → 300 min.
    expect(estimateLeftMin(game({ total: 10, unlocked: 5, playtime: 600, rarityScore: 100, effort: 50 }))).toBe(300);
  });
  it('needs a few unlocks and an hour of play', () => {
    expect(estimateLeftMin(game({ total: 10, unlocked: 2, playtime: 600, rarityScore: 10, effort: 5 }))).toBeNull();
    expect(estimateLeftMin(game({ total: 10, unlocked: 5, playtime: 30, rarityScore: 10, effort: 5 }))).toBeNull();
    expect(estimateLeftMin(game({ total: 10, unlocked: 10, playtime: 600, rarityScore: 10, effort: 0 }))).toBeNull();
  });
  it('feeds the "next perfect" list', () => {
    const closest = SMART_LISTS.find((l) => l.id === 'closest')!;
    const ctx = { runningAppIds: [], now: 0 };
    expect(closest.filter(game({ total: 10, unlocked: 5, playtime: 600, rarityScore: 100, effort: 50 }), ctx)).toBe(true);
    expect(closest.filter(game({ total: 10, unlocked: 5, playtime: 6000, rarityScore: 100, effort: 50 }), ctx)).toBe(false);
  });
});

describe('manual tags', () => {
  it('survive a schema refresh, even when named like an auto tag', () => {
    const prev = [ach('a', { tags: ['missable', 'boss'], manualTags: ['missable', 'boss'] })];
    const [a] = mergeSchema(prev, [schema('a', 'Beat the boss')]);
    expect(a.manualTags).toEqual(['missable', 'boss']);
    expect(a.tags).toEqual(expect.arrayContaining(['missable', 'boss']));
  });
  it('are taken from older data without the field', () => {
    const old = ach('a', { description: 'Win 100 matches', tags: ['grind', 'boss'] });
    expect(manualTags(old)).toEqual(['boss']);
    expect(mergeSchema([old], [schema('a', 'Win 100 matches')])[0].manualTags).toEqual(['boss']);
  });
  it('are cleaned before saving', () => {
    expect(cleanTag('  Boss,  Fight ')).toBe('boss fight');
    expect(cleanTag(' , ')).toBe('');
  });
});

describe('added achievements', () => {
  it('are stamped only when the list was known before', () => {
    const merged = mergeSchema([ach('a')], [schema('a'), schema('dlc')], 1000);
    expect(merged.map((a) => a.addedAt)).toEqual([0, 1000]);
    expect(mergeSchema([], [schema('a')], 1000)[0].addedAt).toBe(0);
  });
});

describe('aggregate', () => {
  it('counts pinned open achievements, not unlocked or excluded ones', () => {
    const list = [
      ach('a', { pinned: true }),
      ach('b', { pinned: true, achieved: true, unlocktime: 1 }),
      ach('c', { pinned: true, excluded: true }),
      ach('d'),
    ];
    expect(aggregate(list).pinnedOpen).toBe(1);
  });
});

describe('missableOpen', () => {
  it('finds open missables by stored tag or by the current rules', () => {
    const list = [
      ach('tagged', { tags: ['missable'] }),
      ach('rule', { description: 'Spare the king before leaving the castle' }),
      ach('done', { tags: ['missable'], achieved: true }),
      ach('excluded', { tags: ['missable'], excluded: true }),
      ach('plain'),
    ];
    expect(missableOpen(list).map((a) => a.apiname)).toEqual(['tagged', 'rule']);
  });
});

describe('timelinePoints', () => {
  it('climbs once per unlock, oldest first, without excluded ones', () => {
    const list = [
      ach('b', { achieved: true, unlocktime: 200 }),
      ach('a', { achieved: true, unlocktime: 100 }),
      ach('notime', { achieved: true, unlocktime: 0 }),
      ach('x', { achieved: true, unlocktime: 150, excluded: true }),
      ach('open'),
    ];
    const pts = timelinePoints(list, 4);
    expect(pts.map((p) => [p.t, p.pct])).toEqual([
      [100, 50],
      [200, 75],
    ]);
  });
});
