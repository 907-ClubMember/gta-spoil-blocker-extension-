import { KIND_GROUP, kindOf, type Category, type KindGroup, type Strength, type Strictness, type Term } from '../types';
import { COMMON_FIRST_NAMES, DEFAULT_HINTS, HINT_REACH, NOT_STORY_HINTS, PERSON_STORY_WORDS, REACTION_EMOJI, SPOILER_WORDS, PLACE_EVENT_WORDS } from './hints';
import { DEBUG_WHY } from '../debug-flag';

const EMOJI_RE = new RegExp(Object.keys(REACTION_EMOJI).join('|'), 'gu');

export interface MatcherOptions {
  terms: Term[];
  strictness: Strictness;
  /** Categories to block. Custom keywords are always on. */
  categories: Set<Category>;
  /** Words the user never wants blocked. */
  allowWords: string[];
  /** The user's own keywords. They block alone at every strictness. */
  customWords: string[];
  /** A built-in spoiler account's names and the launch blackout's words: they block like the user's own, but a cover says where they came from. */
  accountWords?: string[];
  blackoutWords?: string[];
  /** Words that make a nearby weak term count (see hints.ts). Defaults to the built-in list. */
  hintWords?: string[];
  /** "Let official trailer content through": trailer words no longer make a post a spoiler. */
  allowTrailers?: boolean;
}

/** What a match reveals: categories only, never the term itself. */
export interface MatchResult {
  categories: Category[];
  custom: boolean;
  /** Which lists the custom words that counted came from (the cover's label names the setting). Never the words. */
  customFrom?: CustomFrom[];
  /** Strict covers it and Medium would not (the label says " · Strict"). */
  byStrict?: boolean;
  /** The kind groups of the hits (People, Missions...), for the popup's counts. Never the words. */
  groups?: (KindGroup | 'custom')[];
  /** Debug mode only: the matched terms ("strong characters: some name"). These ARE the words, so never shown unless the person turned on debug. */
  hits?: string[];
}

/** An @handle: not after a letter or digit (that is an address), then the handle's characters. */
const MENTION = /(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_]{1,30}/gu;

/** Where a custom word comes from: the person's own words, a built-in spoiler account's name, the launch blackout. */
export type CustomFrom = 'own' | 'account' | 'blackout';

export interface Found {
  /** The lists of the custom words found (see CustomFrom). */
  customFrom?: Set<CustomFrom>;
  strong: Set<Category | 'custom'>;
  weak: Set<Category | 'custom'>;
  /** The kind groups of the strong and weak hits. */
  strongGroups?: Set<KindGroup | 'custom'>;
  weakGroups?: Set<KindGroup | 'custom'>;
  /** The text names the game, holds a strong term, or holds a rare made-up name (Term.r), which marks a post as about the game. */
  context: boolean;
  /** The text names the game itself (one of its story markers), not only something that marks a text as about it. */
  game?: boolean;
  /** Tied to the game by more than a place name: its own name, a name that hides alone, an unusual name, or a story place event. */
  tied?: boolean;
  /**
   * Set when the only sign of the game is one rare made-up name: it ties the other names here to the game, but not itself (under
   * "only with game mention" it still needs another sign). Holds the categories and groups of the other weak hits.
   */
  selfMarked?: { weak: Set<Category | 'custom'>; groups: Set<KindGroup | 'custom'> };
  /** How many different weak terms it holds. */
  weakTerms: number;
  /** Two or more weak terms, at least one of them more than a very common first name. */
  namePair: boolean;
  /** A weak term that is not an everyday phrase has a hint word (a gaming, feeling or reaction word) close by. */
  hinted: boolean;
  /** Categories of spoiler words present ("ending", "trailer", "leak"). They count once the game is named. */
  spoil: Set<Category>;
  /** How many times it names the game or a strong term, repeats included. */
  mentions: number;
  words: number;
  /**
   * Real people (Term.p) with a story word close by. They count only once the text or the page is tied to the game (see decide);
   * they are never a sign of the game and never part of the hint or two-names rules.
   */
  real?: Set<Category | 'custom'>;
  realGroups?: Set<KindGroup | 'custom'>;
  /** Names that wait for a page about the game (Term.pg): they count only when the page is (see decide), never in `weak`. */
  pageOnly?: Set<Category | 'custom'>;
  pageOnlyGroups?: Set<KindGroup | 'custom'>;
  /** Debug mode only: what matched, as "strength category: term". */
  hits?: string[];
}

interface Compiled {
  tokens: string[];
  c: Category | 'custom';
  s: Strength;
  g: KindGroup | 'custom';
  /** An everyday phrase (Term.o): a hint word beside it does not count. */
  o?: true;
  /** A rare made-up name (Term.r): a marker as well as a name. */
  r?: true;
  /** A story place: words about what happens there count beside it. */
  place?: true;
  /** The joined (hashtag) form of a longer name: the words it was joined from, so it is one name with the spaced form. */
  orig?: string[];
  /** Safe to match loosely (Term.f): misspelt, plural or star-censored spellings of its long words still match, with a mention only. */
  f?: true;
  /** A real person (Term.p): counts only beside a story word, in text tied to the game. */
  p?: true;
  /** Waits for a page about the game (Term.pg): never counted by the post rules. */
  pg?: true;
  /** A custom word's list. */
  from?: CustomFrom;
}

