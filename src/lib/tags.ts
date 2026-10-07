import type { Achievement, SchemaAchievement } from './types';

export type AutoTag = 'online' | 'coop' | 'difficulty' | 'collectible' | 'grind' | 'speedrun' | 'missable';

/** Patterns in English and German, matched against name + description. */
const RULES: [AutoTag, RegExp][] = [
  ['online', /\b(online|multiplayer|ranked|pvp|matchmaking|mehrspieler|versus|vs\.? mode)\b/i],
  ['coop', /\b(co-?op|cooperative|koop(erativ)?|with a friend|mit einem freund)\b/i],
  [
    'difficulty',
    /\b(hard(core)?|nightmare|insane|legendary|veteran|expert|master difficulty|permadeath|ironman|schwer|albtraum|without (dying|taking damage|being hit)|no damage|ohne zu sterben|deathless)\b/i,
  ],
  [
    'collectible',
    /\b(collect(ed)? (all|every)|find (all|every)|all (the )?(collectibles|secrets|items|chests)|every (collectible|secret)|sammle alle|finde alle|alle (sammelobjekte|geheimnisse))\b/i,
  ],
  // A guess: one-shot choices, run-wide conditions and "before X" windows can be lost for the current playthrough.
  [
    'missable',
    /\b((first|single|same|one) playthrough|in (a|one) single (run|playthrough|save)|point of no return|before (leaving|finishing|completing|reaching|the end|chapter|act)|spare|let \w+ live|side with|without (ever|using|killing|saving|upgrading|buying)|(ersten|einem|einzigen) durchlauf|bevor du|vor (kapitel|akt|dem ende)|verschon(e|t)|ohne (jemals|zu töten|zu speichern|aufzuwerten|etwas zu kaufen))\b/i,
  ],
  ['speedrun', /\b(under|within|in less than|unter|innerhalb (von)?) \d+ ?(min(ute)?s?|minuten|seconds?|sekunden|hours?|stunden)\b/i],
];

/** Counts like "Win 50 matches" or "Kill 1,000 enemies" hint at a grind. */
const GRIND_RE = /\b(\d{1,3}(?:[.,]\d{3})+|\d{3,})\b|\b(?:win|kill|defeat|complete|play|gewinne|töte|besiege|spiele)\s+(\d{2,})\b/i;

/** Stored tags only change on a schema refresh; this also applies newer rules. */
export const isMissable = (a: Pick<Achievement, 'name' | 'description' | 'tags'>) =>
  a.tags.includes('missable') || autoTags(a).includes('missable');

/** Open, counted achievements that may be missed in the current playthrough. */
export const missableOpen = <T extends Achievement>(list: T[]): T[] =>
  list.filter((a) => !a.achieved && !a.excluded && isMissable(a));

export function autoTags(a: Pick<SchemaAchievement, 'name' | 'description'>): AutoTag[] {
  const text = `${a.name} ${a.description}`;
  const tags: AutoTag[] = [];
  for (const [tag, re] of RULES) if (re.test(text)) tags.push(tag);
  const m = text.match(GRIND_RE);
  if (m) {
    const n = Number((m[1] ?? m[2]).replace(/[.,]/g, ''));
    // Years ("1999") are not grinds.
    const looksLikeYear = n >= 1900 && n <= 2100 && !/[.,]/.test(m[1] ?? '');
    if (n >= 50 && !looksLikeYear) tags.push('grind');
  }
  return tags;
}
