/**
 * The library of the mock mode: real store AppIDs (so capsule images load), made-up achievements.
 * Deterministic: the same seed always gives the same library, so a scenario looks the same on every load.
 * Covers the states the UI distinguishes: perfect, almost done, untouched, no achievements, hidden ones,
 * missables, stat-counted progress, not owned (family sharing), rare ones, games played long ago.
 */
import type { FakeAchMeta } from './fakeSteam';

export interface FixtureAch {
  apiname: string;
  meta: FakeAchMeta;
  unlocked: boolean;
  unlocktime: number;
  percent: number;
  hidden: boolean;
  /** Stat-counted: [current, max]. */
  progress?: [number, number];
}

export interface FixtureGame {
  appid: number;
  name: string;
  /** Minutes. */
  playtime: number;
  /** Unix seconds, 0 = never. */
  lastPlayed: number;
  achievements: FixtureAch[];
  notOwned?: boolean;
  /** Steam answers "not public" for this game's achievements (as for family-shared games). */
  playerPrivate?: boolean;
}

interface Def {
  appid: number;
  name: string;
  hours: number;
  /** Days since last played; null = never. */
  ago: number | null;
  ach: number;
  /** Share unlocked, 0..1. */
  done: number;
  hidden?: number;
  /** Achievements counted by a stat (shows "37 / 50"). */
  stats?: number;
  missable?: number;
  notOwned?: boolean;
  /** Harder game: lower unlock rates. */
  hard?: boolean;
}

const DEFS: Def[] = [
  { appid: 1145360, name: 'Hades', hours: 92, ago: 1, ach: 49, done: 0.82, hidden: 4, stats: 3, missable: 1 },
  { appid: 367520, name: 'Hollow Knight', hours: 61, ago: 3, ach: 63, done: 0.95, hidden: 6, stats: 2, hard: true },
  { appid: 413150, name: 'Stardew Valley', hours: 140, ago: 0, ach: 40, done: 0.7, stats: 6, missable: 1 },
  { appid: 504230, name: 'Celeste', hours: 34, ago: 12, ach: 32, done: 1, hard: true },
  { appid: 1086940, name: "Baldur's Gate 3", hours: 118, ago: 2, ach: 54, done: 0.46, hidden: 8, missable: 6 },
  { appid: 292030, name: 'The Witcher 3: Wild Hunt', hours: 160, ago: 210, ach: 78, done: 0.64, missable: 4 },
  { appid: 620, name: 'Portal 2', hours: 22, ago: 400, ach: 51, done: 1 },
  { appid: 646570, name: 'Slay the Spire', hours: 210, ago: 6, ach: 46, done: 0.98, hard: true },
  { appid: 1794680, name: 'Vampire Survivors', hours: 55, ago: 9, ach: 204, done: 0.88, stats: 4 },
  { appid: 588650, name: 'Dead Cells', hours: 48, ago: 30, ach: 122, done: 0.41, hard: true, stats: 2 },
  { appid: 105600, name: 'Terraria', hours: 300, ago: 45, ach: 88, done: 0.75, stats: 3 },
  { appid: 268910, name: 'Cuphead', hours: 18, ago: 95, ach: 28, done: 0.5, hard: true },
  { appid: 814380, name: 'Sekiro: Shadows Die Twice', hours: 70, ago: 60, ach: 34, done: 0.97, missable: 2, hard: true },
  { appid: 1245620, name: 'ELDEN RING', hours: 150, ago: 15, ach: 42, done: 0.9, missable: 3, hard: true },
  { appid: 753640, name: 'Outer Wilds', hours: 25, ago: 300, ach: 31, done: 0.74, hidden: 10 },
  { appid: 1868140, name: 'DAVE THE DIVER', hours: 40, ago: 20, ach: 43, done: 0.93, stats: 3 },
  { appid: 1091500, name: 'Cyberpunk 2077', hours: 85, ago: 120, ach: 57, done: 0.37, missable: 3 },
  { appid: 391540, name: 'Undertale', hours: 12, ago: 700, ach: 0, done: 0 },
  { appid: 427520, name: 'Factorio', hours: 400, ago: 4, ach: 37, done: 0.62, stats: 5 },
  { appid: 289070, name: "Sid Meier's Civilization VI", hours: 230, ago: 80, ach: 320, done: 0.23, hard: true },
  { appid: 730, name: 'Counter-Strike 2', hours: 520, ago: 7, ach: 1, done: 1 },
  { appid: 570, name: 'Dota 2', hours: 0.4, ago: 900, ach: 0, done: 0 },
  { appid: 1172470, name: 'Apex Legends', hours: 64, ago: 150, ach: 12, done: 0.33 },
  { appid: 250900, name: 'The Binding of Isaac: Rebirth', hours: 95, ago: 25, ach: 641, done: 0.31, hard: true },
  { appid: 435150, name: 'Divinity: Original Sin 2', hours: 0, ago: null, ach: 60, done: 0 },
  { appid: 374320, name: 'DARK SOULS III', hours: 3, ago: 500, ach: 43, done: 0.07, hard: true },
  { appid: 1593500, name: 'God of War', hours: 26, ago: 40, ach: 37, done: 0.59, notOwned: true, missable: 1 },
  { appid: 1817070, name: "Marvel's Spider-Man Remastered", hours: 9, ago: 70, ach: 51, done: 0.2, notOwned: true },
];

