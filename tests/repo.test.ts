import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../src/lib/db/repo';
import { emptyGame, type Achievement } from '../src/lib/types';
import { dayKey } from '../src/lib/util';

const ach = (apiname: string, unlocktime: number, achieved = true): Achievement => ({
  apiname,
  name: apiname,
  description: '',
  hidden: false,
  icon: '',
  icongray: '',
  achieved,
  unlocktime,
  percent: null,
  pinned: false,
  excluded: false,
  note: '',
  tags: [],
});

// Local noon on a fixed day, so day grouping never crosses midnight.
const NOON = Math.floor(new Date(2026, 4, 10, 12).getTime() / 1000);

async function setup() {
  const repo = new MemoryRepo();
  await repo.saveGames([emptyGame(1, 'One'), { ...emptyGame(2, 'Hidden'), hidden: true }, emptyGame(3, 'Three')]);
  await repo.saveAchievements(1, [ach('a', NOON), ach('b', NOON + 60), ach('c', 0), ach('open', 0, false)]);
  await repo.saveAchievements(2, [ach('h', NOON + 30)]);
  await repo.saveAchievements(3, [ach('x', NOON + 86_400), ach('y', NOON - 86_400)]);
  return repo;
}

describe('unlock history', () => {
  it('pages newest first and skips hidden games and unknown times', async () => {
    const repo = await setup();
    const first = await repo.getUnlocks({ limit: 2 });
    expect(first.map((r) => r.apiname)).toEqual(['x', 'b']);
    expect(first[0].gameName).toBe('Three');
    const next = await repo.getUnlocks({ before: first[1].unlocktime, limit: 2 });
    expect(next.map((r) => r.apiname)).toEqual(['a', 'y']);
    expect(await repo.getUnlocks({ before: next[1].unlocktime, limit: 2 })).toEqual([]);
  });

  it('counts unlocks per local day', async () => {
    const repo = await setup();
    const days = Object.fromEntries((await repo.unlocksPerDay(NOON - 3600)).map((d) => [d.day, d.n]));
    expect(days).toEqual({ [dayKey(NOON * 1000)]: 2, [dayKey((NOON + 86_400) * 1000)]: 1 });
  });
});
