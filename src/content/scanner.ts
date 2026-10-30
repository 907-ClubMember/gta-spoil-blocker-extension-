import { ACCOUNT_HOST, accountKey } from '../accounts';
import { addKeys, keysFor, type HideKey, type HiddenTally } from '../hidden';
import { Matcher, labelFor, type Found, type MatchResult } from '../matcher';
import type { BlurStrength, HideMode, RevealMode } from '../settings';

const POST_SELECTOR = 'article, [role="article"], li';
/** A post/card longer than this is probably a whole article page, so hide just the matching paragraph. */
const MAX_POST_CHARS = 1500;
const THREAD_HEADING = 'h1, h2, h3, [role="heading"]';
const BLOCK_SELECTOR = 'article, [role="article"], li, p, h1, h2, h3, h4, h5, h6, blockquote, td, dd, figure';
/** Blocks that can hold a whole article's worth of other content, so they are hidden only when short. */
const BIG_BLOCK_SELECTOR = 'article, [role="article"], li, td, dd';
const SMALL_BOX_SELECTOR = 'div, section, aside, tr, dl';
/** Smallest units whose text is read as one piece, so a name split by bold or link markup is still caught. */
const JOIN_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, a, blockquote, td, dd, figcaption';
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'CODE', 'PRE', 'SVG']);
/** The nearest enclosing blocks whose heading can name the game for what sits under it. */
const SECTION_SELECTOR = 'section, article, aside, [role="region"], li, [role="listitem"]';
const HEADING_SELECTOR = 'h1, h2, h3, h4, [role="heading"]';
const HEADING_BLOCKS = 3;
const HEADING_READ_CHARS = 300;
/** A block longer than this, or holding more blocks than this, is a page wrapper and not a section. */
const SECTION_MAX_CHARS = 6000;
const SECTION_MAX_BLOCKS = 40;
const STYLE_ID = 'gsb-style';
const HIDDEN = '[data-gsb], [data-gsb-revealed], .gsb-bar';

/**
 * What is covered when something is hidden in `mode`. Normally the element itself. A comment hidden
 * "own content only" (data-gsb-own) instead covers each of its children except the way down to its
 * replies: the wrappers on that way carry data-gsb-in=<mode> and cover their other children in turn,
 * and a reply or reply area carries data-gsb-in="keep". Anything unmarked stays covered, so content
 * that arrives late inside the comment is hidden without any script having to notice it.
 */
export const COVERS = (mode: HideMode): string =>
  `[data-gsb="${mode}"]:not([data-gsb-own]),[data-gsb="${mode}"][data-gsb-own]>:not([data-gsb-in],.gsb-bar),[data-gsb-in="${mode}"]>:not([data-gsb-in],.gsb-bar),[data-gsb-under="${mode}"]`;

const BLUR_CSS: Record<BlurStrength, string> = {
  light: 'filter:blur(6px)',
  medium: 'filter:blur(14px)',
  heavy: 'filter:blur(32px)',
  solid: 'filter:brightness(0)', // a plain dark box: nothing of the content shows through
};

/** The page's stylesheet for covers. Several equal attributes in the peek rule outrank every cover rule above it. */
export const cssFor = (blur: BlurStrength = 'medium'): string => `
${COVERS('blur')}{${BLUR_CSS[blur]}!important;user-select:none!important;pointer-events:none!important}
${COVERS('collapse')},${COVERS('remove')}{display:none!important}
.gsb-bar{all:initial;display:block;flex:none;align-self:flex-start;min-width:max-content;position:relative;z-index:1;box-sizing:border-box;margin:12px 0 2px;padding:6px 10px;font:600 13px/1.3 system-ui,sans-serif;
 color:#1f2937;background:#fde68a;border:1px solid #d97706;border-radius:6px;cursor:pointer;text-align:left;user-select:none}
.gsb-bar:hover{background:#fcd34d}
.gsb-bar[data-gsb-line]{margin:2px 0;padding:2px 8px;font-size:11px;font-weight:500;opacity:.8}
[data-gsb-peek][data-gsb-peek][data-gsb-peek][data-gsb-peek],[data-gsb-peek][data-gsb-peek][data-gsb-peek][data-gsb-peek] *{filter:none!important;pointer-events:auto!important}
`;
export const CSS = cssFor('medium');

export interface ScanOptions {
  hideMode: HideMode;
  /** How strongly a cover blurs. 'medium' unless set. */
  blur?: BlurStrength;
  /** The label says what kind of thing is hidden. On unless switched off. */
  showReason?: boolean;
  /** How a cover is lifted. 'click' unless set. */
  revealMode?: RevealMode;
  /** Selector for page parts the user switched off: nothing inside them is read or hidden. */
  offParts?: string | null;
  /** Pause video that would play by itself, and mute audio, on pages about the game. */
  pauseVideo?: boolean;
  muteAudio?: boolean;
  /** Blur pictures and video only; text is never covered. */
  thumbsOnly?: boolean;
  /** Items the user lifted a cover from, kept across rescans (a restart after a settings change) when given. */
  keepRevealed?: WeakSet<Element>;
  hideImages: boolean;
  /** Hide picture-or-clip-only site posts on pages about the game. On unless switched off. */
  hideMediaPosts?: boolean;
  /**
   * Blur big pictures and video that sit next to the game's name: 'page' on pages about the game,
   * 'post' also beside a caption, link or post that names it on any page. 'page' unless set.
   */
  mediaNearGame?: 'off' | 'page' | 'post';
  /** Site adapter selector for one post/card (see src/adapters). */
  containers?: string;
  /** Site adapter selector for regions hidden whole, even when they hold smaller cards. */
  panels?: string;
  /** Messages are a flat list (a chat): a game mention also covers the messages just after it. */
  chat?: boolean;
  /** Hiding a comment hides the replies nested under it too. On unless switched off. */
  hideReplies?: boolean;
  /** Site adapter selector for comments that hold their replies (see src/adapters). */
  threads?: string;
  /** Site adapter selector for the areas and buttons inside a thread that belong to its replies. */
  replyAreas?: string;
  /**
   * Site adapter selector for the main post of a thread page, on sites where replies are not nested
   * but follow it as separate posts. Replies then answer it, and are covered with it when it is hidden.
   */
  main?: string;
  /** Pattern whose first group names the thread an address belongs to; `main` counts only where it matches. */
  threadKey?: RegExp;
  /** Spoiler accounts (src/accounts.ts keys): a post holding a link to one is hidden whole, whatever it says. */
  accounts?: ReadonlySet<string>;
  /** Site adapter rule for the page's own post (a watch page): see src/adapters `ownPage`. */
  ownPage?: { owner: string; parts?: string; page: string };
}

/** The rule that hid something: a name that blocks alone, or a weak name qualified in one of these ways. */
export type Why = 'alone' | 'mention' | 'page' | 'two-names' | 'hint' | 'reply' | 'chat' | 'spoiler-word' | 'media' | 'near-game' | 'heading' | 'account';

/** A site post with fewer words than this beside its picture or video is treated as media only. */
const MEDIA_ONLY_WORDS = 10;
const BIG_MEDIA_PX = 150;

/** How much of a post or page is read when judging what it is about. */
const POST_READ_CHARS = 4000;
const PAGE_READ_CHARS = 20_000;
/** A chat message counts as part of the talk started by a game mention this many messages back. */
const CHAT_REACH = 8;

