import { KIND_GROUP, kindOf, type Category, type KindGroup, type Strength, type Strictness, type Term } from '../types';
import { COMMON_FIRST_NAMES, DEFAULT_HINTS, HINT_REACH, REACTION_EMOJI, SPOILER_WORDS } from './hints';

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
  /** Words that make a nearby weak term count (see hints.ts). Defaults to the built-in list. */
  hintWords?: string[];
}

/** What a match reveals: categories only, never the term itself. */
export interface MatchResult {
  categories: Category[];
  custom: boolean;
  /** The kind groups of the hits (People, Missions...), for the popup's counts. Never the words. */
  groups?: (KindGroup | 'custom')[];
}

export interface Found {
  strong: Set<Category | 'custom'>;
  weak: Set<Category | 'custom'>;
  /** The kind groups of the strong and weak hits. */
  strongGroups?: Set<KindGroup | 'custom'>;
  weakGroups?: Set<KindGroup | 'custom'>;
  /** The text names the game, holds a strong term, or holds a rare made-up name (Term.r), which marks a post as about the game. */
  context: boolean;
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
}

// Letters from other alphabets that are drawn the same as Latin ones. Swapping one in is a common way
// to slip a word past a filter; to a reader the word is unchanged.
const TWINS: Record<string, string> = {
  '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0445': 'x', '\u0443': 'y', '\u0456': 'i', '\u0458': 'j', '\u0455': 's',
  '\u0410': 'A', '\u0412': 'B', '\u0415': 'E', '\u041a': 'K', '\u041c': 'M', '\u041d': 'H', '\u041e': 'O', '\u0420': 'P', '\u0421': 'C', '\u0422': 'T', '\u0425': 'X',
  '\u03bf': 'o', '\u03b1': 'a', '\u03bd': 'v', '\u03c1': 'p', '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u039a': 'K', '\u039c': 'M', '\u039d': 'N', '\u039f': 'O', '\u03a1': 'P', '\u03a4': 'T',
};
const TWIN_RE = new RegExp(`[${Object.keys(TWINS).join('')}]`, 'g');
const EMOJI_TOKENS = new Set(Object.values(REACTION_EMOJI));

