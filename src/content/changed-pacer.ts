/**
 * Changed text read again at most once per window (0.1.15 changed text, review of 9ced370): a clock or a ticker the page rewrites every frame
 * was read on every frame (a scan and a layout read each time, where base left it waiting) and held a backlog up to 0.75 s. A node read less
 * than `everyMs` ago is held, never dropped: it is handed back once its window ends (the last change inside the window is read then), so a
 * name written into a ticking clock is read within `everyMs`.
 */
export const CHANGED_READ_MS = 250;

export class ChangedPacer {
  private last = new WeakMap<Node, number>();
  private due = new Map<Node, number>();
  constructor(private everyMs = CHANGED_READ_MS) {}

  /** `n` changed at `now`: true when it may be read now; false when it was read inside the window (held until its window ends, see takeDue). */
  admit(n: Node, now: number): boolean {
    const l = this.last.get(n);
    if (l === undefined || now - l >= this.everyMs) return true;
    if (!this.due.has(n)) this.due.set(n, l + this.everyMs);
    return false;
  }

  /** `n` was read at `now`: its window starts again. */
  read(n: Node, now: number): void {
    this.last.set(n, now);
    this.due.delete(n);
  }

  /** The held nodes whose window has ended by `now`, each handed back once. */
  takeDue(now: number): Node[] {
    const out: Node[] = [];
    for (const [n, at] of this.due) if (at <= now) out.push(n);
    for (const n of out) this.due.delete(n);
    return out;
  }

  /** When the next held node is due (undefined: none is held). */
  next(): number | undefined {
    let min: number | undefined;
    for (const at of this.due.values()) if (min === undefined || at < min) min = at;
    return min;
  }

  /** Held nodes. */
  get held(): number {
    return this.due.size;
  }

  clear(): void {
    this.last = new WeakMap();
    this.due.clear();
  }
}

/** The matcher's view of a text (see Matcher.inspect), only what mightMatch looks at. */
export interface Inspected {
  strong: Set<unknown>;
  weak: Set<unknown>;
  context: boolean;
  game?: boolean;
  tied?: boolean;
  spoil: Set<unknown>;
  hinted: boolean;
  weakTerms: number;
  namePair: boolean;
  real?: Set<unknown>;
  pageOnly?: Set<unknown>;
  selfMarked?: { weak: Set<unknown> };
  customFrom?: Set<unknown>;
}

/**
 * The last verdict per changed text's key (content.ts: the texts judged, and could they match). At most `cap` keys, the oldest dropped
 * first: a key is a page's element, kept alive while here (review B of badee39f: kept per start in a WeakMap, its heap grew across
 * restarts). Emptied when the scanner stops.
 */
export class JudgeCache {
  private map = new Map<Node, [string, boolean]>();
  constructor(readonly cap = 500) {}
  get size(): number {
    return this.map.size;
  }
  /** The verdict kept for `key` when it was judged on exactly `texts`. */
  get(key: Node, texts: string): boolean | undefined {
    const v = this.map.get(key);
    return v && v[0] === texts ? v[1] : undefined;
  }
  set(key: Node, texts: string, could: boolean): void {
    this.map.delete(key);
    if (this.map.size >= this.cap) this.map.delete(this.map.keys().next().value!);
    this.map.set(key, [texts, could]);
  }
  clear(): void {
    this.map.clear();
  }
}

/**
 * A text with its runs of ASCII white space made one space, for comparing texts judged (content.ts). Only ASCII: JS \s also holds
 * U+FEFF, which the matcher deletes inside a word (review C of e8468104: 'Zorb<U+FEFF>lax Quux' made 'Zorb lax Quux' could not match;
 * read, it is covered). The matcher reads every other character as it does on the page.
 */
export function oneSpace(text: string): string {
  return text.replace(/[ \t\n\r\f]+/g, ' ').trim();
}

/** Texts longer than this are not looked at: counted as could match. */
export const MIGHT_MAX = 2000;

/**
 * Could a changed text match anything (a list term, weak or strong, the game's name, a custom word)? Asked only for a change the pacer
 * would hold: what could is read at once (review 1 of d62f5a06: a name written into a line read 5-200 ms before was held to the window's
 * end, 3-15 frames on screen; base reads it in the callback). Pacing is for tickers and clocks, whose text holds no name.
 */
export function mightMatch(text: string, inspect: (t: string) => Inspected, split?: (t: string) => string): boolean {
  if (text.length > MIGHT_MAX) return true;
  if (could(inspect(text))) return true;
  // The forms the scanner also reads: a glued name split ("ZorblaxQuux"), underscores as spaces.
  const s = split?.(text);
  return s !== undefined && s !== text && could(inspect(s));
}

function could(f: Inspected): boolean {
  return f.strong.size > 0 || f.weak.size > 0 || f.context || !!f.game || !!f.tied || f.spoil.size > 0 || f.hinted || f.weakTerms > 0 || f.namePair
    || !!f.real?.size || !!f.pageOnly?.size || !!f.selfMarked?.weak.size || !!f.customFrom?.size;
}

/** Inline elements: a changed text inside one is read with the line around it. */
const INLINE = new Set(['SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'SMALL', 'MARK', 'CODE', 'ABBR', 'LABEL', 'S', 'U', 'SUB', 'SUP', 'TIME', 'FONT', 'Q', 'CITE', 'DFN', 'KBD', 'SAMP', 'VAR', 'BDI', 'BDO', 'DATA', 'INS', 'DEL']);

/**
 * The line a changed text is read in: its nearest element that is not inline (review rv12 of 40224450: 'Quux' changed in
 * 'said <span>Zorblax</span> <span>Quux</span>' cannot match alone, the line can; judged alone it was held, 115-118 frames on screen).
 */
export function lineOf(n: Node): Node {
  let e = n.nodeType === 1 ? (n as Element) : n.parentElement;
  if (!e) return n;
  while (INLINE.has(e.tagName) && e.parentElement && e.parentElement !== e.ownerDocument.body) e = e.parentElement;
  return e;
}

/**
 * What a change is paced by: its parent when the parent has fewer than `maxElements` elements inside (a text replaced every frame, or a
 * small element swapped in every frame, is a new node every frame: by node it was read every frame), else the node itself.
 */
export function pacingKey(n: Node, maxElements: number): Node {
  const p = n.parentElement;
  return p && !p.getElementsByTagName('*')[maxElements] ? p : n;
}
