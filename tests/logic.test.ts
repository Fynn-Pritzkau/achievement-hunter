import { describe, expect, it } from 'vitest';
import { Limiter, withRetry } from '../src/lib/steam/limiter';
import { decideStatus } from '../src/lib/sync/status';
import { autoTags } from '../src/lib/tags';

const now = 2_000_000_000;
const base = { perfect: false, playedAgain: false, lastPlayed: now - 3600, staleDays: 14, now };

describe('decideStatus', () => {
  it('sets the first status from progress and recency', () => {
    expect(decideStatus(null, { ...base, perfect: true })).toBe('completed');
    expect(decideStatus(null, base)).toBe('playing');
    expect(decideStatus(null, { ...base, lastPlayed: now - 90 * 86400 })).toBe('paused');
  });
  it('never touches dropped', () => {
    expect(decideStatus('dropped', { ...base, perfect: true, playedAgain: true })).toBe('dropped');
  });
  it('moves between states', () => {
    expect(decideStatus('paused', { ...base, playedAgain: true })).toBe('playing');
    expect(decideStatus('playing', { ...base, lastPlayed: now - 20 * 86400 })).toBe('paused');
    expect(decideStatus('completed', base)).toBe('paused');
  });
});

describe('autoTags', () => {
  const t = (name: string, description = '') => autoTags({ name, description });
  it('finds common categories', () => {
    expect(t('Ranked Up', 'Win a ranked online match')).toContain('online');
    expect(t('Buddies', 'Finish the campaign in co-op')).toContain('coop');
    expect(t('Untouchable', 'Beat the boss without taking damage')).toContain('difficulty');
    expect(t('Hoarder', 'Collect all 120 feathers')).toEqual(expect.arrayContaining(['collectible', 'grind']));
    expect(t('Veteran', 'Win 50 matches')).toContain('grind');
    expect(t('Fast', 'Finish level 1 in under 5 minutes')).toContain('speedrun');
  });
  it('ignores plain story achievements and years', () => {
    expect(t('Chapter 1', 'Complete chapter 1')).toEqual([]);
    expect(t('Party like 1999', 'Reach the year 1999')).toEqual([]);
  });
  it('flags likely missable achievements', () => {
    expect(t('Mercy', 'Spare the bandit leader')).toContain('missable');
    expect(t('Pacifist', 'Finish the game without killing anyone')).toContain('missable');
    expect(t('Early Bird', 'Find the key before leaving the village')).toContain('missable');
    expect(t('One Shot', 'Do it all on your first playthrough')).toContain('missable');
    expect(t('Gnade', 'Verschone den Banditenanführer')).toContain('missable');
    expect(t('Puristisch', 'Beende das Spiel ohne jemals zu speichern')).toContain('missable');
    expect(t('Done', 'Complete the game')).not.toContain('missable');
    expect(t('Untouchable', 'Win without dying')).toEqual(['difficulty']);
  });
});

describe('limiter and retry', () => {
  it('caps concurrency', async () => {
    const lim = new Limiter({ concurrency: 2, minIntervalMs: 0 });
    let active = 0;
    let peak = 0;
    const job = () =>
      lim.run(async () => {
        peak = Math.max(peak, ++active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });
    await Promise.all([job(), job(), job(), job(), job()]);
    expect(peak).toBe(2);
  });
  it('retries with growing delays, then gives up', async () => {
    const delays: number[] = [];
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('boom');
        },
        { retries: 3, baseDelayMs: 100, retryable: () => true, sleep: async (ms) => void delays.push(ms) },
      ),
    ).rejects.toThrow('boom');
    expect(calls).toBe(4);
    expect(delays[0]).toBeGreaterThanOrEqual(100);
    expect(delays[2]).toBeGreaterThanOrEqual(400);
  });
});
