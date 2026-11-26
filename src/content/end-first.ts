// 0.1.15: the end of a big page first. A page's nodes are read in the order they came from the parse (src/entrypoints/content.ts), so on a
// big page (the saved Google results page: about 5,500 nodes) the text at its END (the last paragraph, the footer) was read, and covered,
// only 3 to 10 s after load. When the parse is done (DOMContentLoaded, and again on load) this looks for texts to read AHEAD of that
// backlog: what is on screen, the footer landmarks, then the last texts of the body, walking back from its end. Only a node still WAITING in
// the backlog is moved ahead (the text itself or the nearest waiting node around it): the reads are the same as before, in another order.
// Nothing is skipped (a first fix that skipped reads lost covers) and nothing already read is read again (reading again what was read
// changed which pictures got a cover on some pages: review of the first version of this). Collecting is resumable and timed.

/** idle: nothing to collect; collecting: walking back from the end of the body, a few ms a step; done: the cap reached or the walk ended. */
export type EndFirstState = 'idle' | 'collecting' | 'done';
/** start: the parse is done (DOMContentLoaded or load); budget: a step ran out of time; finished: cap or start of the body reached; stop. */
export type EndFirstEvent = 'start' | 'budget' | 'finished' | 'stop';
/** Every allowed move; a pair not listed is refused (the state stays). */
export const END_FIRST_STEPS: Record<EndFirstState, Partial<Record<EndFirstEvent, EndFirstState>>> = {
  idle: { start: 'collecting', stop: 'idle' },
  // A second start (load after DOMContentLoaded) walks again from the new end of the body.
  collecting: { start: 'collecting', budget: 'collecting', finished: 'done', stop: 'idle' },
  done: { start: 'collecting', stop: 'idle' },
};
export const endFirstNext = (s: EndFirstState, e: EndFirstEvent): EndFirstState => END_FIRST_STEPS[s][e] ?? s;

/**
 * At most this many nodes are moved ahead per start. Few: a node moved from the middle of the page waits behind every one moved before it,
 * where the backlog would have reached it sooner (the saved Bing page sent in pieces: a result card moved 145th, 0.5 s later than base).
 */
export const END_FIRST_CAP = 60;
/** Collecting work per step, in milliseconds (the reads are timed by the pass that does them). */
export const END_FIRST_STEP_MS = 2;
/**
 * The biggest waiting node moved for an on-screen text, in elements (0.1.15 second step). The saved Reddit thread's rails wait inside a node of
 * thousands of elements, left in its turn for 11 s: the biggest waiting part under this size moves instead, and the bigger whole keeps its
 * turn (moved too, wholes of about 65 ms each held what the backlog reads first, a Fandom nav label, 0.8 s later than base). A part over
 * BIG_READ takes turns with the backlog (src/entrypoints/content.ts): read first, the saved Reddit thread's own left nav held mid-page posts
 * 0.6 s later than base.
 */
export const CLAIM_MAX = 600;
/** ...for a text found from the end: smaller (60), so each such read stays short and the backlog's own reads are not held up. */
export const CLAIM_MAX_END = 60;
/** A moved node holding more elements than this is read in a pass of its own (src/entrypoints/content.ts), so no other read adds to it. */
export const BIG_READ = 300;
/** Texts looked at per start, at most (a page whose end is long read needs no more looking). */
const MAX_LOOK = 4000;
const SKIP = 'script, style, noscript, template, .gsb-bar, .gsb-tip, .gsb-sr';
const LANDMARKS = 'footer, [role="contentinfo"], #fbar';
/** Footer landmarks looked at, the last ones of the page first, and their texts at most (a page with a <footer> in every post: review of f8941c5). */
const LANDMARKS_MAX = 8, LANDMARK_TEXTS = 50;
/** On-screen look by position: points on a grid over the window (the topmost element under each: fixed and sticky layers included), and the texts looked at under each. */
const GRID_X = 6, GRID_Y = 12, TEXTS_PER_POINT = 2;
/** ...and a row along each edge of the window, where fixed headers and footers sit. */
const EDGE_PX = 8;
/** The first look hands out this many on-screen parts, then END_BATCH parts from the end, then the rest (see step). */
const SCREEN_FIRST = 12, END_BATCH = 24;