// Name parts for made-up achievements.
const ADJ = ['Silent', 'Golden', 'Iron', 'Lost', 'Final', 'Crimson', 'Hidden', 'Endless', 'Brave', 'Shattered', 'Ancient', 'Swift', 'Lucky', 'Hollow', 'Wild', 'Frozen'];
const NOUN = ['Blade', 'Crown', 'Path', 'Echo', 'Storm', 'Legacy', 'Oath', 'Harvest', 'Spark', 'Voyage', 'Shadow', 'Beacon', 'Tide', 'Relic', 'Dawn', 'Gambit'];

// Templates; some hit the auto-tag rules (grind, collectible, difficulty, online, coop, speedrun).
const DESC = [
  'Complete the tutorial.',
  'Defeat the first boss.',
  'Reach chapter {n}.',
  'Win {big} matches.',
  'Collect all relics in the {noun} region.',
  'Finish the game on Nightmare difficulty.',
  'Win an online match against another player.',
  'Finish a level with a friend in co-op.',
  'Complete any run in under 30 minutes.',
  'Craft a legendary {noun}.',
  'Discover the secret of the {noun}.',
  'Upgrade a weapon to its maximum level.',
  'Kill {big} enemies.',
  'Find every hidden {noun}.',
  'Unlock all characters.',
  'Spend 1,000 gold in a single visit.',
];
const MISSABLE = [
  'Spare the {noun} keeper before leaving the village.',
  'Finish the story without ever killing an innocent.',
  'Side with the {noun} order in the first playthrough.',
  'Read the letter before the point of no return.',
];
const HIDDEN = ['Witness the true ending.', 'Uncover what lies beneath the {noun}.', 'Betray an old friend.', 'Find the room that should not exist.'];
const STAT = ['Catch {max} fish.', 'Open {max} chests.', 'Collect {max} {noun} shards.', 'Travel {max} km.', 'Harvest {max} crops.', 'Win {max} runs.'];