/** Hides spoilers inside `root`. Holds no copy of the matched text. */
export class Scanner {
  private hidden = new Map<Element, HTMLElement | null>(); // element -> its label bar
  private revealed: WeakSet<Element>;
  /**
   * A label over something that takes up no room (a collapsed panel's rows) is a stray yellow bar.
   * Each label follows the size of what it hides: shown while that has a size, tucked away while it does not.
   */
  private sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
    for (const e of entries) {
      const bar = this.hidden.get(e.target);
      if (bar) bar.style.display = e.contentRect.width === 0 && e.contentRect.height === 0 ? 'none' : '';
    }
  });
  private pageContext = false;
  /** The page's own verdict, and the one told by the top page when this is a frame inside it. */
  private ownContext = false;
  private outerContext = false;
  /** Per block: how many headings it held last time, and which of them name the game. */
  private headings = new WeakMap<Element, { n: number; pass: number; ok: boolean; naming: Element[] }>();
  private pass = 0;
  /** Set while a block is re-read because its heading turned up late: texts are looked at again even if unchanged. */
  private forceJoin = false;
  /** Joined-text length last checked per block, so an unchanged block is not matched twice. */
  private joined = new WeakMap<Element, number>();
  /** Per post: whether it is about the game, and the text length that answer was based on. */
  private about = new WeakMap<Element, { len: number; why: Why | null }>();
  /** Posts holding a weak term that nothing has qualified yet; re-checked if a game mention arrives later. */
  private waiting = new WeakSet<Element>();
  /** Per post: text length at which the "game plus spoiler word" rule was last tried. */
  private spoilTried = new WeakMap<Element, number>();
  private bodyAbout = false;
  private bodyCheckedAt = 0;
  /** Per comment hidden "own content only": the elements marked on the way down to its replies. */
  private marks = new Map<Element, Set<Element>>();
  /** Comments that could not be opened up safely (loose text beside the replies); they stay hidden whole. */
  private whole = new WeakSet<Element>();
  private rescanning = new WeakSet<Element>();
  /** The main post of a flat thread page, looked up once per scan pass. */
  private mc: { n: number; el: Element | null; key: string | null; names?: boolean; namesPass: number } | null = null;
  /** The main post's block in its list, and the list: the replies are the blocks after it. */
  private anchor: { cell: Element; parent: Element | null } | null = null;
  /** Blocks of that list known to be in the run after the main post, and known to be outside it. */
  private run = new WeakSet<Element>();
  private out = new WeakSet<Element>();
  /** The thread whose replies are covered now, so replies arriving after the main post is unmounted are still covered. */
  private coverKey: string | null = null;
  /** Threads whose main post the user showed: it is not hidden or covered again on them. */
  private revealedThreads = new Set<string>();

  constructor(
    private doc: Document,
    private matcher: Matcher,
    private opts: ScanOptions,
  ) {
    if (!doc.getElementById(STYLE_ID)) {
      const st = doc.createElement('style');
      st.id = STYLE_ID;
      (doc.head ?? doc.documentElement).append(st);
    }
    // Always rewritten, so a restart with a new blur strength takes effect.
    const style = doc.getElementById(STYLE_ID);
    if (style) style.textContent = cssFor(opts.blur);
    this.revealed = opts.keepRevealed ?? new WeakSet();
  }

  get count(): number {
    return this.hidden.size;
  }

  /** Why-kinds of each hidden item, for the popup's counts. Group names only, never the matched words. */
  private hideKeys = new WeakMap<Element, HideKey[]>();

  /** How many hidden items fall under each group (an item can count under more than one). */
  get groups(): HiddenTally {
    const t: HiddenTally = {};
    for (const el of this.hidden.keys()) addKeys(t, this.hideKeys.get(el) ?? []);
    return t;
  }

  /**
   * The page judge: is the whole page about the game? Read from what the page says about itself
   * (title, heading, description, address) and, on ordinary sites, from the article text.
   */
  refreshPageContext(): boolean {
    const d = this.doc;
    const meta = (sel: string) => d.querySelector(sel)?.getAttribute('content') ?? '';
    let address = '';
    try {
      address = decodeURIComponent(`${d.location?.pathname ?? ''} ${d.location?.search ?? ''}`);
    } catch {
      /* a malformed address says nothing */
    }
    const self = [d.title, d.querySelector('h1')?.textContent, meta('meta[name="description"]'), meta('meta[property="og:title"]'), meta('meta[property="og:description"]'), address].join(' ');
    this.ownContext = this.matcher.hasContext(self) || this.articleAbout();
    this.pageContext = this.ownContext || this.outerContext;
    return this.pageContext;
  }

  /**
   * The page this frame sits in (the top page) is, or is not, about the game. A frame cannot read it
   * across origins, so it is told. When that turns the frame's own answer to yes, the frame is read again.
   */
  setOuterContext(about: boolean): void {
    this.outerContext = about;
    const was = this.pageContext;
    this.pageContext = this.ownContext || about;
    if (!was && this.pageContext && this.doc.body) this.scan(this.doc.body);
  }

  /**
   * What a block's headings say, cached. A block that is a page wrapper (very long, or holding many
   * blocks of its own) is not a section and marks nothing. The heading count is re-read at most once per scan pass.
   */
  private blockHeadings(block: Element): { n: number; pass: number; ok: boolean; naming: Element[] } {
    let e = this.headings.get(block);
    if (e && (e.pass === this.pass || !e.ok)) return e;
    const heads = block.querySelectorAll(HEADING_SELECTOR);
    if (e && e.n === heads.length) {
      e.pass = this.pass;
      return e;
    }
    const ok = (block.textContent?.length ?? 0) <= SECTION_MAX_CHARS && block.querySelectorAll(SECTION_SELECTOR).length <= SECTION_MAX_BLOCKS;
    const naming: Element[] = [];
    // A heading marks only the block it is the own heading of, not the blocks around that one.
    for (let i = 0; ok && i < heads.length && i < 40; i++) {
      const h = heads[i]!;
      if (h.closest(SECTION_SELECTOR) === block && this.matcher.hasContext(this.textOf(h, HEADING_READ_CHARS))) naming.push(h);
    }
    e = { n: heads.length, pass: this.pass, ok, naming };
    this.headings.set(block, e);
    return e;
  }

  /**
   * A heading that names the game marks the section under it. True if `el` sits in one of its nearest
   * blocks after such a heading. Only asked when the text holds a weak name.
   */
  private headingAbout(el: Element): boolean {
    let block = el.closest(SECTION_SELECTOR);
    for (let depth = 0; block && depth < HEADING_BLOCKS; depth++, block = block.parentElement?.closest(SECTION_SELECTOR) ?? null) {
      for (const h of this.blockHeadings(block).naming) {
        // Only content after the heading, and not the heading itself.
        if (h.isConnected && h !== el && !h.contains(el) && h.compareDocumentPosition(el) & 4 /* FOLLOWING */) return true;
      }
    }
    return false;
  }

  /** A weak name under a heading that names the game: hide it. Only at Medium and Strict, on a page not about the game as a whole. */
  private headingHide(parent: Element, found: Found, at: Element): boolean {
    if (!found.weak.size || this.pageContext || !this.matcher.judgesPosts || !this.headingAbout(parent)) return false;
    const res = this.matcher.decide(found, true);
    if (!res) return false;
    this.hide(this.containerFor(parent), res, 'heading', at);
    return true;
  }

  /** A heading naming the game has turned up: what is already under it is read again, once. */
  private headingArrived(parent: Element): void {
    const block = parent.closest(SECTION_SELECTOR);
    if (!block || this.rescanning.has(block)) return;
    this.headings.delete(block);
    this.rescanning.add(block);
    const before = this.forceJoin;
    this.forceJoin = true;
    try {
      this.scan(block);
    } finally {
      this.forceJoin = before;
      this.rescanning.delete(block);
    }
  }

  /**
   * An article that keeps naming the game is about it even if its headline does not say so.
   * Not used on sites with a post rule: there the "main" area is a feed of unrelated posts.
   */
  private articleAbout(): boolean {
    if (this.bodyAbout || this.opts.containers) return this.bodyAbout;
    const now = Date.now();
    if (now - this.bodyCheckedAt < 1500) return false;
    this.bodyCheckedAt = now;
    const main = this.doc.querySelector('article, main, [role="main"]') ?? this.doc.body;
    const f = this.matcher.inspect(main ? this.textOf(main, PAGE_READ_CHARS) : '');
    // Several mentions, and often enough that it is the subject and not one story among many.
    this.bodyAbout = f.mentions >= 3 && f.mentions * 400 >= f.words;
    return this.bodyAbout;
  }

  scan(root: Node): void {
    this.pass++;
    this.rejudge(root);
    if (this.opts.main) {
      this.syncCover(root);
      this.coverNew(root);
    }
    if (root.nodeType === 3) {
      this.checkText(root as Text);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && this.flagged) {
      // A rescan of the whole page reaches replies no single added node announced: look under every hidden thread.
      if (root === this.doc.body) for (const h of [...this.hidden.keys()]) if (h.matches(this.opts.threads!)) this.openAll(h);
      this.adopt(root as Element);
    }
    if (this.opts.accounts?.size) this.checkLinks(root as Element | Document | DocumentFragment);
    const walker = this.doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) this.checkText(n as Text);
    if (this.opts.hideImages && root.nodeType === 1) {
      const el = root as Element;
      if (el.matches('img, video')) this.checkMedia(el);
      el.querySelectorAll('img, video').forEach((m) => this.checkMedia(m));
    } else if (this.opts.hideImages) {
      (root as ParentNode).querySelectorAll?.('img, video').forEach((m) => this.checkMedia(m));
    }
  }

  private checkText(node: Text): void {
    const text = node.nodeValue;
    const parent = node.parentElement;
    if (!text || !parent) return;
    // Loose text right beside a hidden comment's replies cannot be covered on its own: hide the comment whole.
    if (this.marks.size && text.trim() && (parent.hasAttribute('data-gsb-own') || this.onPath(parent))) {
      const h = parent.closest('[data-gsb][data-gsb-own]');
      if (h) this.widen(h);
      return;
    }
    if (this.skip(parent)) return;
    // "GTA" and "6" in separate tags are each too short to match. Still read the block once.
    if (text.trim().length < 3) {
      this.checkJoined(parent);
      return;
    }
    const found = this.matcher.inspect(text);
    if (this.opts.thumbsOnly) {
      // Pictures only: words are never covered, but the game's name still marks the pictures beside it.
      if (found.context && this.opts.hideImages && this.opts.mediaNearGame === 'post') {
        (this.cardFor(parent) ?? parent.closest('figure, a'))?.querySelectorAll('img, video').forEach((m) => this.nearGame(m));
      }
      return;
    }
    const res = this.matcher.decide(found, this.pageContext);
    if (res) {
      this.hide(this.containerFor(parent), res, found.strong.size ? 'alone' : found.context ? 'mention' : 'page', parent);
      return;
    }
    if (found.context && !this.pageContext && this.matcher.judgesPosts && parent.closest(HEADING_SELECTOR)) this.headingArrived(parent);
    if (this.headingHide(parent, found, parent)) return;
    // The game's name has just turned up: pictures beside it that were looked at earlier are looked at again.
    if (found.context && this.opts.hideImages && this.opts.mediaNearGame === 'post') {
      (this.cardFor(parent) ?? parent.closest('figure, a'))?.querySelectorAll('img, video').forEach((m) => this.nearGame(m));
    }
    if ((found.spoil.size || found.context) && this.spoilerPost(parent)) return;
    if (!this.pageContext && this.judgePost(parent, found)) return;
    this.checkJoined(parent);
  }

  /**
   * A post that names the game and holds a spoiler word ("GAME all endings explained") is hidden
   * even with no listed name in it. On a page about the game, the page itself names the game.
   * Triggered by either half arriving; the whole post is then read once.
   */
  private spoilerPost(el: Element): boolean {
    if (!this.matcher.judgesPosts) return false;
    const post = this.containerFor(el);
    const cards = this.opts.containers;
    // A site post is judged on its own words: the replies nested inside it are posts in their own right.
    const own = cards && post.matches(cards) ? this.ownText(post, cards) : this.textOf(post, POST_READ_CHARS);
    const text = `${own} ${this.unseenText(post)}`;
    if (this.spoilTried.get(post) === text.length) return false;
    this.spoilTried.set(post, text.length);
    const f = this.matcher.inspect(text);
    if (!f.spoil.size || !(f.context || this.pageContext || this.repliesToMention(post))) return false;
    this.hide(post, { categories: [...f.spoil], custom: false }, 'spoiler-word', el);
    return true;
  }

  /**
   * Words a post carries without showing them: picture and video descriptions, and the hashtags
   * and searches its links point at (a link to /hashtag/GTA6 names the game even when drawn as an icon).
   */
  private unseenText(post: Element): string {
    let out = '';
    const els = post.querySelectorAll('img[alt], [aria-label], a[href*="hashtag"], a[href*="/search"], a[href*="/tag/"]');
    const cards = this.opts.containers;
    const nested = !!cards && post.matches(cards) && !!post.querySelector(cards);
    for (let i = 0; i < els.length && i < 60 && out.length < 1500; i++) {
      const el = els[i]!;
      if (isEmote(el) || this.isOff(el)) continue;
      // Leave out what belongs to a reply nested inside this post.
      if (nested && el.closest(cards!) !== post) continue;
      out += ` ${el.getAttribute('alt') ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
      const href = el.tagName === 'A' ? el.getAttribute('href') : null;
      if (href) out += ` ${safe(href).replace(/[/?&=#_+-]+/g, ' ')}`;
    }
    return out;
  }

  /**
   * The post judge. The page is not about the game, but this text holds a weak term or a game
   * mention: read the post around it as a whole. Returns true if the post was hidden.
   */
  private judgePost(el: Element, found: Found): boolean {
    const pending = this.matcher.decide(found, true);
    if (!pending && !found.context) return false;
    const post = this.containerFor(el);
    if (pending) {
      const why = this.postAbout(post);
      if (why) {
        this.hide(post, pending, why, el);
        return true;
      }
      this.waiting.add(post);
      return false;
    }
    // A game mention with no name in it: it may complete a post whose name arrived first.
    if (this.waiting.has(post) && !this.rescanning.has(post)) {
      this.waiting.delete(post);
      this.about.delete(post);
      // Replies under it were judged before the game was named: their "no" no longer stands.
      const cards = this.opts.containers;
      if (cards) post.querySelectorAll(cards).forEach((r) => (this.about.delete(r), this.spoilTried.delete(r)));
      // A post too long to be read whole can put itself back on the waiting list during this rescan;
      // without the guard its game mention would start the rescan again, without end.
      this.rescanning.add(post);
      try {
        this.scan(post);
      } finally {
        this.rescanning.delete(post);
      }
      return post.hasAttribute('data-gsb');
    }
    // A reply that names the game also settles the comment it answers, if that was waiting on a name.
    const threads = this.opts.threads;
    const up = threads && this.opts.containers ? post.parentElement?.closest(this.opts.containers) : null;
    if (up && threads && up.matches(threads) && this.waiting.has(up)) {
      const res = this.matcher.decide(this.matcher.inspect(this.ownText(up, this.opts.containers!)), true);
      if (res) {
        this.waiting.delete(up);
        this.hide(up, res, 'mention');
      }
    }
    return false;
  }

  /** Why this post counts as being about the game, or null if it does not. */
  private postAbout(post: Element): Why | null {
    // A comment holds the replies under it. It is judged on its own words, or two names spread over
    // a whole reply chain would count as two names in one post.
    const cards = this.opts.containers;
    const own = cards && post.matches(cards) ? this.ownText(post, cards) : this.textOf(post, POST_READ_CHARS);
    const text = `${own} ${this.unseenText(post)}`;
    const known = this.about.get(post);
    if (known && known.len === text.length) return known.why;
    const f = this.matcher.inspect(text);
    // It names the game itself, or is a post on a known site that holds two different names from the
    // list or a name beside a hint word ("the mission with X", "i hate X").
    // Neither is enough in ordinary prose: any biography is full of first names next to "loved" and "died".
    const sitePost = !!this.opts.containers && post.matches(this.opts.containers);
    // A post whose only sign of the game is one rare made-up name, with no other name, does not vouch for that name.
    const lone = !!f.selfMarked && !f.selfMarked.weak.size;
    const why: Why | null = f.strong.size ? 'alone'
      : f.context && !lone ? 'mention'
      : sitePost && f.namePair ? 'two-names'
      : sitePost && f.hinted ? 'hint'
      : this.repliesToMention(post) ? 'reply'
      : this.opts.chat && this.followsMention(post) ? 'chat'
      : null;
    this.about.set(post, { len: text.length, why });
    return why;
  }

  /** A reply or comment sits inside the post it answers: does any enclosing post name the game in its own words? */
  private repliesToMention(post: Element): boolean {
    const sel = this.opts.containers ?? POST_SELECTOR;
    let up = post.parentElement?.closest(sel) ?? null;
    for (let depth = 0; up && depth < 4; depth++, up = up.parentElement?.closest(sel) ?? null) {
      if (this.matcher.inspect(this.ownText(up, sel)).context) return true;
    }
    return this.followsMain(post);
  }

  /** The thread this address is: the address's own key, or null on a page that is not a thread page. */
  private threadKey(): string | null {
    const path = this.doc.location?.pathname ?? '';
    const re = this.opts.threadKey;
    if (!re) return path;
    const m = re.exec(path);
    return m ? (m[1] ?? m[0]) : null;
  }

  /**
   * The main post, cached across passes. Looked up again only when it is gone, no longer matches, the
   * thread changed, or the part of the page being scanned holds an element matching `main`.
   */
  private refreshMain(root: Node | null): void {
    const sel = this.opts.main;
    if (!sel) return;
    const key = this.threadKey();
    let c = this.mc;
    if (key === null) {
      if (!c || c.el || c.n || c.key !== null) this.setMain(0, null, null);
      return;
    }
    let need = !c || c.key !== key || c.n > 1;
    if (!need && c!.n === 1) need = !c!.el!.isConnected || !c!.el!.matches(sel);
    if (!need && root) {
      const scope = root.nodeType === 1 || root.nodeType === 9 || root.nodeType === 11 ? (root as ParentNode) : null;
      if (scope) {
        if (root.nodeType === 1 && (root as Element).matches(sel) && root !== c!.el) need = true;
        else {
          const hits = scope.querySelectorAll(sel);
          for (let i = 0; i < hits.length && !need; i++) if (hits[i] !== c!.el) need = true;
        }
      }
    }
    if (!need) return;
    let all: ArrayLike<Element> = [];
    try {
      all = this.doc.querySelectorAll(sel);
    } catch {
      /* a selector the browser rejects finds nothing */
    }
    this.setMain(all.length, all.length === 1 ? all[0]! : null, key);
  }

  private setMain(n: number, el: Element | null, key: string | null): void {
    const was = this.mc?.el;
    this.mc = { n, el, key, names: undefined, namesPass: -1 };
    if (el && el !== was) {
      // A new main post: where its list of replies starts is worked out again.
      const cards = this.opts.containers;
      let cell: Element = el;
      while (cell.parentElement && cell.parentElement !== this.doc.body && !(cards && this.holdsOther(cell.parentElement, el, cards))) cell = cell.parentElement;
      this.anchor = { cell, parent: cell.parentElement };
      this.run = new WeakSet();
      this.out = new WeakSet();
    }
  }

  /** Does `a` hold a site post other than `el` (and anything inside it)? */
  private holdsOther(a: Element, el: Element, cards: string): boolean {
    const all = a.querySelectorAll(cards);
    for (let i = 0; i < all.length; i++) if (all[i] !== el && !el.contains(all[i]!) && !all[i]!.contains(el)) return true;
    return false;
  }

  /** A block of the thread's list that ends the replies: it has a heading and holds no post ("Discover more"). */
  private isBoundary(c: Element): boolean {
    const cards = this.opts.containers;
    if (cards && (c.matches(cards) || c.querySelector(cards))) return false;
    return c.matches(THREAD_HEADING) || !!c.querySelector(THREAD_HEADING);
  }

  /**
   * Is `post` in the run of the main post's list that follows it, before the first boundary? Each block
   * of the list is judged once and remembered, so asking for a stream of posts costs nothing per post.
   */
  private inRun(post: Element): boolean {
    const { cell, parent } = this.anchor ?? {};
    if (!cell || !parent) return false;
    let a: Element | null = post;
    while (a && a.parentElement !== parent) a = a.parentElement;
    if (!a || a === cell) return false;
    if (this.run.has(a)) return true;
    if (this.out.has(a)) return false;
    const chain: Element[] = [a];
    let state: boolean;
    for (let p = a.previousElementSibling; ; p = p.previousElementSibling) {
      if (!p) { state = !cell.isConnected; break; } // the main post's own block is gone: what is left follows it
      if (p === cell || this.run.has(p)) { state = true; break; }
      if (this.out.has(p)) { state = false; break; }
      chain.push(p);
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      if (state && this.isBoundary(chain[i]!)) state = false;
      (state ? this.run : this.out).add(chain[i]!);
    }
    return this.run.has(a);
  }

  /** A reply on a flat thread page: it follows the main post in its list, and the main post's own words name the game. */
  private followsMain(post: Element): boolean {
    const c = this.mc;
    if (!c?.el || !this.inRun(post)) return false;
    if (c.namesPass !== this.pass) {
      c.names = this.matcher.inspect(this.ownText(c.el, this.opts.containers ?? POST_SELECTOR)).context;
      c.namesPass = this.pass;
    }
    return !!c.names;
  }

  /** Cover `post` with the hidden main post: no label of its own, and nothing it held earlier stays hidden on its own. */
  private cover(post: Element): void {
    if (this.hidden.has(post)) {
      const bar = this.hidden.get(post);
      this.unmark(post);
      post.removeAttribute('data-gsb');
      post.removeAttribute('data-gsb-why');
      bar?.remove();
      this.sizes?.unobserve(post);
      this.hidden.delete(post);
    }
    post.setAttribute('data-gsb-under', this.opts.hideMode);
  }

  private strip(): void {
    this.coverKey = null;
    this.doc.querySelectorAll('[data-gsb-under]').forEach((e) => e.removeAttribute('data-gsb-under'));
  }

  /** Cover the posts in `el` (a block of the run) that are not covered yet. */
  private coverIn(el: Element): void {
    const cards = this.opts.containers!;
    if (el.matches(cards) && !el.hasAttribute('data-gsb-under')) this.cover(el);
    el.querySelectorAll(cards).forEach((p) => { if (!p.hasAttribute('data-gsb-under')) this.cover(p); });
  }

  /** The main post is hidden: cover what follows it in its list, up to the first boundary. */
  private startCover(): void {
    const key = this.threadKey();
    const cell = this.anchor?.cell;
    if (!this.opts.containers || key === null || !cell || this.opts.hideReplies === false || this.revealedThreads.has(key)) return;
    this.coverKey = key;
    for (let c = cell.nextElementSibling; c && this.inRun(c); c = c.nextElementSibling) this.coverIn(c);
  }

  /**
   * Before every pass: is the cover right for what the page is now? Hidden single main post: covered.
   * A main post that is not hidden, or more than one: no cover. No main post in the page: the cover
   * stays while it is still the same thread.
   */
  private syncCover(root: Node | null): void {
    this.refreshMain(root);
    const c = this.mc;
    const key = this.threadKey();
    const marked = this.coverKey !== null;
    if (!c || key === null || c.n > 1 || this.opts.hideReplies === false || this.revealedThreads.has(key)) {
      if (marked) this.strip();
      return;
    }
    if (c.el) {
      if (!this.hidden.has(c.el)) { if (marked) this.strip(); return; }
      if (this.coverKey !== key) { this.strip(); this.startCover(); }
    } else if (marked && this.coverKey !== key) this.strip();
  }

  /** Posts that arrive (or are scanned) while the main post is hidden are covered too, if they sit in the run. */
  private coverNew(root: Node): void {
    if (this.coverKey === null || !this.opts.containers) return;
    const cards = this.opts.containers;
    const el = root.nodeType === 1 ? (root as Element) : root.parentElement;
    const near = el?.closest(cards);
    if (near && !near.hasAttribute('data-gsb-under') && this.inRun(near)) this.cover(near);
    if (root.nodeType === 3) return;
    const found: Element[] = [];
    if (root.nodeType === 1 && (root as Element).matches(cards) && root !== near) found.push(root as Element);
    (root as ParentNode).querySelectorAll?.(cards).forEach((x) => found.push(x));
    for (const x of found) if (!x.hasAttribute('data-gsb-under') && this.inRun(x)) this.cover(x);
  }

  /** The main post was shown again: its replies are uncovered and judged on their own. */
  private uncover(): void {
    this.coverKey = null;
    const posts = [...this.doc.querySelectorAll('[data-gsb-under]')];
    posts.forEach((p) => p.removeAttribute('data-gsb-under'));
    for (const p of posts) {
      this.about.delete(p);
      this.spoilTried.delete(p);
      if (p.isConnected) this.scan(p);
    }
  }

  /** Text that belongs to `post` itself, leaving out the replies nested inside it. */
  private ownText(post: Element, sel: string): string {
    let out = '';
    const walker = this.doc.createTreeWalker(post, 4 /* SHOW_TEXT */);
    for (let n = walker.nextNode(), seen = 0; n && seen < 400 && out.length < 2000; n = walker.nextNode(), seen++) {
      const p = n.parentElement;
      if (p?.closest(sel) === post && !p.classList.contains('gsb-bar') && !this.isOff(p)) out += ` ${n.nodeValue ?? ''}`;
    }
    return out;
  }

  /** Inside a page part the user switched off. Nothing there is read, also when a whole post or link around it is. */
  private isOff(el: Element | null | undefined): boolean {
    const sel = this.opts.offParts;
    if (!sel || !el) return false;
    try {
      return !!el.closest(sel);
    } catch {
      return false; // a selector the browser does not know: the switch does nothing
    }
  }

  /** `textContent`, leaving out what sits in a switched-off part. Pieces are joined with no space, as textContent does. */
  private joinedText(el: Element): string {
    if (!this.opts.offParts) return el.textContent ?? '';
    let out = '';
    const walker = this.doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
    for (let n = walker.nextNode(); n && out.length <= MAX_POST_CHARS; n = walker.nextNode()) if (!this.isOff(n.parentElement)) out += n.nodeValue ?? '';
    return out;
  }

  /**
   * The words of `el` with a space between pieces. `textContent` runs neighbouring blocks together
   * ("...this weekGTA 6 is out"), which would glue a game mention onto the word before it.
   */
  private textOf(el: Element, cap: number): string {
    let out = '';
    const walker = this.doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
    for (let n = walker.nextNode(); n && out.length < cap; n = walker.nextNode()) {
      const p = n.parentElement;
      if (!SKIP_TAGS.has(p?.tagName.toUpperCase() ?? '') && !p?.classList.contains('gsb-bar') && !this.isOff(p)) out += ` ${n.nodeValue ?? ''}`;
    }
    return out.slice(0, cap);
  }

  private followsMention(post: Element): boolean {
    let prev = post.previousElementSibling;
    for (let i = 0; prev && i < CHAT_REACH; prev = prev.previousElementSibling) {
      // The label of a hidden line sits just before it in the chat; it is not a message and must not use up the reach.
      if (prev.classList.contains('gsb-bar')) continue;
      if (this.matcher.inspect(this.textOf(prev, 2000)).context) return true;
      i++;
    }
    return false;
  }

  /** "<b>First</b> <b>Last</b>" never matches piece by piece, so read the enclosing block as one text. */
  private checkJoined(el: Element): void {
    // Inside a site post with no paragraph of its own (a tweet is a pile of spans), the post is the block.
    const inline = el.closest(JOIN_SELECTOR);
    const cards = this.opts.containers;
    const block = inline ?? (cards ? el.closest(cards) : null);
    if (!block || block.childElementCount === 0) return;
    // A post's own words only: replies nested inside it are posts in their own right.
    const text = inline ? this.joinedText(block) : this.ownText(block, cards!);
    if (text.length > MAX_POST_CHARS || (!this.forceJoin && this.joined.get(block) === text.length)) return;
    this.joined.set(block, text.length);
    const found = this.matcher.inspect(text);
    const res = this.matcher.decide(found, this.pageContext);
    if (res) this.hide(this.containerFor(block), res, found.strong.size ? 'alone' : found.context ? 'mention' : 'page', block);
    else this.headingHide(block, found, block);
  }

  /**
   * A post by a spoiler account, or one that links to it: the account's page address sits in the post's links
   * (the channel line under a video, a comment's author, an @mention). The whole post is hidden, whatever it says.
   */
  private checkLinks(root: Element | Document | DocumentFragment): void {
    const links: Element[] = root.nodeType === 1 && (root as Element).matches('a[href]') ? [root as Element] : [];
    links.push(...root.querySelectorAll('a[href]'));
    for (const a of links) {
      const href = (a as HTMLAnchorElement).href;
      // As the text check does: a box being typed in and a covered thread are left alone.
      if (!href || !ACCOUNT_HOST.test(href) || this.isOff(a) || (a as HTMLElement).isContentEditable || a.closest('[contenteditable=""], [contenteditable="true"], .gsb-bar')) continue;
      if (this.opts.main && a.closest('[data-gsb-under]')) continue;
      const key = accountKey(href);
      const own = this.opts.ownPage && a.closest(this.opts.ownPage.owner) ? this.opts.ownPage : null;
      const listed = !!key && this.opts.accounts!.has(key);
      // Only an account link in the owner row decides; a hashtag or sound link there says nothing about the owner.
      if (own && key) this.ownPost(a, own, listed);
      else if (listed) {
        const box = this.containerFor(a);
        // "Cover pictures only, never words": just the post's pictures and videos.
        if (this.opts.thumbsOnly) for (const m of box.querySelectorAll('img, video')) this.hide(m, { categories: [], custom: false }, 'account', a);
        else this.hide(box, { categories: [], custom: false }, 'account', a);
      }
    }
  }

  /**
   * A link's address changed in place (a site reusing a card for something else): only the account rule looks
   * again. A card hidden for its account is judged afresh; any other hide stays as it is, because sites such as
   * Google rewrite link addresses all the time and that says nothing about the words.
   */
  linkChanged(a: Element): void {
    if (!this.opts.accounts?.size || !a.matches('a[href]')) return;
    const card = a.parentElement?.closest('[data-gsb]');
    if (card && this.hidden.has(card) && card.getAttribute('data-gsb-why') === 'account' && !this.ownHidden.has(card) && !this.revealed.has(card)) {
      this.unhide(card);
      // Its text too: it may have changed while the card was hidden.
      this.scan(card);
      return;
    }
    // "Pictures only": the account rule hid the post's pictures, not the card; they are judged afresh the same way.
    if (this.opts.thumbsOnly) {
      for (const m of this.containerFor(a).querySelectorAll('[data-gsb-why="account"]')) if (this.hidden.has(m) && !this.revealed.has(m)) this.unhide(m);
    }
    this.checkLinks(a);
  }

  /** Page parts hidden because the page's own post is by a spoiler account. */
  private ownHidden = new Set<Element>();

  /**
   * The page's own post (a watch page): by a spoiler account, its title and description, the player and the
   * description panel are hidden and the video paused (one short only, in a feed of shorts). The site reuses these elements for the next video, so when the owner changes to someone
   * else they are shown again.
   */
  private ownPost(a: Element, own: { owner: string; parts?: string; page: string }, listed: boolean): void {
    const part = own.parts ? a.closest(own.parts) : null;
    const els = part ? [part] : [...this.doc.querySelectorAll(own.page)];
    // The owner rows name one channel in several spellings (its @handle and its channel id): the post is the
    // account's when any of them is listed, so one link not yet updated by the site decides nothing on its own.
    if (!listed) listed = [...(part ?? this.doc).querySelectorAll(own.owner)].some((o) => [...o.querySelectorAll('a[href]')].some((l) => {
      const k = accountKey((l as HTMLAnchorElement).href);
      return !!k && this.opts.accounts!.has(k);
    }));
    if (!listed) {
      // Someone else's video now: show the parts again and read their text afresh (it changed while they were hidden), and forget
      // a "show" the person gave the previous video.
      for (const el of els) this.releaseOwnPart(el);
      return;
    }
    els.forEach((el, i) => {
      this.hide(el, { categories: [], custom: false }, 'account', a);
      this.ownHidden.add(el);
      this.ownEver.add(el);
      // One video counts once in the popup, however many page parts hide it.
      if (i > 0 && this.hidden.has(el)) this.hideKeys.set(el, []);
      el.querySelectorAll('video, audio').forEach((m) => this.hush(m as HTMLMediaElement, el));
    });
  }

  /** Every page part that was ever hidden as a spoiler account's own post (YouTube reuses them for the next video). */
  private ownEver = new Set<Element>();

  /** A reused own-post part goes back to normal: not hidden for its account, any old "show" forgotten, its text read again. */
  private releaseOwnPart(el: Element): void {
    if (this.ownHidden.has(el) && this.hidden.has(el) && el.getAttribute('data-gsb-why') === 'account') this.unhide(el);
    else if (this.revealed.has(el) && this.ownEver.has(el)) {
      this.revealed.delete(el);
      el.removeAttribute('data-gsb-revealed');
    } else return;
    this.scan(el);
  }

  /**
   * The page moved to another address without reloading (YouTube going to the next video, even by the same channel): the reused
   * own-post parts are judged afresh, so a "show" given to one video never carries over to the next.
   */
  addressChanged(): void {
    for (const el of this.ownEver) {
      if (!el.isConnected) { this.ownEver.delete(el); continue; }
      if (this.revealed.has(el)) { this.revealed.delete(el); el.removeAttribute('data-gsb-revealed'); }
      else if (this.ownHidden.has(el) && this.hidden.has(el)) this.unhide(el);
      this.scan(el);
    }
  }

  /** Pauses a video hidden with a spoiler account's post, and again if it starts by itself while still hidden. */
  private hushed = new WeakSet<Element>();
  private hush(media: HTMLMediaElement, holder: Element): void {
    if (!media.paused) media.pause();
    if (this.hushed.has(media)) return;
    this.hushed.add(media);
    media.addEventListener('play', () => {
      if (this.hidden.has(holder) && holder.getAttribute('data-gsb-why') === 'account' && !this.revealed.has(holder)) media.pause();
    });
  }

  /** Takes a hide off again (its label too). */
  private unhide(el: Element): void {
    this.unmark(el);
    el.removeAttribute('data-gsb');
    el.removeAttribute('data-gsb-why');
    this.hidden.get(el)?.remove();
    this.sizes?.unobserve(el);
    this.hidden.delete(el);
    this.ownHidden.delete(el);
  }

  private checkMedia(el: Element): void {
    if (this.skip(el) || isEmote(el)) return;
    const text = this.mediaText(el);
    const res = text ? this.matcher.match(text, this.pageContext) : null;
    // Inside a known card the whole card goes, like it does for text; elsewhere, or with "pictures only", just the image.
    if (res) this.hide(this.opts.thumbsOnly ? el : (this.cardFor(el) ?? el), res, 'alone', el);
    else {
      this.mediaPost(el);
      this.nearGame(el, text);
      this.recheckOnLoad(el);
    }
  }

  private waitingForLoad = new WeakSet<Element>();
  private quieted = new WeakSet<Element>();

  /**
   * On a page about the game: stop video that started by itself and mute audio, once per element.
   * A page the person has already clicked on is left alone, so a video they pressed play on is never stopped.
   */
  quiet(): void {
    if (!this.pageContext || (!this.opts.pauseVideo && !this.opts.muteAudio)) return;
    const active = (this.doc.defaultView?.navigator as Navigator & { userActivation?: { hasBeenActive: boolean } } | undefined)?.userActivation?.hasBeenActive;
    this.doc.querySelectorAll('video, audio').forEach((m) => {
      if (this.quieted.has(m)) return;
      const media = m as HTMLMediaElement;
      this.quieted.add(m);
      if (this.opts.muteAudio) media.muted = true;
      if (this.opts.pauseVideo && !active && !media.paused) media.pause();
    });
  }

  /** A picture still loading has no size yet, so the size-based rules skip it: look again once it has loaded. */
  private recheckOnLoad(el: Element): void {
    if (el.tagName !== 'IMG' || (el as HTMLImageElement).complete || this.bigMedia(el) || this.waitingForLoad.has(el)) return;
    this.waitingForLoad.add(el);
    el.addEventListener(
      'load',
      () => {
        this.waitingForLoad.delete(el);
        if (el.isConnected) this.checkMedia(el);
      },
      { once: true },
    );
  }

  /** A video, or a picture wide enough to show something. Avatars, icons and emoji fall under the size. */
  private bigMedia(el: Element): boolean {
    if (el.tagName === 'VIDEO') return true;
    const m = el as HTMLImageElement;
    // A picture that has not loaded and states no width has size 0 here and is left alone: guessing would
    // blur every icon on the page. It is looked at again when it finishes loading (recheckOnLoad).
    return (m.width || Number(el.getAttribute('width')) || m.naturalWidth || 0) >= BIG_MEDIA_PX;
  }

  /**
   * What is inside a picture or video cannot be read, so one that sits next to the game's name is
   * blurred on its own. Only the media is covered: the words beside it (hype, news) stay readable.
   * `own` is the media's own description and file name, when the caller has already read them.
   */
  private nearGame(el: Element, own?: string): void {
    const mode = this.opts.mediaNearGame ?? 'page';
    if (mode === 'off' || !this.matcher.judgesPosts || (mode === 'page' && !this.pageContext)) return;
    // Hidden already (alone or inside a hidden post), or shown again by the user.
    if (this.skip(el) || isEmote(el) || el.closest('nav, header, footer') || !this.bigMedia(el)) return;
    if (this.pageContext || (mode === 'post' && this.namedBeside(el, own))) {
      this.hide(el, { categories: [], custom: false }, 'near-game');
    }
  }

  /** Is the game named in the media's own description, its caption, the link around it, or its post? */
  private namedBeside(el: Element, own?: string): boolean {
    const names = (t: string | null | undefined) => !!t && this.matcher.inspect(t).context;
    if (names(own ?? this.mediaText(el))) return true;
    const caption = el.closest('figure')?.querySelector('figcaption');
    if (caption && names(this.textOf(caption, POST_READ_CHARS))) return true;
    const link = el.closest('a');
    if (link && names(`${this.textOf(link, 2000)} ${link.getAttribute('title') ?? ''} ${safe(link.getAttribute('href') ?? '').replace(/[/?&=#_+.-]+/g, ' ')}`)) return true;
    // A site post is read the way the post judge reads it: its own words, not the replies nested in it.
    const cards = this.opts.containers;
    const card = cards ? this.cardFor(el) : null;
    if (!cards || !card) return false;
    const text = card.matches(cards) ? this.ownText(card, cards) : this.textOf(card, POST_READ_CHARS);
    return names(`${text} ${this.unseenText(card)}`);
  }

  /** What a picture or video says about itself: description, title and file name. */
  private mediaText(el: Element): string {
    const name = (el.getAttribute('src') ?? el.getAttribute('poster') ?? '').split(/[?#]/)[0]!.split('/').pop() ?? '';
    return [el.getAttribute('alt'), el.getAttribute('title'), el.getAttribute('aria-label'), safe(name)].filter(Boolean).join(' ');
  }

  /**
   * On a page about the game, a site post that is a picture or video with next to no words is hidden:
   * what is in the media cannot be read, and it is on this page for a reason.
   */
  private mediaPost(el: Element): void {
    const cards = this.opts.containers;
    if (this.opts.hideMediaPosts === false || !this.pageContext || !cards || !this.matcher.judgesPosts) return;
    const post = el.closest(cards);
    if (!post || post.hasAttribute('data-gsb')) return;
    if (!this.bigMedia(el)) return;
    // Counts and times are not words: "3  16  79  1.5K  0:12" under a clip says nothing.
    const words = this.ownText(post, cards).split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w) && !/^\d/.test(w));
    if (words.length < MEDIA_ONLY_WORDS) this.hide(this.opts.thumbsOnly ? el : post, { categories: [], custom: false }, 'media');
  }

  private skip(el: Element): boolean {
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
    if ((el as HTMLElement).isContentEditable) return true;
    if (this.opts.offParts) {
      try {
        if (el.closest(this.opts.offParts)) return true;
      } catch {
        /* a selector the browser does not know: the switch does nothing */
      }
    }
    // Covered along with the main post of the thread.
    if (this.opts.main && el.closest('[data-gsb-under]')) return true;
    // Already hidden, revealed by the user, or one of our own labels.
    let h = el.closest(HIDDEN);
    if (!h) return false;
    if (!this.flagged) return true;
    // A thread hidden or revealed "own content only": the replies under it are still read on their own.
    const threads = this.opts.threads!;
    for (; h; h = h.parentElement?.closest(HIDDEN) ?? null) {
      const open = h.hasAttribute('data-gsb') ? h.hasAttribute('data-gsb-own') : h.hasAttribute('data-gsb-revealed') && h.matches(threads);
      if (!open || !this.replyUnder(h, el)) return true;
    }
    return false;
  }

  /** The reply option is set to "only that comment", on a site whose rule says which comments hold replies. */
  private get flagged(): boolean {
    return this.opts.hideReplies === false && !!this.opts.threads && !!this.opts.containers;
  }

  /** The outermost reply or reply area between `el` (included) and the thread `h` (excluded), or null. */
  private replyUnder(h: Element, el: Element): Element | null {
    const keep = this.keepSel;
    let found: Element | null = null;
    for (let p: Element | null = el; p && p !== h; p = p.parentElement) if (p.matches(keep)) found = p;
    return found;
  }

  /**
   * What stays uncovered inside a thread hidden "own content only": the threads nested in it (its
   * replies) and its reply areas. Not every card: a link card inside the comment's own text is own content.
   */
  private get keepSel(): string {
    return this.opts.replyAreas ? `${this.opts.threads}, ${this.opts.replyAreas}` : this.opts.threads!;
  }

  private onPath(el: Element): boolean {
    const v = el.getAttribute('data-gsb-in');
    return v !== null && v !== 'keep';
  }

  private looseText(el: Element): boolean {
    for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue!.trim()) return true;
    return false;
  }

  /** A child with no box of its own (display: contents) cannot be blurred, so the comment could not be covered piece by piece. */
  private boxless(parent: Element, k: Element, path: Element[]): boolean {
    const view = this.doc.defaultView;
    if (!view) return false;
    for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
      if (c === k || path.includes(c) || c.hasAttribute('data-gsb-in') || c.classList.contains('gsb-bar')) continue;
      if (view.getComputedStyle(c).display === 'contents') return true;
    }
    return false;
  }

  /** Uncover the reply or reply area `k` inside the hidden thread `h`. False if `h` had to stay whole. */
  private open(h: Element, k: Element): boolean {
    if (this.whole.has(h)) return false;
    const path: Element[] = [];
    for (let p = k.parentElement; p && p !== h; p = p.parentElement) path.push(p);
    if (this.looseText(h) || path.some((p) => this.looseText(p)) || (h.getAttribute('data-gsb') === 'blur' && [h, ...path].some((p) => this.boxless(p, k, path)))) {
      this.widen(h);
      return false;
    }
    const set = this.marks.get(h) ?? new Set<Element>();
    this.marks.set(h, set);
    const mode = h.getAttribute('data-gsb')!;
    for (const p of path) if (!p.hasAttribute('data-gsb-in')) (p.setAttribute('data-gsb-in', mode), set.add(p));
    k.setAttribute('data-gsb-in', 'keep');
    set.add(k);
    h.setAttribute('data-gsb-own', '');
    return true;
  }

  /** Uncover every reply and reply area the thread holds right now. With none, it stays hidden whole for now. */
  private openAll(h: Element): void {
    const keep = this.keepSel;
    const all = h.querySelectorAll(keep);
    for (let i = 0; i < all.length; i++) {
      if (this.replyUnder(h, all[i]!) === all[i] && !this.open(h, all[i]!)) return;
    }
  }

  /** Back to hidden whole, for good: something in it could not be covered piece by piece. */
  private widen(h: Element): void {
    this.unmark(h);
    this.whole.add(h);
  }

  private unmark(h: Element): void {
    this.marks.get(h)?.forEach((m) => m.removeAttribute('data-gsb-in'));
    this.marks.delete(h);
    h.removeAttribute('data-gsb-own');
  }

  /**
   * A site can reuse a hidden card for something else (YouTube does in its suggested-videos column), which
   * would leave a label on a clean card. When the content of a card hidden for a blocks-alone name inside it
   * changes, the card is judged again from scratch. Hides that depend on anything outside the card are left alone.
   * (A spoiler account's card is judged again when its link changes: linkChanged.)
   */
  private rejudge(root: Node): void {
    const cards = this.opts.containers;
    if (!cards || this.opts.main) return;
    const card = (root.nodeType === 1 ? (root as Element) : root.parentElement)?.closest('[data-gsb]');
    if (!card || card === root || !this.hidden.has(card) || card.getAttribute('data-gsb-why') !== 'alone' || !card.matches(cards)) return;
    if (this.flagged && card.matches(this.opts.threads!)) return;
    this.unhide(card);
    this.scan(card);
  }

  /** New content inside a hidden thread: if it is, or brings, a reply, uncover that reply so it is judged alone. */
  private adopt(root: Element): void {
    const h = root.parentElement?.closest('[data-gsb]');
    if (!h || !this.hidden.has(h) || !h.matches(this.opts.threads!)) return;
    const k = this.replyUnder(h, root);
    if (k) this.open(h, k);
    else if (root.firstElementChild) this.openAll(h);
  }

  /** The site rule's unit around `el`: a whole panel if it is in one, else its card. */
  private cardFor(el: Element): Element | null {
    return (this.opts.panels && el.closest(this.opts.panels)) || (this.opts.containers && el.closest(this.opts.containers)) || null;
  }

  private containerFor(el: Element): Element {
    const card = this.cardFor(el);
    if (card) return card;
    const post = el.closest(POST_SELECTOR);
    if (post && (post.textContent?.length ?? 0) <= MAX_POST_CHARS) return post;
    const c = el.closest(BLOCK_SELECTOR);
    if (c && c !== this.doc.body && c !== this.doc.documentElement && (!c.matches(BIG_BLOCK_SELECTOR) || (c.textContent?.length ?? 0) <= MAX_POST_CHARS)) return c;
    // Inside something long, cover only the small part around the match, never the whole article or list.
    const box = el.closest(SMALL_BOX_SELECTOR);
    // Length says nothing about pictures or page furniture: a short wrapper holding those may be the whole app.
    if (box && (box.textContent?.length ?? 0) <= MAX_POST_CHARS && (!c || c.contains(box)) && !box.querySelector('img, video, nav, header, footer, main')) return box;
    return el;
  }

  private pageLevel(el: Element): boolean {
    return el === this.doc.body || el === this.doc.documentElement || el.matches('main');
  }

  /** `at` is where the match itself sits, when the hide comes from a match and not from judging the post. */
  private hide(el: Element, res: MatchResult, why: Why = 'alone', at?: Element): void {
    if (this.revealed.has(el)) return;
    // Never the whole page: that would blank it for one match.
    if (this.pageLevel(el) && !this.cardFor(el)) return;
    if (this.opts.main) {
      if (el.closest('[data-gsb-under]')) return;
      // A main post the user showed stays shown, even when the site builds the element again.
      const k = el.matches(this.opts.main) ? this.threadKey() : null;
      if (k !== null && this.revealedThreads.has(k)) return;
    }
    // The match sits in the replies' own area ("more replies" text): that area cannot stay uncovered.
    const inReplies = !!at && this.flagged && at !== el && !!this.replyUnder(el, at);
    if (this.hidden.has(el)) {
      if (inReplies && el.hasAttribute('data-gsb-own')) this.widen(el);
      return;
    }
    const own = this.flagged && el.matches(this.opts.threads!) && !inReplies && !this.whole.has(el);
    // Anything inside this element that was hidden on its own earlier is now covered by this one:
    // drop those so a card never carries labels within labels. Hidden replies under a comment
    // that keeps its replies uncovered stay as they are.
    for (const [inner, innerBar] of this.hidden) {
      if (inner !== el && el.contains(inner) && !(own && this.replyUnder(el, inner))) {
        this.unmark(inner);
        inner.removeAttribute('data-gsb');
        inner.removeAttribute('data-gsb-why');
        innerBar?.remove();
        this.hidden.delete(inner);
      }
    }
    el.setAttribute('data-gsb', this.opts.hideMode);
    // Which rule hid it. A rule name only, never the matched words.
    el.setAttribute('data-gsb-why', why);
    this.hideKeys.set(el, keysFor(why, res.groups));
    let bar: HTMLElement | null = null;
    if (this.opts.hideMode !== 'remove') {
      const btn = this.doc.createElement('button');
      btn.type = 'button';
      bar = btn;
      bar.className = 'gsb-bar';
      // The collapsed line is small: the item is gone, only a trace is left.
      if (this.opts.hideMode === 'collapse') bar.setAttribute('data-gsb-line', '');
      const name = this.opts.showReason === false ? 'Hidden' : why === 'account' ? 'Hidden: spoiler account' : labelFor(res);
      this.wireReveal(el, bar, `${name} (click to show)`);
      el.before(bar);
    }
    this.hidden.set(el, bar);
    // A collapsed item has no size by design, so its line is never tucked away by the size watcher.
    if (bar && this.opts.hideMode === 'blur') this.sizes?.observe(el);
    if (own) this.openAll(el);
    else if (this.flagged) this.whole.add(el);
    if (this.opts.main && this.mc?.el === el) this.startCover();
  }

  /** Gives a label its reveal behaviour: one click, a second click to confirm, or shown while held down. */
  private wireReveal(el: Element, bar: HTMLElement, text: string): void {
    const mode = this.opts.revealMode ?? 'click';
    bar.textContent = text;
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mode === 'hold' && this.opts.hideMode === 'blur') {
      bar.textContent = text.replace('click to show', 'hold to peek');
      const show = (e: Event) => { stop(e); el.setAttribute('data-gsb-peek', ''); };
      const hide = () => el.removeAttribute('data-gsb-peek');
      bar.addEventListener('pointerdown', show);
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) bar.addEventListener(ev, hide);
      bar.addEventListener('click', stop);
      // Keyboard: the key has to be held, so Enter or Space shows it until the key is released.
      bar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') show(e); });
      bar.addEventListener('keyup', hide);
      return;
    }
    let armed = false;
    bar.addEventListener('click', (e) => {
      stop(e);
      if (mode === 'twice' && !armed) {
        armed = true;
        bar.textContent = 'Click again to show';
        setTimeout(() => {
          armed = false;
          bar.textContent = text;
        }, 4000);
        return;
      }
      this.reveal(el);
    });
  }

  reveal(el: Element): void {
    const bar = this.hidden.get(el);
    this.unmark(el);
    el.removeAttribute('data-gsb');
    el.removeAttribute('data-gsb-why');
    this.sizes?.unobserve(el);
    el.setAttribute('data-gsb-revealed', '');
    bar?.remove();
    this.hidden.delete(el);
    this.revealed.add(el);
    // A thread that had to stay hidden whole kept its replies unread. Shown, they are judged one by one.
    if (this.flagged && el.matches(this.opts.threads!)) {
      el.querySelectorAll(this.opts.threads!).forEach((r) => { if (this.replyUnder(el, r) === r) this.scan(r); });
    }
    if (this.opts.main && this.mc?.el === el) {
      const k = this.threadKey();
      if (k !== null) this.revealedThreads.add(k);
      this.uncover();
    }
  }

  revealAll(): void {
    for (const el of [...this.hidden.keys()]) this.reveal(el);
  }

  /** Undo everything (used before rescanning with new settings). */
  clear(): void {
    for (const [el, bar] of this.hidden) {
      el.removeAttribute('data-gsb');
      el.removeAttribute('data-gsb-why');
      bar?.remove();
    }
    this.hidden.clear();
    this.marks.clear();
    this.strip();
    this.mc = null;
    this.anchor = null;
    this.revealedThreads.clear();
    this.doc.querySelectorAll('[data-gsb-in], [data-gsb-own]').forEach((e) => (e.removeAttribute('data-gsb-in'), e.removeAttribute('data-gsb-own')));
    this.sizes?.disconnect();
    this.doc.querySelectorAll('[data-gsb-peek]').forEach((e) => e.removeAttribute('data-gsb-peek'));
    // Items the user already showed stay shown across a restart when the caller keeps that set.
    if (!this.opts.keepRevealed) {
      this.doc.querySelectorAll('[data-gsb-revealed]').forEach((e) => e.removeAttribute('data-gsb-revealed'));
      this.revealed = new WeakSet();
    }
  }

  /**
   * Drop bookkeeping for elements removed from the page, and keep every label right in front of its item.
   * Sites move and replace cards after they are hidden (YouTube does), which would leave a label behind.
   */
  prune(): void {
    const mine = new Set<Element>();
    for (const [el, bar] of this.hidden) {
      if (!el.isConnected) {
        bar?.remove();
        this.sizes?.unobserve(el);
        this.unmark(el);
        this.hidden.delete(el);
        continue;
      }
      if (!bar) continue;
      mine.add(bar);
      if (bar.nextElementSibling !== el) el.before(bar);
    }
    for (const b of this.doc.querySelectorAll('.gsb-bar')) if (!mine.has(b)) b.remove();
    if (this.opts.main) this.syncCover(this.doc);
  }
}

/**
 * A chat emote is a small picture whose description is just the emote's name ("KEKW", "W").
 * That name is not something anyone wrote, so it must never count as a word.
 */
function isEmote(el: Element): boolean {
  return el.hasAttribute('data-emote-name') || el.hasAttribute('data-emote-id') || !!el.closest('[class*="emote" i]');
}

function safe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