/**
 * The node to read ahead for text `t`: the OUTERMOST of `t` and its ancestors that waits in the backlog (`waiting`) and holds at most `max`
 * elements, taken out of it (`take`). A bigger waiting node around it keeps its turn and is read whole then (a part read before its whole:
 * the whole's read comes after and judges everything in it again). Null when none waits (already read: not read again). Only that one node
 * leaves the backlog: what is inside or around it keeps its own place.
 */
export function claimFor(t: Node, stopAt: Node, waiting: (n: Node) => boolean, take: (n: Node) => void, max = CLAIM_MAX): Node | null {
  let out: Node | null = null;
  for (let x: Node | null = t; x && x !== stopAt; x = x.parentNode) {
    if (!waiting(x)) continue;
    // More than `max` elements (looked up by index: no counting past it): this one and every one above it are bigger.
    if (x.nodeType === 1 && (x as Element).getElementsByTagName('*')[max]) break;
    out = x;
  }
  if (out) take(out);
  return out;
}

export class EndFirst {
  state: EndFirstState = 'idle';
  private walker: TreeWalker | null = null;
  private looked = new Set<Node>();
  private picked = 0;
  private visits = 0;
  private first = false;
  private screenOnly = false;
  /** The first look's on-screen parts after the first SCREEN_FIRST: handed out after the first END_BATCH from the end. */
  private later: Node[] | null = null;
  private endLeft = 0;

  /** `claim` turns a text into the node to read ahead (see claimFor), or null. */
  constructor(private doc: Document, private claim: (t: Node, onScreen: boolean) => Node | null, private o: { cap?: number; stepMs?: number; now?: () => number; onScreen?: boolean } = {}) {}

  private move(e: EndFirstEvent) { this.state = endFirstNext(this.state, e); }