/** Words of this length or more in a name marked safe (Term.f) are matched loosely; shorter ones never. Same limit as when the list is built. */
const FUZZ_MIN = 6;
/** The leak words (SPOILER_WORDS.leaks) and their other forms. */
const LEAK_FORMS = /^leak(?:s|ed|ing|d)?$/;
/** Every spelling of `w` with one letter taken out. */
const deletions = (w: string): string[] => [...new Set([...w].map((_, i) => w.slice(0, i) + w.slice(i + 1)))];
/** At most one letter added, dropped, changed, or two side by side swapped. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // one changed
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // two swapped
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

// Letters from other alphabets that are drawn the same as Latin ones. Swapping one in is a common way
// to slip a word past a filter; to a reader the word is unchanged.
const TWINS: Record<string, string> = {
  '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0445': 'x', '\u0443': 'y', '\u0456': 'i', '\u0458': 'j', '\u0455': 's',
  // The small forms of the capitals below, so a word comes out the same whatever its case.
  '\u043a': 'k', '\u043c': 'm', '\u043d': 'h', '\u0442': 't', '\u0432': 'b', '\u03b2': 'b', '\u03b5': 'e', '\u03ba': 'k', '\u03bc': 'm', '\u03c4': 't',
  '\u0410': 'A', '\u0412': 'B', '\u0415': 'E', '\u041a': 'K', '\u041c': 'M', '\u041d': 'H', '\u041e': 'O', '\u0420': 'P', '\u0421': 'C', '\u0422': 'T', '\u0425': 'X',
  '\u03bf': 'o', '\u03b1': 'a', '\u03bd': 'v', '\u03c1': 'p', '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u039a': 'K', '\u039c': 'M', '\u039d': 'N', '\u039f': 'O', '\u03a1': 'P', '\u03a4': 'T',
};
const TWIN_RE = new RegExp(`[${Object.keys(TWINS).join('')}]`, 'g');
const EMOJI_TOKENS = new Set(Object.values(REACTION_EMOJI));

const NO_SPACE = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Thai}';
const SCRIPT_CHANGE = new RegExp(`([\\p{Script=Latin}\\p{N}](?=[${NO_SPACE}])|[${NO_SPACE}](?=[\\p{Script=Latin}\\p{N}]))`, 'gu');

export function normalize(text: string): string {
  return text
    // Characters that take up no room on screen but would split a word in two.
    .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '')
    .replace(TWIN_RE, (m) => TWINS[m]!)
    .replace(/\u00df/g, 'ss')
    .replace(EMOJI_RE, (m) => ` ${REACTION_EMOJI[m]} `)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    // Chinese, Japanese, Korean and Thai are written without spaces: where the text switches between them and Latin letters
    // or digits, that is a word break ("今日Velmorreが" holds the name).
    .replace(SCRIPT_CHANGE, '$1 ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}


/**
 * A word never to hide that would take out the game's own name (a story marker) if the matcher let it: the name itself in any
 * case, spacing or punctuation, or run together ("#name"). A phrase holding the name, or its plural, takes out nothing.
 */
export function allowDropsGameName(word: string, terms: readonly Term[]): boolean {
  const w = normalize(word);
  if (!w) return false;
  return terms.some((t) => {
    if (t.s !== 'context' || t.c !== 'story') return false;
    const m = normalize(t.t);
    return w === m || w === m.replace(/ /g, '');
  });
}

