import { autoTags } from '../tags';
import type { Achievement, Game, PlayerAchievement, SchemaAchievement } from '../types';

/**
 * Applies a fresh schema to the stored list. Keeps what the user added (pins,
 * notes, exclusions, manual tags) and the known progress; drops achievements
 * that no longer exist.
 */
export function mergeSchema(existing: Achievement[], schema: SchemaAchievement[]): Achievement[] {
  const byName = new Map(existing.map((a) => [a.apiname, a]));
  return schema.map((s) => {
    const prev = byName.get(s.apiname);
    const auto = autoTags(s);
    // Manual tags are the ones the heuristic wouldn't produce; keep those, recompute the rest.
    const prevAuto = prev ? new Set<string>(autoTags(prev)) : new Set<string>();
    const manual = (prev?.tags ?? []).filter((t) => !prevAuto.has(t));
    return {
      ...s,
      achieved: prev?.achieved ?? false,
      unlocktime: prev?.unlocktime ?? 0,
      percent: prev?.percent ?? null,
      pinned: prev?.pinned ?? false,
      excluded: prev?.excluded ?? false,
      note: prev?.note ?? '',
      tags: [...new Set([...auto, ...manual])],
    };
  });
}

/** Applies player progress. Returns the achievements that are newly unlocked. */
export function applyPlayer(list: Achievement[], player: PlayerAchievement[]): Achievement[] {
  const byName = new Map(player.map((p) => [p.apiname, p]));
  const fresh: Achievement[] = [];
  for (const a of list) {
    const p = byName.get(a.apiname);
    if (!p) continue;
    if (p.achieved && !a.achieved) fresh.push(a);
    a.achieved = p.achieved;
    a.unlocktime = p.unlocktime;
    // Unlocking a pinned achievement takes it out of the focus queue.
    if (p.achieved) a.pinned = false;
  }
  return fresh;
}

export function applyGlobal(list: Achievement[], percents: Map<string, number>): void {
  for (const a of list) {
    const p = percents.get(a.apiname);
    if (p != null && Number.isFinite(p)) a.percent = p;
  }
}

/** Recomputes the per-game numbers the lists sort and filter by. */
export function aggregate(
  list: Achievement[],
): Pick<Game, 'unlocked' | 'total' | 'easyOpen' | 'effort' | 'rarestOpen' | 'rarityScore' | 'lastUnlock'> {
  let unlocked = 0;
  let total = 0;
  let easyOpen = 0;
  let effort = 0;
  let rarestOpen: number | null = null;
  let rarityScore = 0;
  let lastUnlock = 0;
  for (const a of list) {
    // Excluded achievements don't count either way: they are treated as not existing.
    if (a.excluded) continue;
    total++;
    const weight = 100 / Math.max(a.percent ?? 50, 0.1);
    if (a.achieved) {
      unlocked++;
      rarityScore += weight;
      if (a.unlocktime > lastUnlock) lastUnlock = a.unlocktime;
    } else {
      effort += weight;
      if (a.percent != null) {
        if (a.percent > 50) easyOpen++;
        if (rarestOpen == null || a.percent < rarestOpen) rarestOpen = a.percent;
      }
    }
  }
  return {
    unlocked,
    total,
    easyOpen,
    effort: Math.round(effort * 10) / 10,
    rarestOpen,
    rarityScore: Math.round(rarityScore * 10) / 10,
    lastUnlock,
  };
}