/** Mulberry32: tiny seeded PRNG, enough for stable fake data. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GLYPHS = ['★', '♦', '♠', '♣', '♥', '⚔', '☀', '☾', '✦', '❖', '✚', '◆', '▲', '●', '✿', '⚑'];

/** A small SVG badge as data URI, so icons need no network. */
export function badge(seed: number, gray: boolean): string {
  const r = rng(seed);
  const hue = Math.floor(r() * 360);
  const glyph = GLYPHS[Math.floor(r() * GLYPHS.length)];
  const [a, b] = gray ? ['#5a5f68', '#2c3036'] : [`hsl(${hue} 70% 55%)`, `hsl(${(hue + 40) % 360} 65% 28%)`];
  const fg = gray ? '#9aa0a8' : '#fff';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
    `<rect width="64" height="64" rx="10" fill="url(#g)"/>` +
    `<text x="32" y="43" font-size="30" text-anchor="middle" fill="${fg}" font-family="Segoe UI Symbol, sans-serif">${glyph}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const DAY = 86_400;

/** Builds the fixture library relative to `nowSec`. */
export function buildLibrary(nowSec: number, seed = 7): FixtureGame[] {
  return DEFS.map((d) => buildGame(d, nowSec, seed));
}

function buildGame(d: Def, nowSec: number, seed: number): FixtureGame {
  const r = rng(seed * 100_003 + d.appid);
  const pick = <T>(list: T[]) => list[Math.floor(r() * list.length)];
  const lastPlayed = d.ago == null ? 0 : nowSec - d.ago * DAY - Math.floor(r() * 6 * 3600);
  // First session: a while before the last one, longer for games with many hours.
  const firstPlayed = lastPlayed - Math.max(3, Math.min(600, d.hours * 2.5)) * DAY;
  const fill = (s: string, n: number) =>
    s.replace('{noun}', pick(NOUN).toLowerCase()).replace('{n}', String(2 + (n % 9))).replace('{big}', String(pick([50, 100, 250, 500, 1000])));

  const unlockedCount = Math.round(d.ach * d.done);
  const achievements: FixtureAch[] = [];
  const used = new Set<string>();
  for (let i = 0; i < d.ach; i++) {
    // Big games need more names than "Adjective Noun" gives; later patterns cover them.
    const patterns = [() => `${pick(ADJ)} ${pick(NOUN)}`, () => `The ${pick(ADJ)} ${pick(NOUN)}`, () => `${pick(NOUN)} of the ${pick(ADJ)} ${pick(NOUN)}`];
    let name = '';
    for (let tries = 0; !name || used.has(name); tries++) name = patterns[Math.min(2, Math.floor(tries / 8))]();
    used.add(name);
    // Kinds are spread from the end, so open achievements include the interesting ones.
    const fromEnd = d.ach - 1 - i;
    const hidden = fromEnd < (d.hidden ?? 0);
    const missable = !hidden && fromEnd >= (d.hidden ?? 0) && fromEnd < (d.hidden ?? 0) + (d.missable ?? 0);
    const stat = !hidden && !missable && fromEnd >= (d.hidden ?? 0) + (d.missable ?? 0) && fromEnd < (d.hidden ?? 0) + (d.missable ?? 0) + (d.stats ?? 0);
    let description = fill(pick(hidden ? HIDDEN : missable ? MISSABLE : DESC), i);
    let progress: [number, number] | undefined;
    if (stat) {
      const max = pick([10, 25, 50, 100, 250, 500]);
      description = fill(pick(STAT), i).replace('{max}', max.toLocaleString('en'));
      progress = [Math.floor(max * (0.2 + r() * 0.75)), max];
    }
    // Early achievements are common, late ones rare; hard games are rarer overall.
    const base = 85 * Math.pow(1 - i / Math.max(1, d.ach), d.hard ? 2.4 : 1.4) + r() * 6;
    const percent = Math.max(0.1, Math.min(99, base * (d.hard ? 0.6 : 1)));
    achievements.push({
      apiname: `ACH_${String(i + 1).padStart(3, '0')}`,
      meta: { name, description, icon: badge(d.appid * 1000 + i, false), icongray: badge(d.appid * 1000 + i, true) },
      unlocked: false,
      unlocktime: 0,
      percent: Math.round(percent * 10) / 10,
      hidden,
      progress,
    });
  }
  // Unlock the most common ones first, like a real player; the order of the times follows the rarity.
  const byRate = [...achievements].sort((a, b) => b.percent - a.percent);
  const unlocked = byRate.slice(0, unlockedCount).filter((a) => !a.progress || d.done === 1);
  // A finished game has everything; otherwise stat-counted ones stay open (they show progress).
  const extra = d.done === 1 ? [] : byRate.slice(unlockedCount, unlockedCount + (unlockedCount - unlocked.length)).filter((a) => !a.progress);
  const all = [...unlocked, ...extra];
  all.forEach((a, k) => {
    a.unlocked = true;
    a.unlocktime = Math.floor(firstPlayed + ((lastPlayed - firstPlayed) * (k + 1)) / (all.length + 1));
    if (a.progress) a.progress = [a.progress[1], a.progress[1]];
  });

  return {
    appid: d.appid,
    name: d.name,
    playtime: Math.round(d.hours * 60),
    lastPlayed,
    achievements,
    notOwned: d.notOwned,
    // Real Steam answers "Profile is not public" for games outside the library.
    playerPrivate: d.notOwned,
  };
}
