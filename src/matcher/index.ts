import { KIND_GROUP, kindOf, type Category, type KindGroup, type Strength, type Strictness, type Term } from '../types';
import { COMMON_FIRST_NAMES, DEFAULT_HINTS, HINT_REACH, REACTION_EMOJI, SPOILER_WORDS, PLACE_EVENT_WORDS } from './hints';

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
  /** "Let official trailer content through": trailer words no longer make a post a spoiler. */
  allowTrailers?: boolean;
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
  /** A story place: words about what happens there count beside it. */
  place?: true;
  /** Safe to match loosely (Term.f): misspelt, plural or star-censored spellings of its long words still match, with a mention only. */
  f?: true;
}

/** Words of this length or more in a name marked safe (Term.f) are matched loosely; shorter ones never. Same as the job's FUZZ_MIN. */
const FUZZ_MIN = 6;
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
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Chinese, Japanese, Korean and Thai are written without spaces: where the text switches between them and Latin letters
    // or digits, that is a word break ("今日Velmorreが" holds the name; audit 2026-11-03).
    .replace(SCRIPT_CHANGE, '$1 ')
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
  private placeEvents = new Map<string, string[][]>();
  private storySwitchOn: boolean;
  /** Every word that appears in any list entry: mangled words are only ever repaired into one of these. */
  private vocab = new Set<string>();
  /** The words of the game's own name (story markers): "no <game> spoilers" can reach past them. */
  private gameWords = new Set<string>();
  private strictness: Strictness;

  constructor(opts: MatcherOptions) {
    this.strictness = opts.strictness;
    this.storySwitchOn = opts.categories.has('story');
    for (const w of PLACE_EVENT_WORDS) {
      const tokens = normalize(w).split(' ');
      const bucket = this.placeEvents.get(tokens[0]!);
      if (bucket) bucket.push(tokens);
      else this.placeEvents.set(tokens[0]!, [tokens]);
    }
    const allow = new Set(opts.allowWords.map(normalize).filter(Boolean));

    const add = (raw: string, c: Category | 'custom', s: Strength, g: KindGroup | 'custom', o?: true, r?: true, place?: true, f?: true) => {
      const norm = normalize(raw);
      if (!norm || allow.has(norm)) return;
      const tokens = norm.split(' ');
      const put = (toks: string[]) => {
        for (const tok of toks) this.vocab.add(tok);
        const k = toks[0]!;
        const entry: Compiled = { tokens: toks, c, s, g, ...(o ? { o } : {}), ...(r ? { r } : {}), ...(place ? { place } : {}), ...(f ? { f } : {}) };
        const bucket = this.index.get(k);
        if (bucket) bucket.push(entry);
        else this.index.set(k, [entry]);
      };
      put(tokens);
      if (f) for (const tok of tokens) if (tok.length >= FUZZ_MIN && /^\p{L}+$/u.test(tok)) this.fuzzWord(tok);
      // Names are also written run together, most often as hashtags: "#gamename", "#firstnamelastname".
      // A one- or two-letter result ("a b") is too short to mean anything.
      if (tokens.length >= 2 && tokens.length <= 4 && tokens.join('').length >= 3) put([tokens.join('')]);
    };

    // A marker only says a text is about the game and never hides on its own: it stays even when its group is set to never
    // hide, or switching off one group would stop every other group's names from hiding on pages about the game.
    for (const t of opts.terms) if (t.s === 'context' && t.c === 'story') for (const w of normalize(t.t).split(' ')) if (w) this.gameWords.add(w);
    for (const t of opts.terms) if (opts.categories.has(t.c) || t.s === 'context') add(t.t, t.c, t.s, KIND_GROUP[kindOf(t)], t.o, t.r, kindOf(t) === 'storyplace' && !t.o ? true : undefined, t.f);
    for (const w of opts.customWords) add(w, 'custom', 'strong', 'custom');

    const hint = (tokens: string[]) => {
      const bucket = this.hints.get(tokens[0]!);
      if (bucket) bucket.push(tokens);
      else this.hints.set(tokens[0]!, [tokens]);
    };
    for (const [c, words] of Object.entries(SPOILER_WORDS) as [Category, readonly string[]][]) {
      if (!opts.categories.has(c) || (c === 'trailers' && opts.allowTrailers)) continue;
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

  /** Long made-up words of names safe to match loosely, and every spelling of them with one letter taken out. */
  private fuzzVocab = new Set<string>();
  private fuzzIndex = new Map<string, Set<string>>();
  private fuzzWord(w: string): void {
    if (this.fuzzVocab.has(w)) return;
    this.fuzzVocab.add(w);
    for (const k of [w, ...deletions(w)]) (this.fuzzIndex.get(k) ?? this.fuzzIndex.set(k, new Set()).get(k)!).add(w);
  }

  /** The one listed long made-up word `w` is a misspelling or plural of, or null. Only ever a word of a name safe to match loosely. */
  private fuzzy(w: string): string | null {
    // The page's word must be long too: short everyday words (share, grace) are never repaired into a name (2026-11-04).
    if (!this.fuzzVocab.size || w.length < FUZZ_MIN || !/^\p{L}+$/u.test(w)) return null;
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
    const out = text.replace(/[\p{L}*]*\*[\p{L}*]*/gu, (m) => {
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
    const { text: t, words } = this.unstar(text);
    return [tokenize(t), words];
  }

  /** Light hides only names that block alone; the rules that judge a post as a whole are off. */
  get judgesPosts(): boolean {
    return this.strictness !== 'light';
  }

  /** True if the text names the game or contains any strong term: the page is "about GTA 6". */
  hasContext(text: string): boolean {
    return this.scan(...this.words(text)).context;
  }

  /** What a text holds, without deciding anything. Lets a caller judge a whole post or page. */
  inspect(text: string): Found {
    return this.scan(...this.words(text));
  }

  /**
   * Returns null when the text should be left alone.
   * `about`: the page or the post around this text is about the game, so weak terms count at Medium.
   */
  match(text: string, about = false): MatchResult | null {
    return this.decide(this.scan(...this.words(text)), about);
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
    const placeAt: number[] = [];
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
    }
    for (let i = 0; i < plain.length; i++) {
      for (const s of this.spoilers.get(plain[i]!) ?? []) if (hasSequence(plain, i, s.tokens) && !asksNoSpoilers(plain, i, this.gameWords)) spoil.add(s.c);
      const bucket = this.index.get(plain[i]!);
      if (!bucket) continue;
      for (const e of bucket) {
        if (!hasSequence(plain, i, e.tokens)) continue;
        if (fuzzed.size && e.tokens.some((_, k) => fuzzed.has(i + k))) {
          // Loose: never everywhere, never a sign the text is about the game, never the post rules (hint word, two names).
          if (!e.f || e.s === 'context') continue;
          weak.add(e.c);
          weakGroups.add(e.g);
          continue;
        }
        if (e.place) placeAt.push(i);
        if (e.s === 'strong') {
          strong.add(e.c);
          strongGroups.add(e.g);
          // A person's own word hides what holds it, but says nothing about whether the page is about the game.
          if (e.c !== 'custom') {
            context = true;
            mentions++;
          }
        } else if (e.s === 'context') {
          context = true;
          mentions++;
        } else {
          weak.add(e.c);
          weakGroups.add(e.g);
          // Joined up: a name and its own hashtag are one name.
          weakNames.set(e.tokens.join(''), e.tokens);
          if (e.o) everydayNames.add(e.tokens.join(''));
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
    // What happens at a story place: these words count only beside its name, so "great shot" alone is left alone.
    if (placeAt.length && this.storySwitchOn && plain.some((_, i) => placeAt.some((p) => Math.abs(p - i) <= HINT_REACH) && (this.placeEvents.get(plain[i]!) ?? []).some((t) => hasSequence(plain, i, t)))) {
      spoil.add('story');
      context = true;
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
    // Everyday phrases can't make the pair: "the harvest near the bridge" points at nothing.
    const real = distinct.filter((n) => !everydayNames.has(n.join('')));
    const namePair = weakTerms >= 2 && real.some((n) => n.length > 1 || !COMMON_FIRST_NAMES.has(n[0]!));
    return { strong, weak, strongGroups, weakGroups, context, ...(selfMarked ? { selfMarked } : {}), weakTerms, namePair, hinted, spoil, mentions, words: words.length };
  }
}

function hasSequence(words: string[], at: number, tokens: string[]): boolean {
  if (at + tokens.length > words.length) return false;
  for (let k = 1; k < tokens.length; k++) if (words[at + k] !== tokens[k]) return false;
  return true;
}

/** Words that turn "spoilers" into a request not to be spoiled: "no spoilers", "without any spoilers", "spoiler-free". */
// Not 'free' here: "free spoilers" offers them; only "spoiler free" (the word after) asks for none. Not 'want': "want spoilers?
// read on" offers them (audit 2026-11-03).
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
