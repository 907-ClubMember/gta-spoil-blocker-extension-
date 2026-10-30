export const CATEGORIES = ['story', 'characters', 'map', 'gameplay', 'leaks', 'trailers'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * strong:  blocks on its own (a named plot detail).
 * weak:    blocks only when the page is clearly about the game (a common name or place).
 * context: never blocks, only marks a page as "about the game" (the game's own name).
 */
export type Strength = 'strong' | 'weak' | 'context';
export type Strictness = 'light' | 'medium' | 'strict';

/** One list entry. See Strength for how each kind behaves. */
export interface Term {
  t: string;
  c: Category;
  s: Strength;
  /** Shown in an official trailer. Left alone when the user allows trailer content. */
  tr?: true;
  /** What kind of thing it is (sets its level). Absent on older lists: see kindOf. */
  k?: Kind;
  /** Raised level: the name itself gives away plot, or how/when/what you get. Never lowers the kind's level. */
  l?: 1 | 2 | 3;
  /**
   * Ordinary: the name is also everyday text (a phrase, a common name), as the job's describe step judged it
   * (distinctive: no). A hint word beside it is not enough to tie a post to the game; it needs a real game signal.
   */
  o?: true;
  /**
   * Rare made-up person name: a side or walk-on person whose first and last names are neither common names nor words. Has its own
   * setting (Settings.rareNames), and marks a post as being about the game, since such a name almost never appears anywhere else.
   */
  r?: true;
}

/** The published list, after decoding. */
export interface SpoilerList {
  v: number;
  terms: Term[];
  /** The game's release day (YYYY-MM-DD), when the list publishes one: the launch-week blackout counts from it. */
  release?: string;
}

/**
 * What kind of thing a list entry is. Game-neutral: every Rockstar game's list uses the same kinds.
 * The kind sets how much a name spoils (its level), which the user's "What to protect" setting reads.
 */
export const KINDS = [
  'lead', 'cast', 'side', 'minor',
  'group', 'brand',
  'setting', 'area', 'storyplace',
  'mission', 'heist', 'chapter', 'final', 'sidejob',
  'fate', 'twist',
  'secret', 'myth', 'unlock', 'collect',
  // A new or other type of thing that none of the kinds above fits (the model may pick it). Hides only with a game mention.
  'other',
] as const;
export type Kind = (typeof KINDS)[number];

/** 0 = never hides (only marks a post as about the game), 1 = side, 2 = main story, 3 = big moments. */
export type Level = 0 | 1 | 2 | 3;

export const KIND_BASE_LEVEL: Record<Kind, Level> = {
  lead: 2, cast: 2, side: 1, minor: 1,
  group: 2, brand: 0,
  setting: 0, area: 0, storyplace: 1,
  mission: 3, heist: 3, chapter: 3, final: 3, sidejob: 2,
  fate: 3, twist: 3,
  secret: 1, myth: 1, unlock: 1, collect: 1,
  other: 1,
};

export const KIND_GROUPS = ['people', 'groups', 'places', 'missions', 'moments', 'gameplay', 'other'] as const;
export type KindGroup = (typeof KIND_GROUPS)[number];

export const KIND_GROUP: Record<Kind, KindGroup> = {
  lead: 'people', cast: 'people', side: 'people', minor: 'people',
  group: 'groups', brand: 'groups',
  setting: 'places', area: 'places', storyplace: 'places',
  mission: 'missions', heist: 'missions', chapter: 'missions', final: 'missions', sidejob: 'missions',
  fate: 'moments', twist: 'moments',
  secret: 'gameplay', myth: 'gameplay', unlock: 'gameplay', collect: 'gameplay',
  other: 'other',
};

/** The older, coarser category each kind belongs to (cover labels and per-category switches use it). */
export const KIND_CATEGORY: Record<Kind, Category> = {
  lead: 'characters', cast: 'characters', side: 'characters', minor: 'characters',
  group: 'characters', brand: 'characters',
  setting: 'map', area: 'map', storyplace: 'map',
  mission: 'story', heist: 'story', chapter: 'story', final: 'story', sidejob: 'story',
  fate: 'story', twist: 'story',
  secret: 'gameplay', myth: 'gameplay', unlock: 'gameplay', collect: 'gameplay',
  other: 'story',
};

export const isKind = (v: unknown): v is Kind => typeof v === 'string' && (KINDS as readonly string[]).includes(v);

/** The kind of an entry, guessed from its category and strength when an older list carries none. */
export function kindOf(t: Pick<Term, 'c' | 's' | 'k'>): Kind {
  if (t.k) return t.k;
  switch (t.c) {
    case 'characters': return t.s === 'strong' ? 'cast' : 'side';
    case 'map': return t.s === 'context' ? 'setting' : t.s === 'strong' ? 'storyplace' : 'area';
    case 'gameplay': return 'unlock';
    default: return t.s === 'context' ? 'setting' : 'mission';
  }
}

/** How much an entry spoils: its kind's level, or higher when the job found the name itself gives plot away. */
export function levelOf(t: Pick<Term, 'c' | 's' | 'k' | 'l'>): Level {
  if (t.s === 'context') return 0;
  const base = KIND_BASE_LEVEL[kindOf(t)];
  return (t.l && t.l > base ? t.l : base) as Level;
}