  /** The parse is done: walk again from the end of the body. `screenOnly` (the page was scrolled): what is on screen now, nothing more. */
  start(screenOnly = false): void {
    const body = this.doc.body;
    if (!body) return;
    this.move('start');
    this.screenOnly = screenOnly;
    this.picked = 0;
    this.visits = 0;
    this.first = true;
    this.looked = new Set();
    this.walker = this.doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */);
    let last: Node = body;
    while (last.lastChild) last = last.lastChild;
    this.walker.currentNode = last;
  }

  /** Stops; `out` first gets the parts held back (taken from the backlog: a look stopped after a step threw must not lose them). */
  stop(out?: (n: Node, first: boolean) => void): void {
    if (out) this.release(out);
    this.move('stop');
    this.end();
  }

  /** The walk is over: what it held is let go (soak of f097e56: about 1200 page nodes kept alive per page until the next start). */
  private end() {
    this.walker = null;
    this.looked = new Set();
    this.later = null;
  }

  /** Nodes held between steps (texts looked at, on-screen parts held back): none once the walk is over. */
  get held(): number {
    return this.looked.size + (this.later?.length ?? 0);
  }

  /** Looks at text `t` once: a text of the page's own (not script, style or our labels) that waits is handed to `out`. */
  private look(t: Node, out: (n: Node) => void, onScreen = false): boolean {
    if (this.picked >= (this.o.cap ?? END_FIRST_CAP) || this.looked.has(t)) return false;
    this.looked.add(t);
    this.visits++;
    if (!/\S/.test(t.nodeValue ?? '') || t.parentElement?.closest(SKIP)) return false;
    const n = this.claim(t, onScreen);
    if (!n) return false;
    this.picked++;
    out(n);
    return true;
  }

  /** The texts of `e`, the first `most` of them. */
  private textsIn(e: Element, most: number, out: (n: Node) => void, onScreen = false) {
    const w = this.doc.createTreeWalker(e, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = w.nextNode(), k = 0; n && k < most; n = w.nextNode(), k++) this.look(n, out, onScreen);
  }

  /** What is on screen now: the texts under each grid point. */
  private onScreen(out: (n: Node) => void) {
    const d = this.doc;
    const v = d.defaultView;
    if (this.o.onScreen === false || !v || typeof d.elementFromPoint !== 'function') return;
    const ys = [EDGE_PX, ...Array.from({ length: GRID_Y }, (_, y) => ((y + 0.5) * v.innerHeight) / GRID_Y), v.innerHeight - EDGE_PX];
    for (const py of ys) for (let x = 0; x < GRID_X; x++) {
      const e = d.elementFromPoint(((x + 0.5) * v.innerWidth) / GRID_X, py);
      // The same element under several points is looked at once (looked keeps its texts).
      if (e && e !== d.body && e !== d.documentElement) this.textsIn(e, TEXTS_PER_POINT, out, true);
    }
  }

  /**
   * Collects for up to the step's time, handing each node to `out`, in the order to read them; `first` marks what is read before the backlog
   * itself (what is on screen and the first parts from the end), the rest takes turns with the backlog (src/entrypoints/content.ts).
   */
  step(out: (n: Node, first: boolean) => void): void {
    if (this.state !== 'collecting' || !this.walker) return;
    const now = this.o.now ?? (() => performance.now());
    const t0 = now();
    const cap = this.o.cap ?? END_FIRST_CAP;
    // Order of the first look (0.1.15 review): the first SCREEN_FIRST on-screen parts, then END_BATCH parts from the end (the footers and the
    // last texts: the Google end paragraph waited 1.1 s behind all the on-screen reads), then the other on-screen parts; all of these first.
    // Then the rest from the end, taking turns with the backlog.
    const emit = (n: Node) => {
      out(n, !!this.later);
      if (this.later && --this.endLeft <= 0) this.release(out);
    };
    if (this.first) {
      this.first = false;
      const screen: Node[] = [];
      try {
        this.onScreen((n) => screen.push(n));
      } catch (e) {
        // A look that throws partway: the parts it took already are held, for stop() to hand back (review Q1 of f55b2db0).
        this.later = screen;
        throw e;
      }
      if (this.screenOnly) {
        for (const n of screen) out(n, true);
        this.end();
        return this.move('finished');
      }
      for (const n of screen.splice(0, SCREEN_FIRST)) out(n, true);
      this.later = screen;
      this.endLeft = END_BATCH;
      // The footers, the last ones first, a few texts in all, within the step's time.
      const marks = [...(this.doc.body?.querySelectorAll(LANDMARKS) ?? [])].slice(-LANDMARKS_MAX).reverse();
      let left = LANDMARK_TEXTS;
      for (const e of marks) {
        const w = this.doc.createTreeWalker(e, 4 /* NodeFilter.SHOW_TEXT */);
        for (let t = w.nextNode(); t && left > 0; t = w.nextNode(), left--) this.look(t, emit);
        // The last footer is always looked at; the others while the step has time.
        if (left <= 0 || now() - t0 > (this.o.stepMs ?? END_FIRST_STEP_MS)) break;
      }
    }
    // The deepest last node may be a text itself: it counts too.
    let n: Node | null = this.walker.currentNode;
    let k = 0;
    while (n && this.picked < cap && this.visits < MAX_LOOK) {
      if (n.nodeType === 3) this.look(n, emit);
      n = this.walker.previousNode();
      if (++k % 16 === 0 && now() - t0 > (this.o.stepMs ?? END_FIRST_STEP_MS)) {
        if (n) {
          this.release(out);
          return this.move('budget');
        }
        break;
      }
    }
    this.release(out);
    this.end();
    this.move('finished');
  }

  /** Hands out what the first look held back: the other on-screen parts. */
  private release(out: (n: Node, first: boolean) => void) {
    const l = this.later;
    if (!l) return;
    this.later = null;
    for (const n of l) out(n, true);
  }
}