export function normalize(text: string): string {
  return text
    // Characters that take up no room on screen but would split a word in two.
    .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '')
    .replace(TWIN_RE, (m) => TWINS[m]!)
    .replace(/\u00df/g, 'ss')
    .replace(EMOJI_RE, (m) => ` ${REACTION_EMOJI[m]} `)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
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
  /** first token -> spoiler words starting with it, each with the category switch that controls it */
  private spoilers = new Map<string, { tokens: string[]; c: Category }[]>();
  /** Every word that appears in any list entry: mangled words are only ever repaired into one of these. */
  private vocab = new Set<string>();
  private strictness: Strictness;

  constructor(opts: MatcherOptions) {
    this.strictness = opts.strictness;
    const allow = new Set(opts.allowWords.map(normalize).filter(Boolean));

    const add = (raw: string, c: Category | 'custom', s: Strength, g: KindGroup | 'custom', o?: true, r?: true) => {
      const norm = normalize(raw);
      if (!norm || allow.has(norm)) return;
      const tokens = norm.split(' ');
      const put = (toks: string[]) => {
        for (const tok of toks) this.vocab.add(tok);
        const k = toks[0]!;
        const entry: Compiled = { tokens: toks, c, s, g, ...(o ? { o } : {}), ...(r ? { r } : {}) };
        const bucket = this.index.get(k);
        if (bucket) bucket.push(entry);
        else this.index.set(k, [entry]);
      };
      put(tokens);
      // Names are also written run together, most often as hashtags: "#gamename", "#firstnamelastname".
      // A one- or two-letter result ("a b") is too short to mean anything.
      if (tokens.length >= 2 && tokens.length <= 4 && tokens.join('').length >= 3) put([tokens.join('')]);
    };

    for (const t of opts.terms) if (opts.categories.has(t.c)) add(t.t, t.c, t.s, KIND_GROUP[kindOf(t)], t.o, t.r);
    for (const w of opts.customWords) add(w, 'custom', 'strong', 'custom');

    const hint = (tokens: string[]) => {
      const bucket = this.hints.get(tokens[0]!);
      if (bucket) bucket.push(tokens);
      else this.hints.set(tokens[0]!, [tokens]);
    };
    for (const [c, words] of Object.entries(SPOILER_WORDS) as [Category, readonly string[]][]) {
      if (!opts.categories.has(c)) continue;
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
      hint(tokens);
      // "hate" also covers hates, hated, hating. Short words are left exact: "cap" must not match "caps".
      const w = tokens[0]!;
      if (tokens.length === 1 && w.length >= 4 && /^[a-z]+$/.test(w)) {
        const stem = w.endsWith('e') ? w.slice(0, -1) : w;
        for (const v of [`${w}s`, `${stem}ed`, `${stem}ing`, `${w}d`]) hint([v]);
      }
    }
  }

  /** Light hides only names that block alone; the rules that judge a post as a whole are off. */
  get judgesPosts(): boolean {
    return this.strictness !== 'light';
  }

  /** True if the text names the game or contains any strong term: the page is "about GTA 6". */
  hasContext(text: string): boolean {
    return this.scan(tokenize(text)).context;
  }

  /** What a text holds, without deciding anything. Lets a caller judge a whole post or page. */
  inspect(text: string): Found {
    return this.scan(tokenize(text));
  }

  /**
   * Returns null when the text should be left alone.
   * `about`: the page or the post around this text is about the game, so weak terms count at Medium.
   */
  match(text: string, about = false): MatchResult | null {
    return this.decide(this.scan(tokenize(text)), about);
  }

  decide(found: Found, pageHasContext = false): MatchResult | null {

    // Custom keywords are strong, so they always count on their own.
    let hit: Set<Category | 'custom'>;
    let grp: Set<KindGroup | 'custom'>;
    const sg = found.strongGroups ?? new Set<KindGroup | 'custom'>();
    const wg = found.weakGroups ?? new Set<KindGroup | 'custom'>();
    if (this.strictness === 'light') [hit, grp] = [found.strong, sg];
    else if (this.strictness === 'medium' && !(found.context || pageHasContext)) [hit, grp] = [found.strong, sg];
    else if (this.strictness === 'medium' && found.selfMarked && !pageHasContext) [hit, grp] = [new Set([...found.strong, ...found.selfMarked.weak]), new Set([...sg, ...found.selfMarked.groups])];
    else [hit, grp] = [new Set([...found.strong, ...found.weak]), new Set([...sg, ...wg])];

    if (!hit.size) return null;
    const custom = hit.has('custom');
    const categories = [...hit].filter((c): c is Category => c !== 'custom');
    return { categories, custom, groups: [...grp] };
  }

  /**
   * Undo the usual ways a word is disguised: stretched ("Trevorrrr"), written in digits ("Tr3vor"),
   * or spaced out ("T r e v o r"). A word is only changed when the result is a word from the list,
   * so ordinary text is left exactly as it was.
   */
  private repair(plain: string[], at: number[]): void {
    for (let i = 0; i < plain.length; i++) {
      const w = plain[i]!;
      if (w.length > 1) {
        if (this.vocab.has(w)) continue;
        const fixed = this.unstretch(w) ?? this.unleet(w);
        if (fixed) plain[i] = fixed;
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

  private scan(words: string[]): Found {
    const strong = new Set<Category | 'custom'>();
    const weak = new Set<Category | 'custom'>();
    const strongGroups = new Set<KindGroup | 'custom'>();
    const weakGroups = new Set<KindGroup | 'custom'>();
    const weakNames = new Map<string, string[]>();
    // Where the weak names sit, leaving out everyday phrases: those need more than a hint word (Term.o).
    const weakAt: [from: number, to: number][] = [];
    // Rare made-up names found (by spelling), and what the other weak names hit, for a post whose only sign of the game is one of them.
    const rares = new Set<string>();
    const otherWeak = new Set<Category | 'custom'>();
    const otherGroups = new Set<KindGroup | 'custom'>();
    const hintAt: number[] = [];
    const spoil = new Set<Category>();
    let context = false;
    let mentions = 0;
    // Reaction emoji count as hint words but are not part of anyone's name: "First 💀 Last" is still "First Last".
    const plain: string[] = [];
    const at: number[] = [];
    words.forEach((w, i) => {
      if (EMOJI_TOKENS.has(w)) return;
      plain.push(w);
      at.push(i);
    });
    this.repair(plain, at);
    for (let i = 0; i < words.length; i++) {
      // "no spoilers please" is no hint either: "spoiler" is also a hint word.
      if (this.hints.get(words[i]!)?.some((h) => hasSequence(words, i, h)) && !asksNoSpoilers(words, i)) hintAt.push(i);
    }
    for (let i = 0; i < plain.length; i++) {
      for (const s of this.spoilers.get(plain[i]!) ?? []) if (hasSequence(plain, i, s.tokens) && !asksNoSpoilers(plain, i)) spoil.add(s.c);
      const bucket = this.index.get(plain[i]!);
      if (!bucket) continue;
      for (const e of bucket) {
        if (!hasSequence(plain, i, e.tokens)) continue;
        if (e.s === 'strong') {
          strong.add(e.c);
          strongGroups.add(e.g);
          context = true;
          mentions++;
        } else if (e.s === 'context') {
          context = true;
          mentions++;
        } else {
          weak.add(e.c);
          weakGroups.add(e.g);
          weakNames.set(e.tokens.join(' '), e.tokens);
          if (!e.o) weakAt.push([at[i]!, at[i + e.tokens.length - 1]! + 1]);
          if (e.r) {
            rares.add(e.tokens.join(''));
            mentions++;
          } else {
            otherWeak.add(e.c);
            otherGroups.add(e.g);
          }
        }
      }
    }
    // One rare name marks the post but cannot vouch for itself; two different ones vouch for each other.
    const selfMarked = !context && rares.size === 1 ? { weak: otherWeak, groups: otherGroups } : undefined;
    if (rares.size) context = true;
    // A hint word inside the name itself (a mission called "Death at Sea") does not vouch for it.
    const hinted = weakAt.some(([from, to]) => hintAt.some((h) => (h < from || h >= to) && h >= from - HINT_REACH && h < to + HINT_REACH));
    // "Jane Smith" and "Jane" are one person: a name that is part of a longer name found here is not counted again.
    const names = [...weakNames.values()];
    const within = (a: string[], b: string[]) => a.length < b.length && b.some((_, at) => hasSequence(b, at, a) && a[0] === b[at]);
    const distinct = names.filter((a) => !names.some((b) => within(a, b)));
    const weakTerms = distinct.length;
    // "Michael and Jordan" is two people anywhere; a pair only points at the game when one name is less ordinary.
    const namePair = weakTerms >= 2 && distinct.some((n) => n.length > 1 || !COMMON_FIRST_NAMES.has(n[0]!));
    return { strong, weak, strongGroups, weakGroups, context, ...(selfMarked ? { selfMarked } : {}), weakTerms, namePair, hinted, spoil, mentions, words: words.length };
  }
}

function hasSequence(words: string[], at: number, tokens: string[]): boolean {
  if (at + tokens.length > words.length) return false;
  for (let k = 1; k < tokens.length; k++) if (words[at + k] !== tokens[k]) return false;
  return true;
}

/** Words that turn "spoilers" into a request not to be spoiled: "no spoilers", "without any spoilers", "spoiler-free". */
// Not 'free' here: "free spoilers" offers them; only "spoiler free" (the word after) asks for none.
const NO_SPOILER_BEFORE = new Set(['no', 'without', 'avoid', 'avoiding', 'zero']);
const NO_SPOILER_BETWEEN = new Set(['major', 'big', 'real', 'any', 'plot', 'story', 'heavy', 'ending', 'endgame']);

/**
 * "spoiler"/"spoilers" at `i` asks for no spoilers ("no spoilers please", "spoiler free", "without any spoilers"), so it is no sign
 * that the post spoils (2026-10-29: such a post on a page about the game was hidden). Other spoiler words ("dies", "ending") still count.
 */
function asksNoSpoilers(w: readonly string[], i: number): boolean {
  if (w[i] !== 'spoiler' && w[i] !== 'spoilers') return false;
  if (w[i + 1] === 'free') return true;
  if (NO_SPOILER_BEFORE.has(w[i - 1] ?? '')) return true;
  return NO_SPOILER_BETWEEN.has(w[i - 1] ?? '') && NO_SPOILER_BEFORE.has(w[i - 2] ?? '');
}

/** How each category reads on a label ("Hidden: character spoiler", not "characters spoiler"). */
const LABEL_WORD: Record<Category, string> = { story: 'story', characters: 'character', map: 'place', gameplay: 'gameplay', leaks: 'leak', trailers: 'trailer' };

/** "Hidden: story spoiler". Names the category, never the matched word. */
export function labelFor(result: MatchResult): string {
  const [only, ...rest] = result.categories;
  if (rest.length || (only && result.custom)) return 'Hidden: spoilers';
  if (only) return `Hidden: ${LABEL_WORD[only] ?? only} spoiler`;
  return result.custom ? 'Hidden: blocked keyword' : 'Hidden: spoiler';
}