function tokenize(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

export class Matcher {
  /** first token -> terms starting with it, so scanning stays linear in text length */
  private index = new Map<string, Compiled[]>();
  /** first token -> hint phrases starting with it */
  private hints = new Map<string, string[][]>();
  /** The hint phrases that are about the story (hints minus NOT_STORY_HINTS): the only ones that count for a real person. */
  private storyHints = new Map<string, string[][]>();
  /** first token -> spoiler words starting with it, each with the category switch that controls it */
  private spoilers = new Map<string, { tokens: string[]; c: Category }[]>();
  private placeEvents = new Map<string, string[][]>();
  private storySwitchOn: boolean;
  private leakOn: boolean;
  /** Every word that appears in any list entry: mangled words are only ever repaired into one of these. */
  private vocab = new Set<string>();
  /** The words of the game's own name (story markers): "no <game> spoilers" can reach past them. */
  private gameWords = new Set<string>();
  /** The game's name run together, for splitting it out of longer words (see the constructor and glued). */
  private gameDigit: string[] = [];
  private gameLetterRe: RegExp | null = null;
  private gamePlural = new Map<string, string[][]>();
  private strictness: Strictness;
  /** Opt-in debug: record the matched terms on each result. Off unless the person turns it on. */
  debug = false;

  constructor(opts: MatcherOptions) {
    this.strictness = opts.strictness;
    this.storySwitchOn = opts.categories.has('story');
    this.leakOn = opts.categories.has('leaks');
    for (const w of PLACE_EVENT_WORDS) {
      const tokens = normalize(w).split(' ');
      const bucket = this.placeEvents.get(tokens[0]!);
      if (bucket) bucket.push(tokens);
      else this.placeEvents.set(tokens[0]!, [tokens]);
    }
    // A word never to hide that is the game's own name (a saved, synced or imported one) is skipped: it would take out the name
    // as a marker, so nothing beside it would count as about the game, and as one of the words to hide (the launch-week blackout).
    const allow = new Set(opts.allowWords.filter((w) => !allowDropsGameName(w, opts.terms)).map(normalize).filter(Boolean));
    const add = (raw: string, c: Category | 'custom', s: Strength, g: KindGroup | 'custom', o?: true, r?: true, place?: true, f?: true, p?: true, pg?: true, from?: CustomFrom) => {
      const norm = normalize(raw);
      if (!norm || allow.has(norm)) return;
      const tokens = norm.split(' ');
      const put = (toks: string[], orig?: string[]) => {
        for (const tok of toks) this.vocab.add(tok);
        const k = toks[0]!;
        const entry: Compiled = { tokens: toks, c, s, g, ...(o ? { o } : {}), ...(r ? { r } : {}), ...(place ? { place } : {}), ...(f ? { f } : {}), ...(p ? { p } : {}), ...(pg ? { pg } : {}), ...(orig ? { orig } : {}), ...(from ? { from } : {}) };
        const bucket = this.index.get(k);
        if (bucket) bucket.push(entry);
        else this.index.set(k, [entry]);
      };
      put(tokens);
      if (f) for (const tok of tokens) if (tok.length >= FUZZ_MIN && /^\p{L}+$/u.test(tok)) this.fuzzWord(tok);
      // Names are also written run together, most often as hashtags: "#gamename", "#firstnamelastname".
      // A one- or two-letter result ("a b") is too short to mean anything.
      // An allowed word takes out its joined form too ("sunflower" allowed: "Sun Flower" is not found as "#sunflower").
      if (tokens.length >= 2 && tokens.length <= 4 && tokens.join('').length >= 3 && !allow.has(tokens.join(''))) put([tokens.join('')], tokens);
    };

    // A marker only says a text is about the game and never hides on its own: it stays even when its group is set to never
    // hide, or switching off one group would stop every other group's names from hiding on pages about the game.
    for (const t of opts.terms) if (t.s === 'context' && t.c === 'story') for (const w of normalize(t.t).split(' ')) if (w) this.gameWords.add(w);
    // The game's name run together with other letters ("GAME6news", "thegame6", "#GAME6Trailer", "r/GAME6unmoderated", "GAME6s")
    // still names the game: it is split out of the word (glued, below). A name with a number in it is split out of any word,
    // except before another number ("GAME60") or an ordinal ending ("GAME6th"). A name of letters only is split out only where
    // the capitals mark a word break ("GAMEVInews", "#GAMEVILeaks"): "gamevista" stays a word.
    const markers = opts.terms.filter((t) => t.s === 'context' && t.c === 'story').map((t) => normalize(t.t)).filter(Boolean);
    const joined = [...new Set(markers.map((m) => m.replace(/ /g, '')))].filter((w) => w.length >= 3).sort((a, b) => b.length - a.length);
    this.gameDigit = joined.filter((w) => /\p{N}/u.test(w));
    const letters = joined.filter((w) => !/\p{N}/u.test(w) && /^\p{L}+$/u.test(w));
    if (letters.length) this.gameLetterRe = new RegExp(letters.join('|'), 'giu');
    // "GAME 6s", "GAME VIs": the plural of a name written apart.
    for (const m of markers) {
      const toks = m.split(' ');
      if (toks.length < 2) continue;
      const key = `${toks[toks.length - 1]}s`;
      const list = this.gamePlural.get(key) ?? [];
      list.push(toks.slice(0, -1));
      this.gamePlural.set(key, list);
    }
    // A real person is never a rare made-up name and never matched loosely, whatever else the entry says.
    for (const t of opts.terms) if (opts.categories.has(t.c) || t.s === 'context') add(t.t, t.c, t.s, KIND_GROUP[kindOf(t)], t.o, t.p ? undefined : t.r, kindOf(t) === 'storyplace' && !t.o ? true : undefined, t.p ? undefined : t.f, t.s === 'context' ? undefined : t.p, t.s === 'weak' && !t.p && !t.r ? t.pg : undefined);
    const custom = (list: string[] | undefined, from: CustomFrom) => { for (const w of list ?? []) add(w, 'custom', 'strong', 'custom', undefined, undefined, undefined, undefined, undefined, undefined, from); };
    custom(opts.customWords, 'own');
    custom(opts.accountWords, 'account');
    custom(opts.blackoutWords, 'blackout');

    const notStory = new Set(NOT_STORY_HINTS.map((w) => tokenize(w).join(' ')));
    const hint = (tokens: string[], story: boolean) => {
      const bucket = this.hints.get(tokens[0]!);
      if (bucket) bucket.push(tokens);
      else this.hints.set(tokens[0]!, [tokens]);
      if (!story) return;
      const sb = this.storyHints.get(tokens[0]!);
      if (sb) sb.push(tokens);
      else this.storyHints.set(tokens[0]!, [tokens]);
    };
    // Story words for real people only: never hint words for other names.
    for (const raw of PERSON_STORY_WORDS) {
      const tokens = tokenize(raw);
      if (!tokens.length || this.storyHints.get(tokens[0]!)?.some((t) => t.join(' ') === tokens.join(' '))) continue;
      const sb = this.storyHints.get(tokens[0]!);
      if (sb) sb.push(tokens);
      else this.storyHints.set(tokens[0]!, [tokens]);
    }
    for (const [c, words] of Object.entries(SPOILER_WORDS) as [Category, readonly string[]][]) {
      // A leak word counts only next to a listed name (see inspect), never with the game alone: "GAME leaked gameplay" is news.
      if (c === 'leaks' || !opts.categories.has(c) || (c === 'trailers' && opts.allowTrailers)) continue;
      for (const raw of words) {
        const tokens = tokenize(raw);
        const bucket = this.spoilers.get(tokens[0]!);
        if (bucket) bucket.push({ tokens, c });
        else this.spoilers.set(tokens[0]!, [{ tokens, c }]);
      }
    }
    for (const raw of opts.hintWords ?? DEFAULT_HINTS) {
      const tokens = tokenize(raw);
      if (!tokens.length) continue;
      // With the leaks switch off, a leak word is no hint either.
      if (!this.leakOn && tokens.some((t) => LEAK_FORMS.test(t))) continue;
      // A word that says nothing about the story ("trailer") is not one for a real person, nor are its other forms.
      const story = !notStory.has(tokens.join(' '));
      hint(tokens, story);
      // "hate" also covers hates, hated, hating. Short words are left exact: "cap" must not match "caps".
      const w = tokens[0]!;
      if (tokens.length === 1 && w.length >= 4 && /^[a-z]+$/.test(w)) {
        const stem = w.endsWith('e') ? w.slice(0, -1) : w;
        for (const v of [`${w}s`, `${stem}ed`, `${stem}ing`, `${w}d`]) hint([v], story);
      }
    }
  }

  /** Long made-up words of names safe to match loosely, and every spelling of them with one letter taken out. */
  private fuzzVocab = new Set<string>();
  private fuzzIndex = new Map<string, Set<string>>();
  private fuzzMax = 0;
  private fuzzWord(w: string): void {
    if (this.fuzzVocab.has(w)) return;
    this.fuzzVocab.add(w);
    if (w.length > this.fuzzMax) this.fuzzMax = w.length;
    for (const k of [w, ...deletions(w)]) (this.fuzzIndex.get(k) ?? this.fuzzIndex.set(k, new Set()).get(k)!).add(w);
  }

  /** The one listed long made-up word `w` is a misspelling or plural of, or null. Only ever a word of a name safe to match loosely. */
  private fuzzy(w: string): string | null {
    // The page's word must be long too: short everyday words (share, grace) are never repaired into a name.
    // Longer than the longest listed word by more than one letter: nothing can be one edit away, and a huge word costs a lot to try.
    if (!this.fuzzVocab.size || w.length < FUZZ_MIN || w.length > this.fuzzMax + 1 || !/^\p{L}+$/u.test(w)) return null;
    // Pages repeat their words: each one is worked out once. Emptied now and then so a long session does not grow it without end.
    const known = this.fuzzSeen.get(w);
    if (known !== undefined) return known;
    if (this.fuzzSeen.size >= 20_000) this.fuzzSeen.clear();
    const out = this.fuzzyNew(w);
    this.fuzzSeen.set(w, out);
    return out;
  }

  private fuzzSeen = new Map<string, string | null>();
  private fuzzyNew(w: string): string | null {
    for (const stem of [w.endsWith('ies') ? `${w.slice(0, -3)}y` : '', w.endsWith('es') ? w.slice(0, -2) : '', w.endsWith('s') ? w.slice(0, -1) : '']) {
      if (stem && this.fuzzVocab.has(stem)) return stem;
    }
    const found = new Set<string>();
    for (const k of [w, ...deletions(w)]) for (const v of this.fuzzIndex.get(k) ?? []) if (oneEditApart(w, v)) found.add(v);
    return found.size === 1 ? [...found][0]! : null;
  }

  /** "Z*rblax": a word with stars in it, put back to the one listed long made-up word of that length and those letters. */
  private unstar(text: string): { text: string; words: Set<string> } {
    const words = new Set<string>();
    if (!this.fuzzVocab.size || !text.includes('*')) return { text, words };
    const plainWords = new Set(tokenize(text));
    const out = text.replace(/(?<![\p{L}*])[\p{L}*]*\*[\p{L}*]*/gu, (m) => {
      const low = m.toLowerCase();
      if (low.length < FUZZ_MIN || !/^\p{L}/u.test(low) || (low.match(/\p{L}/gu)?.length ?? 0) < 3) return m;
      const hits: string[] = [];
      for (const v of this.fuzzVocab) {
        if (v.length !== low.length) continue;
        let same = true;
        for (let i = 0; same && i < low.length; i++) same = low[i] === '*' || low[i] === v[i];
        if (same && hits.push(v) > 1) break; // two candidates already: no guess
      }
      if (hits.length !== 1) return m;
      // Written plainly elsewhere in the same text: that copy is an exact match and keeps its full strength.
      if (!plainWords.has(hits[0]!)) words.add(hits[0]!);
      return hits[0]!;
    });
    return { text: out, words };
  }

  private words(text: string): [string[], Set<string>] {
    const { text: t, words } = this.unstar(this.gameLetterRe ? text.replace(this.gameLetterRe, (m: string, at: number, s: string) => this.atCapitals(m, s[at - 1], s[at + m.length], s[at + m.length + 1])) : text);
    return [this.glued(tokenize(t)), words];
  }

  /**
   * A letters-only game name inside a longer word, split out only at a break the capitals show: an upper-case name after a
   * lower-case letter ("theGAMEVI"), and before a lower-case letter or a capitalised word ("GAMEVInews", "GAMEVILeaks").
   */
  private atCapitals(m: string, before = '', after = '', next = ''): string {
    const word = (c: string) => /[\p{L}\p{N}]/u.test(c);
    const up = (c: string) => !!c && c !== c.toLowerCase();
    const low = (c: string) => !!c && c !== c.toUpperCase();
    if (!up(m[0]!)) return m;
    const left = !word(before) || low(before);
    const right = !word(after) || (up(m[m.length - 1]!) && (low(after) || (up(after) && low(next))));
    return left && right && (word(before) || word(after)) ? ` ${m} ` : m;
  }

  /** The game's name with a number in it, split out of a longer word; "GAME 6s" read as the name. */
  private glued(tokens: string[]): string[] {
    if (!this.gameDigit.length && !this.gamePlural.size) return tokens;
    const out: string[] = [];
    for (const tok of tokens) {
      const prefixes = this.gamePlural.get(tok);
      const base = prefixes?.find((p) => p.length <= out.length && p.every((w, i) => out[out.length - p.length + i] === w));
      if (base) {
        out.push(tok.slice(0, -1));
        continue;
      }
      const m = this.gameDigit.find((g) => g !== tok && tok.includes(g));
      if (m) {
        const at = tok.indexOf(m);
        const before = tok.slice(0, at);
        const after = tok.slice(at + m.length);
        if (!/^\p{N}/u.test(after) && !/^(th|st|nd|rd)$/.test(after)) {
          if (before) out.push(before);
          out.push(m);
          if (after && after !== 's') out.push(after);
          continue;
        }
      }
      out.push(tok);
    }
    return out;
  }

  /** Light hides only names that block alone; the rules that judge a post as a whole are off. */
  get judgesPosts(): boolean {
    return this.strictness !== 'light';
  }

  /** True only if the text names the game itself: a listed name, an unusual name or a place in it does not count. */
  namesGame(text: string): boolean {
    return this.scan(...this.words(text)).game === true;
  }

  /**
   * The page's own words (title, heading, description, address) make it about the game: they name it, or hold a name that hides
   * alone or an unusual name. A place name alone does not: many are everyday words, a developer or a town.
   */
  marksPage(text: string): boolean {
    return this.scan(...this.words(text)).tied === true;
  }

  /** True if the text names the game or contains any strong term: the page is "about GTA 6". */
  hasContext(text: string): boolean {
    return this.scan(...this.words(text)).context;
  }

  /** What a text holds, without deciding anything. Lets a caller judge a whole post or page. */
  inspect(text: string): Found {
    const full = this.scan(...this.words(text));
    if (!text.includes('@')) return full;
    const bare = text.replace(MENTION, '$1 ');
    if (bare === text) return full;
    // A weak name (a first name, a partial, a weak character) inside an @mention is a person's account name, not the character (owner rule):
    // only the weak side is read again without the mentions. A strong name in a handle still covers, and the game's name in a handle still
    // marks the text as about the game.
    const g = this.scan(...this.words(bare));
    return { ...full, weak: g.weak, weakGroups: g.weakGroups, weakTerms: g.weakTerms, namePair: g.namePair, hinted: g.hinted, selfMarked: g.selfMarked, real: g.real, realGroups: g.realGroups, pageOnly: g.pageOnly, pageOnlyGroups: g.pageOnlyGroups };
  }

  /**
   * Returns null when the text should be left alone.
   * `about`: the page or the post around this text is about the game, so weak terms count at Medium.
   */
  match(text: string, about = false): MatchResult | null {
    return this.decide(this.inspect(text), about);
  }

  /**
   * `pageHasContext`: the page, or the post or thread around this text, is about the game. `onPage`: the page itself is, which is
   * the only thing that lets a name set to "Only when the page mentions GTA 6" count.
   */
  decide(found: Found, pageHasContext = false, onPage = false): MatchResult | null {
    const [hit, grp] = this.hitsAt(this.strictness, found, pageHasContext, onPage);
    if (!hit.size) return null;
    const custom = hit.has('custom');
    const categories = [...hit].filter((c): c is Category => c !== 'custom');
    // Strict covers it and Medium would not: the cover is there because of the level.
    const byStrict = this.strictness === 'strict' && !this.hitsAt('medium', found, pageHasContext, onPage)[0].size;
    return { categories, custom, groups: [...grp], ...(custom && found.customFrom?.size ? { customFrom: [...found.customFrom] } : {}), ...(byStrict ? { byStrict } : {}), ...(found.hits ? { hits: found.hits } : {}) };
  }

  /** What counts at a level: the hits and their kind groups. */
  private hitsAt(level: Strictness, found: Found, pageHasContext: boolean, onPage: boolean): [Set<Category | 'custom'>, Set<KindGroup | 'custom'>] {
    // Custom keywords are strong, so they always count on their own.
    let hit: Set<Category | 'custom'>;
    let grp: Set<KindGroup | 'custom'>;
    const sg = found.strongGroups ?? new Set<KindGroup | 'custom'>();
    const wg = found.weakGroups ?? new Set<KindGroup | 'custom'>();
    if (level === 'light') [hit, grp] = [found.strong, sg];
    else if (level === 'medium' && !(found.context || pageHasContext)) [hit, grp] = [found.strong, sg];
    else if (level === 'medium' && found.selfMarked && !pageHasContext) [hit, grp] = [new Set([...found.strong, ...found.selfMarked.weak]), new Set([...sg, ...found.selfMarked.groups])];
    else [hit, grp] = [new Set([...found.strong, ...found.weak]), new Set([...sg, ...wg])];

    // A real person counts only with a story word beside the name (scan) and only once the text or the page is tied to the game.
    // That holds on Strict too, where other weak names hide anywhere; on Light nothing weak hides.
    if (level !== 'light' && found.real?.size && (found.context || pageHasContext)) {
      hit = new Set([...hit, ...found.real]);
      grp = new Set([...grp, ...(found.realGroups ?? [])]);
    }

    if (level !== 'light' && onPage && found.pageOnly?.size) {
      hit = new Set([...hit, ...found.pageOnly]);
      grp = new Set([...grp, ...(found.pageOnlyGroups ?? [])]);
    }
    return [hit, grp];
  }

  /**
   * Undo the usual ways a word is disguised: stretched ("Trevorrrr"), written in digits ("Tr3vor"),
   * or spaced out ("T r e v o r"). A word is only changed when the result is a word from the list,
   * so ordinary text is left exactly as it was.
   */
  private repair(plain: string[], at: number[], looseAt: boolean[]): void {
    for (let i = 0; i < plain.length; i++) {
      const w = plain[i]!;
      if (w.length > 1) {
        if (this.vocab.has(w)) continue;
        const fixed = this.unstretch(w) ?? this.unleet(w);
        if (fixed) plain[i] = fixed;
        else {
          // Misspelt or plural: only into a long made-up word of a name safe to match loosely, and only one possible word.
          const loose = this.fuzzy(w);
          if (loose) {
            plain[i] = loose;
            looseAt[i] = true;
          }
        }
        continue;
      }
      // A run of single letters: join them, and accept the join only if it spells listed words end to end.
      // An initial may sit in front ("A. J o n e s"), so the spelled-out part can start anywhere in the run.
      let j = i;
      while (j < plain.length && j - i < 40 && plain[j]!.length === 1 && /\p{L}/u.test(plain[j]!)) j++;
      let done = false;
      for (let s = i; !done && j - s >= 3; s++) {
        for (let e = j; !done && e - s >= 3; e--) {
          const parts = this.split(plain.slice(s, e).join(''));
          if (!parts) continue;
          plain.splice(s, e - s, ...parts);
          at.splice(s, e - s, ...parts.map(() => at[s]!));
          looseAt.splice(s, e - s, ...parts.map(() => false));
          i = s + parts.length - 1;
          done = true;
        }
      }
      if (!done) i = Math.max(i, j - 1);
    }
  }

  private unstretch(w: string): string | null {
    if (!/(.)\1\1/u.test(w)) return null;
    for (const keep of ['$1$1', '$1']) {
      const c = w.replace(/(.)\1{2,}/gu, keep);
      if (this.vocab.has(c)) return c;
    }
    return null;
  }

  private unleet(w: string): string | null {
    if (!/\d/.test(w) || !/\p{L}/u.test(w)) return null;
    for (const one of ['i', 'l']) {
      const c = w.replace(/0/g, 'o').replace(/1/g, one).replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/8/g, 'b');
      if (this.vocab.has(c)) return c;
    }
    return null;
  }

  /** Cut a run of letters into listed words, longest first; null if it cannot be done exactly. */
  private split(letters: string): string[] | null {
    const out: string[] = [];
    for (let i = 0; i < letters.length; ) {
      let end = 0;
      for (let j = letters.length; j >= i + 3; j--) if (this.vocab.has(letters.slice(i, j))) { end = j; break; }
      if (!end) return null;
      out.push(letters.slice(i, end));
      i = end;
    }
    return out;
  }

  private scan(words: string[], starred: ReadonlySet<string> = new Set()): Found {
    const strong = new Set<Category | 'custom'>();
    const weak = new Set<Category | 'custom'>();
    const strongGroups = new Set<KindGroup | 'custom'>();
    const weakGroups = new Set<KindGroup | 'custom'>();
    const pageOnly = new Set<Category | 'custom'>();
    const pageOnlyGroups = new Set<KindGroup | 'custom'>();
    const weakNames = new Map<string, string[]>();
    // Where the weak names sit, leaving out everyday phrases: those need more than a hint word (Term.o).
    const weakAt: [from: number, to: number][] = [];
    // Rare made-up names found (by spelling), and what the other weak names hit, for a post whose only sign of the game is one of them.
    const rares = new Set<string>();
    const otherWeak = new Set<Category | 'custom'>();
    const otherGroups = new Set<KindGroup | 'custom'>();
    const hintAt: number[] = [];
    // Story words only (storyHints), and the real people found: where each sits and what it would hit.
    const storyAt: number[] = [];
    const realAt: { from: number; to: number; c: Category | 'custom'; g: KindGroup | 'custom' }[] = [];
    const spoil = new Set<Category>();
    const hits: string[] = [];
    let context = false;
    let game = false;
    let tied = false;
    const placesSeen = new Set<string>();
    const customFrom = new Set<CustomFrom>();
    const strongSeen = new Map<string, { tokens: string[] }>();
    // Where a name that hides alone made a mention, and which of those words also name the game, a place or an unusual name.
    const strongAt = new Set<number>();
    const sharedAt = new Set<number>();
    let mentions = 0;
    const mentioned = new Set<number>();
    const placeAt: [from: number, to: number][] = [];
    const everydayNames = new Set<string>();
    // Reaction emoji count as hint words but are not part of anyone's name: "First 💀 Last" is still "First Last".
    const plain: string[] = [];
    const at: number[] = [];
    words.forEach((w, i) => {
      if (EMOJI_TOKENS.has(w)) return;
      plain.push(w);
      at.push(i);
    });
    // Positions put back from a misspelling, plural or stars: a name found through one counts only with a game mention.
    // Kept beside the words, so joining spelled-out letters shifts these marks with them.
    const looseAt = plain.map((w) => starred.has(w));
    this.repair(plain, at, looseAt);
    const fuzzed = new Set<number>();
    looseAt.forEach((l, i) => { if (l) fuzzed.add(i); });
    for (let i = 0; i < words.length; i++) {
      // "no spoilers please" is no hint either: "spoiler" is also a hint word.
      if (this.hints.get(words[i]!)?.some((h) => hasSequence(words, i, h)) && !asksNoSpoilers(words, i, this.gameWords)) hintAt.push(i);
      if (this.storyHints.get(words[i]!)?.some((h) => hasSequence(words, i, h)) && !asksNoSpoilers(words, i, this.gameWords)) storyAt.push(i);
    }
    // Where the real people and the rare made-up names sit (in `plain`): a listed name inside one is a part of that name, not a name of its own.
    const ownerSpans: [from: number, to: number][] = [];
    for (let i = 0; i < plain.length; i++) {
      for (const e of this.index.get(plain[i]!) ?? []) if ((e.p || e.r) && e.s !== 'context' && hasSequence(plain, i, e.tokens)) ownerSpans.push([i, i + e.tokens.length]);
    }
    // Where every matched name sits (in `words`): a hint word inside any of them is part of that name and vouches for no other.
    const nameSpans: [from: number, to: number][] = [];
    for (let i = 0; i < plain.length; i++) {
      for (const s of this.spoilers.get(plain[i]!) ?? []) if (hasSequence(plain, i, s.tokens) && !asksNoSpoilers(plain, i, this.gameWords)) spoil.add(s.c);
      const bucket = this.index.get(plain[i]!);
      if (!bucket) continue;
      for (const e of bucket) {
        if (!hasSequence(plain, i, e.tokens)) continue;
        const span: [number, number] = [at[i]!, at[i + e.tokens.length - 1]! + 1];
        if (e.p && e.s !== 'context') {
          // A real person: never matched loosely, never a sign of the game, never part of the hint or two-names rules.
          if (!(fuzzed.size && e.tokens.some((_, k) => fuzzed.has(i + k)))) {
            realAt.push({ from: span[0], to: span[1], c: e.c, g: e.g });
            nameSpans.push(span);
          }
          continue;
        }
        // Inside a real person's or a rare made-up name (a shorter one, or any other). A marker and the user's own keywords are left as they are.
        if (e.s !== 'context' && e.c !== 'custom' && ownerSpans.some(([a, b]) => i >= a && i + e.tokens.length <= b && (b - a > e.tokens.length || !e.r))) continue;
        if (fuzzed.size && e.tokens.some((_, k) => fuzzed.has(i + k))) {
          // Loose: never everywhere, never a sign the text is about the game, never the post rules (hint word, two names).
          if (!e.f || e.s === 'context') continue;
          if (e.pg) {
            pageOnly.add(e.c);
            pageOnlyGroups.add(e.g);
            continue;
          }
          weak.add(e.c);
          weakGroups.add(e.g);
          continue;
        }
        nameSpans.push(span);
        if (e.place) placeAt.push([i, i + e.tokens.length]);
        if (DEBUG_WHY && this.debug) hits.push(`${e.s} ${e.c}: ${e.tokens.join(' ')}`);
        if (e.s === 'strong') {
          strong.add(e.c);
          strongGroups.add(e.g);
          if (e.from) customFrom.add(e.from);
          // A person's own word hides what holds it, but says nothing about whether the page is about the game.
          if (e.c !== 'custom') {
            context = true;
            tied = true;
            // Every time it is written counts; what one single name adds is taken back below (strongSeen).
            const key = (e.orig ?? e.tokens).join(' ');
            if (!mentioned.has(i)) {
              mentioned.add(i);
              mentions++;
              strongAt.add(i);
            }
            strongSeen.set(key, { tokens: e.orig ?? e.tokens });
          }
        } else if (e.s === 'context' && e.o && e.c !== 'story') {
          // A place whose name is an everyday word (flagged by the list): no sign of the game, for a post or a page.
        } else if (e.s === 'context') {
          context = true;
          if (e.c === 'story') game = true;
          if (e.c === 'story') tied = true;
          // The game's own name counts each time it is written; a place (or any other marker) once per name, so a store page
          // repeating a developer whose name is also a place on the list is not "about the game" by that alone.
          const key = (e.orig ?? e.tokens).join(' ');
          const once = e.c !== 'story';
          if (!mentioned.has(i) && !(once && placesSeen.has(key))) {
            mentioned.add(i);
            mentions++;
          } else if (strongAt.has(i) && !(once && placesSeen.has(key))) {
            // The same words also name the game or a place: that mention is not the strong name's alone (see below).
            sharedAt.add(i);
          }
          if (once) placesSeen.add(key);
        } else if (e.pg) {
          // Waits for a page about the game: no part of the post rules (game named beside it, hint word, two names).
          pageOnly.add(e.c);
          pageOnlyGroups.add(e.g);
        } else {
          weak.add(e.c);
          weakGroups.add(e.g);
          // Joined up: a name and its own hashtag are one name.
          weakNames.set(e.tokens.join(''), e.orig ?? e.tokens);
          if (e.o) everydayNames.add(e.tokens.join(''));
          if (!e.o) weakAt.push([at[i]!, at[i + e.tokens.length - 1]! + 1]);
          if (e.r) {
            rares.add(e.tokens.join(''));
            if (!mentioned.has(i)) {
              mentioned.add(i);
              mentions++;
            } else if (strongAt.has(i)) sharedAt.add(i);
          } else {
            otherWeak.add(e.c);
            otherGroups.add(e.g);
          }
        }
      }
    }
    // What happens at a story place: these words count only beside its name, so "great shot" alone is left alone.
    if (placeAt.length && this.storySwitchOn && plain.some((_, i) => placeAt.some(([from, to]) => (i < from ? from - i : i >= to ? i - (to - 1) : Infinity) <= HINT_REACH) && (this.placeEvents.get(plain[i]!) ?? []).some((t) => hasSequence(plain, i, t)))) {
      spoil.add('story');
      tied = true;
      context = true;
    }
    // One rare name marks the post but cannot vouch for itself; two different ones vouch for each other.
    const selfMarked = !context && rares.size === 1 ? { weak: otherWeak, groups: otherGroups } : undefined;
    if (rares.size) context = true;

    if (rares.size) tied = true;
    // A hint word inside the name itself (a mission called "Death at Sea") does not vouch for it.
    const outside = (h: number) => !nameSpans.some(([a, b]) => h >= a && h < b);
    const hintsOut = hintAt.filter(outside);
    const hinted = weakAt.some(([from, to]) => hintsOut.some((h) => (h < from || h >= to) && h >= from - HINT_REACH && h < to + HINT_REACH));
    // A leak word next to a listed name is a leak about it (the leaks switch); alone, beside the game only, it is news.
    if (this.leakOn && weakAt.some(([from, to]) => words.some((w, h) => LEAK_FORMS.test(w) && outside(h) && (h < from || h >= to) && h >= from - HINT_REACH && h < to + HINT_REACH))) spoil.add('leaks');
    // "Jane Smith" and "Jane" are one person: a name that is part of a longer name found here is not counted again.
    const names = [...weakNames.values()];
    const within = (a: string[], b: string[]) => a.length < b.length && b.some((_, at) => hasSequence(b, at, a) && a[0] === b[at]);
    const distinct = names.filter((a) => !names.some((b) => within(a, b)));
    // One name that hides alone, however often repeated (a store's side panel: "<name> Deluxe", "<name> Bundle"), is one mention for
    // the article judge, not one per time. A name inside a longer one is the same person (as for weak names).
    const strongNames = [...strongSeen.values()];
    const strongPeople = strongNames.filter((a) => !strongNames.some((b) => within(a.tokens, b.tokens)));
    // The person counts as one mention however often named; mentions shared with another marker stay.
    if (strongPeople.length === 1) mentions -= Math.max(0, [...strongAt].filter((p) => !sharedAt.has(p)).length - 1);
    const weakTerms = distinct.length;
    // "Michael and Jordan" is two people anywhere; a pair only points at the game when one name is less ordinary.
    // Everyday phrases can't make the pair: "the harvest near the bridge" points at nothing.
    const real = distinct.filter((n) => !everydayNames.has(n.join('')));
    const namePair = weakTerms >= 2 && real.some((n) => n.length > 1 || !COMMON_FIRST_NAMES.has(n[0]!));
    // A real person has a story word close by (outside the name itself): the same reach as the hint rule.
    const storyOut = storyAt.filter(outside);
    const realStory = realAt.filter(({ from, to }) => storyOut.some((h) => (h < from || h >= to) && h >= from - HINT_REACH && h < to + HINT_REACH));
    const realHit = new Set(realStory.map((r) => r.c));
    const realGroups = new Set(realStory.map((r) => r.g));
    return { ...(game ? { game } : {}), ...(tied ? { tied } : {}), ...(customFrom.size ? { customFrom } : {}), strong, weak, strongGroups, weakGroups, ...(pageOnly.size ? { pageOnly, pageOnlyGroups } : {}), context, ...(selfMarked ? { selfMarked } : {}), weakTerms, namePair, hinted, spoil, mentions, words: words.length, ...(realHit.size ? { real: realHit, realGroups } : {}), ...(DEBUG_WHY && this.debug ? { hits } : {}) };
  }
}

function hasSequence(words: string[], at: number, tokens: string[]): boolean {
  if (at + tokens.length > words.length) return false;
  for (let k = 1; k < tokens.length; k++) if (words[at + k] !== tokens[k]) return false;
  return true;
}

/** Words that turn "spoilers" into a request not to be spoiled: "no spoilers", "without any spoilers", "spoiler-free". */
// Not 'free' here: "free spoilers" offers them; only "spoiler free" (the word after) asks for none. Not 'want': "want spoilers?
// read on" offers them.
const NO_SPOILER_BEFORE = new Set(['no', 'non', 'without', 'avoid', 'avoiding', 'zero']);
/** Words that may sit between the request and "spoilers": "no major spoilers", "avoid late game spoilers". */
const NO_SPOILER_BETWEEN = new Set(['any', 'major', 'big', 'huge', 'real', 'plot', 'story', 'heavy', 'ending', 'endgame', 'late', 'early', 'game', 'more']);

/**
 * "spoiler"/"spoilers" at `i` asks for no spoilers ("no spoilers please", "spoiler free", "without any spoilers"), so it is no sign
 * that the post spoils. Other spoiler words ("dies", "ending") still count.
 */
function asksNoSpoilers(w: readonly string[], i: number, gameWords: ReadonlySet<string>): boolean {
  if (w[i] !== 'spoiler' && w[i] !== 'spoilers') return false;
  if (w[i + 1] === 'free') return true;
  // A few words back, but only across the game's name and words like "major": "no <game> spoilers please", "avoid late game
  // spoilers". Any other word ends the look: "no way, huge spoilers ahead" and "no joke, spoilers below" are spoiler talk.
  // The game's name may be long ("grand theft auto vi"), so its words do not count towards the three words allowed.
  let between = 0;
  for (let j = i - 1; j >= 0 && j >= i - 10; j--) {
    const b = w[j]!;
    if (NO_SPOILER_BEFORE.has(b)) return true;
    if (gameWords.has(b)) continue;
    if (!NO_SPOILER_BETWEEN.has(b) || ++between > 3) return false;
  }
  return false;
}

/** How each category reads on a label ("Hidden: character spoiler", not "characters spoiler"). */
const LABEL_WORD: Record<Category, string> = { story: 'story', characters: 'character', map: 'place', gameplay: 'gameplay', leaks: 'leak', trailers: 'trailer' };

/** "Hidden: story spoiler". Names the category, never the matched word. */
export function labelFor(result: MatchResult): string {
  const [only, ...rest] = result.categories;
  if (rest.length || (only && result.custom)) return 'Hidden: spoilers';
  if (only) return `Hidden: ${LABEL_WORD[only] ?? only} spoiler`;
  return result.custom ? 'Hidden: your word' : 'Hidden: spoiler';
}
