import { ACCOUNT_HOST, accountKey } from '../accounts';
import { addKeys, keysFor, type HideKey, type HiddenTally } from '../hidden';
import { Matcher, labelFor, type Found, type MatchResult } from '../matcher';
import { anchorFor, type Why } from '../reason-settings';
import { SOURCE_SENTENCE, SOURCE_TAG, pickSource, type CoverResult, type Source, type SourceContext } from '../cover-source';
import { BARE_PICTURES, type BlurStrength, type HideMode, type Pictures, type RevealMode } from '../settings';
import { DEBUG_WHY } from '../debug-flag';
import { unwrap, OFFICIAL_SITES, TRAILER_WORDS, handleOf, hasOfficialHandles, hasPublisherAccounts, isOfficialChannelLink, isOfficialHandle, isOfficialName, isPublisherHandle, isStoreLink, isStorePage, isYouTube } from '../adapters/official';
import { discordMessageOf, isLibraryGif, libraryLabel, libraryUrls, placeholderFor } from './gifs';

const POST_SELECTOR = 'article, [role="article"], li';
/** A post/card longer than this is probably a whole article page, so hide just the matching paragraph. */
const MAX_POST_CHARS = 1500;
/** The covers an official store page, result, card or post is let through for: the announced leads, not a name that hides alone or a spoiler word. */
const STORE_WHY: ReadonlySet<Why> = new Set<Why>(['mention', 'page', 'two-names', 'hint', 'near-game', 'media', 'heading', 'reply']);
/** A media duration that is a real video length. A live player has Infinity, NaN, or a huge finite stand-in (the IVS player on Twitch and Kick: about 2^30 s). */
function isRecorded(d: number): boolean {
  return Number.isFinite(d) && d < 1e8;
}
/** The real player among a root's videos (a live page can hold small preview clips too): the largest on screen, a playing one on a tie, else the first. */
function playerIn(root: Element): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let area = -1;
  for (const v of root.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    const a = r.width * r.height;
    if (a > area || (a === area && best?.paused && !v.paused)) { best = v; area = a; }
  }
  return best;
}
/** Splits a glued name at its capitals and at letter-digit edges: "@ZorblaxQuuxDiesInZZG9" -> "Zorblax Quux Dies In ZZ G 9" (the @ is dropped). */
function unglue(text: string): string {
  return text.replace(/@/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([A-Za-z])([0-9])/g, '$1 $2');
}
const THREAD_HEADING = 'h1, h2, h3, [role="heading"]';
const BLOCK_SELECTOR = 'article, [role="article"], li, p, h1, h2, h3, h4, h5, h6, blockquote, td, dd, figure';
/** Blocks that can hold a whole article's worth of other content, so they are hidden only when short. */
const BIG_BLOCK_SELECTOR = 'article, [role="article"], li, td, dd';
const SMALL_BOX_SELECTOR = 'div, section, aside, tr, dl';
/** Smallest units whose text is read as one piece, so a name split by bold or link markup is still caught. */
const JOIN_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, a, blockquote, td, dd, figcaption';
const BAR_ACTS = new WeakMap<Element, Record<string, (e: Event) => void>>();
const GUARDED = new WeakSet<Window>();
/**
 * A click on one of our bars is ours alone, and the page's own handlers must not see it: Facebook's photo viewer closes on a
 * click (or mousedown) that is not on its media, with handlers on the window in the capture phase, ahead of the bar. So the window
 * takes these events first, from the start of the page (before the page's scripts add theirs): for a bar it runs the bar's own
 * action and stops the event there. It does nothing for anything else.
 */
export function guardBars(doc: Document): void {
  const win = doc.defaultView;
  if (!win || GUARDED.has(win)) return;
  GUARDED.add(win);
  // Which bar each kind of release is owed to: the one its press landed on. A drag that ends over a bar (a seek bar, a swiped
  // carousel, a text selection) is the page's own, so a release is stopped only when its press was on that bar.
  // Each press is kept by its pointer (or finger), so a second finger does not take the first one's place.
  const pressed = new Map<string, Element | null>();
  let swallowUntil = 0;
  // The releases owed to presses stopped on a cover (see below), by kind and pointer.
  const eaten = new Set<string>();
  const idsOf = (e: Event): string[] => {
    const t = (e as TouchEvent).changedTouches;
    if (t && t.length) return [...t].map((x) => String(x.identifier));
    const id = (e as PointerEvent).pointerId;
    return [id === undefined ? '' : String(id)];
  };
  const guard = (e: Event) => {
    let bar: Element | undefined;
    let acts: Record<string, (e: Event) => void> | undefined;
    for (const n of e.composedPath()) if ((acts = BAR_ACTS.get(n as Element))) { bar = n as Element; break; }
    const press = PRESS_TO_RELEASE[e.type];
    const ids = idsOf(e);
    if (press) {
      // Only a new pointer or key starts over: the compatibility mouse events after a tap are part of the same press.
      if (e.type === 'pointerdown' || e.type === 'keydown') swallowUntil = 0;
      for (const id of ids) bar ? pressed.set(press + ':' + id, bar) : pressed.delete(press + ':' + id);
    }
    if (e.type === 'pointercancel' || e.type === 'touchcancel') for (const id of ids) { for (const k of ['pointerup:', 'touchend:']) { pressed.delete(k + id); eaten.delete(k + id); } }
    const release = RELEASES.has(e.type);
    let mine = true;
    let gone = false;
    let owners: (Element | null)[] = [];
    if (release) {
      owners = ids.map((id) => pressed.get(e.type + ':' + id) ?? null);
      mine = !!bar && owners.every((o) => o === bar);
      // The press was on a bar the page took away before the release: the release and the click that follows are ours too.
      gone = !e.type.startsWith('key') && owners.some((o) => !!o && !o.isConnected);
      for (const id of ids) pressed.delete(e.type + ':' + id);
    }
    if (gone) {
      // A hold that ends with its bar gone still ends the peek.
      for (const o of owners) if (o && !o.isConnected) BAR_ACTS.get(o)?.[e.type]?.(e);
      swallowUntil = Date.now() + 500;
      e.stopImmediatePropagation();
      return;
    }
    if ((e.type === 'click' || e.type === 'mousedown' || e.type === 'mouseup') && swallowUntil > Date.now()) {
      if (e.type === 'click') swallowUntil = 0;
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    // On a site whose pictures sit in its own buttons (Instagram: a double-click likes the post), a click that lands on a blurred cover goes
    // no further: only its bar shows it. A cover is inert and takes no pointer events, so the event is aimed at what holds it (or at a
    // see-through layer the site lays over the picture): the point is looked up among the covers inside the control around the target.
    // A release is stopped only when its press was (a drag that started elsewhere and ends over a cover is the page's own).
    if (!bar && doc.documentElement.hasAttribute(EAT_ATTR)) {
      const t = e.composedPath()[0];
      let eat = false;
      if (release) eat = ids.some((id) => eaten.delete(e.type + ':' + id));
      else if (EATS.has(e.type)) eat = t instanceof Element && onCover(t, e);
      if (eat) {
        if (press) for (const id of ids) eaten.add(press + ':' + id);
        e.stopImmediatePropagation();
        if (e.cancelable && e.type !== 'touchstart') e.preventDefault();
        return;
      }
    }
    if (!bar || !acts || (e.type.startsWith('key') && !isActKey(e))) return;
    if (!mine) {
      // Hold mode ends a peek on any release over its bar; the page still gets the event.
      if (!e.type.startsWith('key')) acts[e.type]?.(e);
      return;
    }
    e.stopImmediatePropagation();
    acts[e.type]?.(e);
  };
  for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick', 'touchstart', 'touchend', 'touchcancel', 'pointercancel', 'keydown', 'keyup']) win.addEventListener(t, guard, true);
}
/** On the root when blurred covers take their own clicks (Adapter `swallowClicks`). */
export const EAT_ATTR = 'data-gsb-eat';
/** Presses and clicks looked at on a cover (their releases follow their presses). */
const EATS = new Set(['pointerdown', 'mousedown', 'touchstart', 'click', 'auxclick', 'dblclick']);
/** The site's own controls: a click is looked up from the one around its target. */
const CONTROL = 'a, button, [role="button"], [role="link"]';
/**
 * Does the event's point lie on a blurred cover (any kind: a post, its comments covered with it, a part held) inside the site control around
 * the target, or around the target itself (not one shown for a peek)? A control of its own laid over a picture (a carousel arrow) holds
 * no cover, so its clicks pass.
 */
const onCover = (t: Element, e: Event): boolean => {
  if (t === t.ownerDocument.documentElement || t === t.ownerDocument.body) return false;
  const p = (e as TouchEvent).changedTouches?.[0] ?? (e as MouseEvent);
  const x = p.clientX, y = p.clientY;
  if (typeof x !== 'number' || typeof y !== 'number') return false;
  const covers = COVERS('blur');
  const own = t.closest(covers);
  const root = t.closest(CONTROL) ?? t;
  for (const c of own ? [own] : root.querySelectorAll(covers)) {
    if (c.closest('[data-gsb-peek]')) continue;
    const r = c.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
};
const PRESS_TO_RELEASE: Record<string, string> = { pointerdown: 'pointerup', mousedown: 'mouseup', touchstart: 'touchend', keydown: 'keyup' };
const RELEASES = new Set(Object.values(PRESS_TO_RELEASE));

/** Enter or Space on a bar. */
const isActKey = (e: Event): boolean => (e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ';
/** Not covered when a dialog is: nothing to see. */
const DIALOG_SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK']);
/** A dialog's content is not stepped into past these: they are covered as they are. */
const DIALOG_LEAF = new Set(['SVG', 'IMG', 'VIDEO', 'CANVAS', 'PICTURE', 'PRE', 'IFRAME', 'AUDIO', 'TEXTAREA', 'INPUT', 'SELECT']);
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
 * data-gsb-hold=<mode> keeps an old cover on while a restart rescans with a new list or settings (content.ts holdCovers).
 */
export const COVERS = (mode: HideMode): string =>
  `[data-gsb="${mode}"]:not([data-gsb-own]),[data-gsb="${mode}"][data-gsb-own]>:not([data-gsb-in],.gsb-bar),[data-gsb-in="${mode}"]>:not([data-gsb-in],.gsb-bar),[data-gsb-under="${mode}"],[data-gsb-hold="${mode}"]`;

const BLUR_CSS: Record<BlurStrength, string> = {
  light: 'filter:blur(6px)',
  medium: 'filter:blur(14px)',
  heavy: 'filter:blur(32px)',
  solid: 'filter:brightness(0)!important;box-shadow:inset 0 0 0 100000px #000', // a plain dark box: black text on a clear background would stay readable without its own fill. A shadow, so that peeking can lift it and leave the site's own background alone
};

/** A held label shows its element and what is in it, except a reply inside it that is hidden on its own. */
const PEEK = '[data-gsb-peek]'.repeat(4);
const peeked = (el: Element): boolean => {
  const p = el.closest('[data-gsb-peek]');
  const c = el.closest('[data-gsb]');
  return !!p && !(c && c !== p && p.contains(c));
};

/** The page's stylesheet for covers. Several equal attributes in the peek rule outrank every cover rule above it. */
export const cssFor = (blur: BlurStrength = 'medium'): string => `
${COVERS('blur')}{${BLUR_CSS[blur]}!important;clip-path:inset(0)!important;user-select:none!important;pointer-events:none!important}
/* Nothing inside a blurred cover takes a click (a player's own buttons set pointer-events:auto); the label is a sibling. */
[data-gsb="blur"]:not([data-gsb-own]) *{pointer-events:none!important}
${COVERS('collapse')},${COVERS('remove')}{display:none!important}
.gsb-bar{all:initial;display:block;flex:none;align-self:flex-start;min-width:max-content;position:relative;z-index:2147483647;box-sizing:border-box;margin:6px 0 2px;padding:3px 10px;font:500 12px/1.4 system-ui,sans-serif;
 color:#fff;background:#23262a;border:0;border-radius:999px;cursor:pointer;text-align:left;user-select:none}
.gsb-bar:hover{background:#3a3f45}
.gsb-bar[data-gsb-stacked]{display:none!important}
.gsb-tip{all:initial;position:fixed;z-index:2147483647;display:flex;gap:8px;align-items:center;box-sizing:border-box;padding:3px 10px;border-radius:999px;background:#23262a;color:#fff;font:500 12px/1.4 system-ui,sans-serif;white-space:nowrap}
.gsb-tip[popover]:not(:popover-open){display:none}
.gsb-tip:popover-open{display:flex}
.gsb-tip::before{content:attr(data-reason)}
.gsb-tip .gsb-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.gsb-change{all:initial;cursor:pointer;color:#9cc4ff;font:600 12px/1.4 system-ui,sans-serif;text-decoration:underline}
.gsb-change:focus-visible{outline:2px solid #fff;outline-offset:2px}
.gsb-bar[data-gsb-icon]:is(:hover,:focus-visible)::after{content:attr(aria-label);position:absolute;left:26px;top:-1px;white-space:nowrap;padding:3px 10px;border-radius:999px;background:#23262a;color:#fff;font:500 12px/1.4 system-ui,sans-serif;pointer-events:none}
.gsb-bar[data-gsb-short]{min-width:0;margin:0;padding:2px 8px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:6px;opacity:.92}
.gsb-bar[data-gsb-line]{margin:2px 0;padding:2px 8px;font-size:11px;font-weight:500;opacity:.8}
.gsb-bar[data-gsb-icon]{width:20px;height:20px;min-width:0;margin:2px 0;padding:0;border-radius:50%;font-size:0;opacity:1;overflow:visible;
 background:#23262a url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3Cpath d='M4 4l16 16'/%3E%3C/svg%3E") center/14px no-repeat}
${PEEK},${PEEK} :not(${PEEK} [data-gsb],${PEEK} [data-gsb] *){filter:none!important;clip-path:none!important;pointer-events:auto!important${blur === 'solid' ? ';box-shadow:none!important' : ''}}
`;
export const CSS = cssFor('medium');

/**
 * Screen readers skip exactly what is blurred (the cover selector itself), so a hidden spoiler is never read out; collapsed and
 * removed covers are off the page already. Only marks it set itself are taken back (data-gsb-aria), never the page's own.
 */
export function syncReaders(doc: Document): void {
  const blurred = COVERS('blur');
  // Inert as well, so links and buttons in a blurred post cannot be reached with the keyboard; lifted while peeking.
  const covered = (el: Element) => el.matches(blurred) && !peeked(el);
  const marks = '[data-gsb="blur"], [data-gsb-in="blur"], [data-gsb-under="blur"], [data-gsb-hold="blur"]';
  for (const r of [doc, ...shadowRoots()]) {
    // One pass over the page. Whatever the cover selector matches carries one of these marks itself or is a child of one:
    // a quick attribute search and a check of those few, instead of running the long selector over the whole page.
    r.querySelectorAll(`[data-gsb-aria], ${marks}`).forEach((m) => {
      if (m.hasAttribute('data-gsb-aria') && !covered(m)) {
        m.removeAttribute('aria-hidden');
        m.removeAttribute('inert');
        m.removeAttribute('data-gsb-aria');
      }
      if (!m.matches(marks)) return;
      for (const el of [m, ...m.children]) {
        if (el.hasAttribute('aria-hidden') || el.hasAttribute('inert') || !covered(el)) continue;
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('inert', '');
        el.setAttribute('data-gsb-aria', '');
      }
    });
  }
}

/**
 * Open shadow roots found on the page (Reddit's chat draws its messages inside them). The page's own stylesheet does not
 * reach inside one, so a root that gets a cover is given its own copy of the cover style.
 */
const ROOTS = new Set<ShadowRoot>();
const ROOT_STYLES = new Map<ShadowRoot, HTMLStyleElement>();
/** The open shadow roots seen so far that are still on the page. */
export function shadowRoots(): ShadowRoot[] {
  for (const r of ROOTS) if (!r.host.isConnected) { ROOTS.delete(r); ROOT_STYLES.delete(r); }
  return [...ROOTS];
}

export interface ScanOptions {
  /** Called once for each open shadow root found, so the page watcher can observe it too. */
  onShadowRoot?: (root: ShadowRoot) => void;
  hideMode: HideMode;
  /** How strongly a cover blurs. 'medium' unless set. */
  blur?: BlurStrength;
  /** The label says what kind of thing is hidden. On unless switched off. */
  showReason?: boolean;
  /** Opt-in debug: each cover also carries the rule and matched terms (data-gsb-debug and the label's tooltip). Shows spoilers. */
  debugWhy?: boolean;
  /** How a cover is lifted. 'click' unless set. */
  revealMode?: RevealMode;
  /** Selector for page parts the user switched off: nothing inside them is read or hidden. */
  offParts?: string | null;
  /** Site adapter selector for what is never covered as a picture or video (a live stream's player): its title or card is covered by its words, the player is not. */
  keepClear?: string;
  /** Addresses (host + path + query) where keepClear does not apply: recorded broadcasts and clips are spoiler media, only a LIVE player is never covered. */
  keepClearNot?: RegExp;
  /** Site adapter selectors for people's names: never read (display names, handles). `people`: person cards, whose only readable part is the `bio`. */
  names?: string;
  people?: string;
  bio?: string;
  /** Pause video that would play by itself, and mute audio, on pages about the game. */
  pauseVideo?: boolean;
  muteAudio?: boolean;
  /**
   * The picture settings, resolved once by settings.ts picturesFor (the content script). A setting left out takes the bare
   * scanner's value (BARE_PICTURES); hideImages is always given.
   */
  pictures: Partial<Pictures> & Pick<Pictures, 'hideImages'>;
  /** Selector for GIFs a site's own picker inserts (media with no library address). */
  gifs?: string;
  /** Items the user lifted a cover from, kept across rescans (a restart after a settings change) when given. */
  keepRevealed?: WeakSet<Element>;
  /** Site adapter selector for one post/card (see src/adapters). */
  containers?: string;
  /** Site adapter selector for parts of a page that are not its subject: their pictures are judged on their own words. */
  apart?: string;
  /** Trailers are let through (Settings.allowTrailers): an official source's own trailer media are not covered for the game. */
  allowTrailers?: boolean;
  /** The big official stores and the publisher's site and accounts are let through (Settings.allowStores): see storePass. */
  allowStores?: boolean;
  /** Site adapter selector for regions hidden whole, even when they hold smaller cards. */
  panels?: string;
  /** Messages are a flat list (a chat): a game mention also covers the messages just after it. */
  chat?: boolean;
  /** Hiding a comment hides the replies nested under it too. On unless switched off. */
  hideReplies?: boolean;
  /** Site adapter selector for comments that hold their replies (see src/adapters). */
  threads?: string;
  /** Which of `threads` count as replies for reply pictures (default: all of them). */
  replies?: string | null;
  /** Site adapter selector for post thumbnails: small, but still covered next to the game's name. */
  thumbs?: string;
  /** Site adapter selector for the piece whose arrival makes a box a post (see src/adapters). */
  postMaker?: string;
  /** Site adapter selector for the areas and buttons inside a thread that belong to its replies. */
  replyAreas?: string;
  /**
   * Site adapter selector for the main post of a thread page, on sites where replies are not nested
   * but follow it as separate posts. Replies then answer it, and are covered with it when it is hidden.
   */
  main?: string;
  /** Site adapter selector for the page's own post, on sites whose comments sit beside it (new Reddit): its cover covers their reply pictures. */
  primaryPost?: string;
  /** Links that are only a picture's own link (Facebook photo links): a link of this kind with no words and no label is not a quoted post. */
  picLinks?: string;
  /** Dialogs are photo viewers (Facebook): see viewerOf. */
  viewers?: boolean;
  /** A picture-only post on a page about the game: only its pictures are covered, not the post (its author row stays). */
  mediaPostPictures?: boolean;
  /** Per container selector: the part of it that is covered when the container is (see Adapter.coverParts). */
  coverParts?: Record<string, string>;
  /** Containers covered only for a strong listed name by itself (see Adapter.strongOnly). */
  strongOnly?: string;
  /** Pattern whose first group names the thread an address belongs to; `main` counts only where it matches. */
  threadKey?: RegExp;
  /** Site adapter selector for blocks that end the replies of a thread page (Reddit's "more posts" feed), whatever they hold. */
  threadEnd?: string;
  /** Comments that sit inside the main post (Instagram): covered with it, and no run after it is (see inMain). */
  commentsInside?: string;
  /** A post's pictures that are cards of their own (Instagram's carousel slides): see Adapter.slides and postOf. */
  slides?: string;
  /** Cards that count only on a thread page (`threadKey` matches the address): Instagram's live post block, which a feed must never be. */
  threadCards?: string;
  /** Where a main post that holds its comments sits, before it is one (see refreshMain): only that block is tried when a node lands in it. */
  mainBlock?: string;
  /** Blurred covers take their own clicks, so none reaches the site's handler under them (Instagram's double-click like). */
  swallowClicks?: boolean;
  /** Spoiler accounts (src/accounts.ts keys): a post holding a link to one is hidden whole, whatever it says. */
  accounts?: ReadonlySet<string>;
  /** Site adapter rule for the page's own post (a watch page): see src/adapters `ownPage`. */
  ownPage?: { owner: string; parts?: string; page: string };
  /** Where the settings here come from: a cover a changed setting made says which (cover-source.ts). Left out: no source, no tag. */
  coverSource?: SourceContext;
}

/** The rule that hid something: a name that blocks alone, or a weak name qualified in one of these ways. */
/** The rule that hid an item, in plain words. Never the matched words. */
export const WHY_TEXT: Record<Why, string> = {
  alone: 'A name here hides on its own, wherever it appears.',
  mention: 'The text names the game and holds something from the spoiler list.',
  page: 'The page is about the game and this text holds a name from the list.',
  'two-names': 'This post holds two different names from the list.',
  hint: 'This post holds a name from the list beside a word like a reaction or a gaming word.',
  reply: 'This replies to a post that names the game.',
  chat: 'This message follows one that names the game.',
  'spoiler-word': 'The game is named here with a spoiler word.',
  media: 'A picture or video in a post that names the game.',
  'near-game': "A picture or video next to the game's name.",
  heading: 'The heading names the game.',
  account: 'A spoiler account you chose to hide.',
};
export type { Why };

/**
 * What the label on a cover says: the reason, in a few plain words ("Hidden: picture next to GTA 6", "Hidden: character spoiler").
 * Never the matched words. The setting "say why" off gives a plain "Hidden" (see hide).
 */
/** Counter for the ids our bars get when a tip ties its button to them. */
let tipIds = 0;

export function reasonLabel(why: Why, res: MatchResult, el: Element): string {
  const noun = el.matches('video') || el.querySelector('video') ? 'video' : 'picture';
  switch (why) {
    case 'account': return 'Hidden: spoiler account';
    case 'near-game': return `Hidden: ${noun} next to GTA 6`;
    case 'media': return `Hidden: ${noun} in a GTA 6 post`;
    case 'reply': return 'Hidden: reply to a GTA 6 post';
    case 'chat': return 'Hidden: message after a GTA 6 mention';
    case 'heading': return 'Hidden: heading about GTA 6';
    default: return labelFor(res);
  }
}

/** A cover at least this wide, too narrow for the full label, shows the reason in a few words inside it, at the bottom; narrower, only the eye. */
const SHORT_MIN_PX = 96;
/** ...and at least this tall (the short reason lies over its bottom edge). */
const SHORT_MIN_H = 40;

/** The reason in a few words, from its category only (no name): "Hidden: character spoiler" -> "Character spoiler", "...next to GTA 6" -> "...near the game". */
export function shortReason(full: string): string {
  const t = full.replace(/^Hidden:\s*/, '').replace(/next to GTA 6/g, 'near the game').replace(/\ba GTA 6/g, 'a game').replace(/GTA 6/g, 'the game').trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : full;
}

/** A site post with fewer words than this beside its picture or video is treated as media only. */
const MEDIA_ONLY_WORDS = 10;
/** Media smaller than this (tracking pixels, avatars) does not stop a video's player wrapper from being found. */
const TINY_MEDIA_PX = 100;
const BIG_MEDIA_PX = 150;
/** Inside a post or card the floor is lower: a post's thumbnails (143 px on Bluesky) are its pictures. Avatars (40-48 px) stay out. */
const CARD_MEDIA_PX = 96;
/** In a card naming the game on a page about it: below this a picture is an avatar, emoji or icon and is left alone. */
const NAMED_CARD_MEDIA_PX = 56;
/** Above this many covers on a page, bars are not grouped by spot (every pair would be compared). */
const STACK_MAX = 400;
/** A bar counts as clickable where all five of its probe points (centre and four inner ones) lie on it. */
const SPOT_OK = 5;
/** How long a watch-page player covered before its channel row and title arrived is looked at again. */
const TRAILER_WAIT_MS = 15_000;
/** The label's font and side padding, as in the stylesheet (.gsb-bar, and its collapsed line): to measure a label before it is laid out. */
const BAR_FONT = { full: ['500 12px system-ui,sans-serif', 20], line: ['500 11px system-ui,sans-serif', 16] } as const;
/** Address parameters that hold what someone searched for (search engines, sites' own search): they say what the page is about. */
const SEARCH_PARAMS = new Set(['q', 'query', 'search_query', 'search', 'searchterm', 'term', 'text', 'p', 'k', 'keyword', 'keywords', 'keys', 'wd', 'word', 's', '_nkw']);

/** How much of a post or page is read when judging what it is about. */
const POST_READ_CHARS = 4000;
const PAGE_READ_CHARS = 20_000;
/** A chat message counts as part of the talk started by a game mention this many messages back. */
const CHAT_REACH = 8;

/** Media this extension turned the sound off on (a covered video): only those are turned back on. Lives as long as the page. */
const HELD_MUTED = new WeakSet<HTMLMediaElement>();

/** Hides spoilers inside `root`. Holds no copy of the matched text. */
export class Scanner {
  private hidden = new Map<Element, HTMLElement | null>(); // element -> its label bar
  private revealed: WeakSet<Element>;
  /**
   * A label over something that takes up no room (a collapsed panel's rows) is a stray yellow bar.
   * Each label follows the size of what it hides: shown while that has a size, tucked away while it does not.
   */
  private sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
    // All sizes are read first, then the bars written: a write between two reads would lay the page out again.
    const narrow: { bar: HTMLElement; el: Element; w: number; h: number }[] = [];
    for (const e of entries) {
      const bar = this.hidden.get(e.target);
      if (!bar || bar.hasAttribute('data-gsb-icon') || (e.contentRect.width === 0 && e.contentRect.height === 0)) continue;
      // A label wider than what it covers would hang over the page: it becomes the eye button. Only that way, never back, so a
      // unit whose width follows its bar's (both in one row) cannot flip between the two.
      // The label is measured from its words, not laid out: a bar hidden while its unit had no size measures 0 on the page.
      // The physical width: for vertical text the inline size is the unit's height, which would make a 19 px column look wide enough.
      const w = (e.target as HTMLElement).offsetWidth || e.borderBoxSize?.[0]?.inlineSize || e.contentRect.width;
      const wide = bar.hasAttribute('data-gsb-short') ? Infinity : this.labelWidth(this.barName.get(bar) ?? bar.textContent ?? '', bar.hasAttribute('data-gsb-line'));
      if (w < wide || bar.hasAttribute('data-gsb-short')) narrow.push({ bar, el: e.target, w, h: (e.target as HTMLElement).offsetHeight || e.contentRect.height });
    }
    for (const e of entries) {
      const bar = this.hidden.get(e.target);
      if (bar) bar.style.display = (e.contentRect.width === 0 && e.contentRect.height === 0) || (bar.hasAttribute('data-gsb-short') && e.contentRect.height === 0) ? 'none' : '';
    }
    for (const n of narrow) this.narrowBar(n.bar, n.el, n.w, n.h);
    this.settleBars(entries.flatMap((e): [Element, HTMLElement][] => { const bar = this.hidden.get(e.target); return bar ? [[e.target, bar]] : []; }));
    // The page grew or shrank (a banner, a late picture or an ad above a unit): units may have moved without a size change of their own.
    if (entries.some((e) => e.target === this.doc.documentElement || e.target === this.doc.body)) this.queueRefit();
    // Bars changed size or showed (eye buttons, a unit laid out): which ones sit at one spot is looked at again after this.
    this.scheduleStack();
  });
  /**
   * On hover or keyboard focus of a cover's bar: a small tip with the reason and "Change this", which opens the options page at the setting
   * that decides this kind of cover (REASON_ANCHOR). It is made when asked for and goes soon after; its words are not in the page text.
   */
  private addChangeTip(bar: HTMLElement, el: Element, why: Why, reason: string, source: Source | null): void {
    const doc = this.doc;
    const anchor = anchorFor(why, source);
    let tip: HTMLElement | null = null;
    let button: HTMLElement | null = null;
    let timer = 0; // the leave timer
    let wait = 0; // the hover delay
    let watch = 0;
    let skip = false; // Tab came back from the button: the tip stays away until the bar has lost focus
    const focused = () => (bar.getRootNode() as Document | ShadowRoot).activeElement ?? doc.activeElement;
    const onScroll = () => drop();
    const drop = () => {
      window.clearInterval(watch);
      window.clearTimeout(timer);
      window.clearTimeout(wait);
      doc.removeEventListener('scroll', onScroll, true);
      tip?.remove();
      tip = null;
      button = null;
    };
    const hideSoon = () => {
      window.clearTimeout(wait);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!tip) return;
        const a = focused();
        if (!bar.isConnected || !(tip.matches(':hover') || bar.matches(':hover') || a === bar || (!!a && tip.contains(a)))) drop();
      }, 250);
    };
    const open = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      // Only a real press or key: a page script cannot make the extension open its settings.
      if (!e.isTrusted) return;
      drop();
      try { void Promise.resolve(chrome.runtime.sendMessage({ type: 'openSetting', anchor })).catch(() => {}); } catch { /* the extension was reloaded: nothing to open */ }
    };
    const place = (t: HTMLElement) => {
      const r = bar.getBoundingClientRect();
      const win = doc.defaultView;
      const vw = win?.innerWidth ?? 0;
      const vh = win?.innerHeight ?? 0;
      const w = t.offsetWidth || 200;
      let left = r.left;
      let top: number;
      if (bar.hasAttribute('data-gsb-line')) {
        // A collapsed line: the tip beside it, on the same line, never over the line below.
        left = r.right + 6;
        top = r.top;
      } else top = r.bottom + 30 < vh ? r.bottom + 2 : Math.max(0, r.top - 30);
      t.style.setProperty('left', `${Math.max(0, Math.min(left, vw - w - 4))}px`);
      t.style.setProperty('top', `${Math.max(0, top)}px`);
    };
    const show = () => {
      window.clearTimeout(timer);
      if (tip?.isConnected || !bar.isConnected || bar.hasAttribute('data-gsb-stacked')) return;
      const t = doc.createElement('div');
      t.className = 'gsb-tip';
      t.setAttribute('data-reason', reason);
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'gsb-change';
      btn.textContent = 'Change this';
      btn.setAttribute('aria-label', `Change this setting (${reason})`);
      // Tied to its cover for a screen reader (B-039): the button is described by a hidden line in the tip with the reason (our words, never the page's).
      const desc = doc.createElement('span');
      desc.id = `gsb-tip-desc-${++tipIds}`;
      desc.className = 'gsb-sr';
      desc.textContent = reason;
      btn.setAttribute('aria-describedby', desc.id);
      btn.addEventListener('click', open);
      btn.addEventListener('keydown', (k) => {
        if (k.key === 'Escape' || (k.key === 'Tab' && !k.shiftKey)) {
          k.preventDefault();
          if (k.key === 'Escape') k.stopPropagation();
          // skip first: the focus event of the bar fires inside bar.focus() and must not bring the tip back
          skip = true;
          drop();
          bar.focus();
          if (focused() !== bar) skip = false;
        } else if (k.key === 'Tab') {
          k.preventDefault();
          bar.focus();
        }
      });
      BAR_ACTS.set(btn, { click: open });
      guardBars(doc);
      t.append(btn, desc);
      // Outside the page's own tree, in the top layer: no ancestor of the page's (a transform, a filter, a clip) can move or hide it, it is
      // never inside a covered part, and the page's sibling rules and text reads never meet it. In a modal dialog (everything outside it is
      // inert) it goes inside that dialog, still in the top layer.
      const host = bar.closest('dialog:modal, [aria-modal="true"]') ?? doc.documentElement;
      host.append(t);
      try {
        t.setAttribute('popover', 'manual');
        (t as HTMLElement & { showPopover?: () => void }).showPopover?.();
      } catch {
        /* an older browser: it stays a fixed box */
      }
      place(t);
      tip = t;
      button = btn;
      t.addEventListener('pointerleave', hideSoon);
      t.addEventListener('focusout', hideSoon);
      // It does not follow the page: a scroll puts it away.
      doc.addEventListener('scroll', onScroll, true);
      window.clearInterval(watch);
      // A cover shown (its bar gone) takes its tip with it.
      watch = window.setInterval(() => { if (!bar.isConnected) drop(); }, 300);
    };
    // A pointer waits a moment (a pointer passing over a list of bars shows nothing); the keyboard does not.
    bar.addEventListener('pointerenter', (e) => {
      if (!e.isTrusted || skip) return;
      window.clearTimeout(wait);
      wait = window.setTimeout(() => { if (bar.matches(':hover')) show(); }, 350);
    });
    bar.addEventListener('focus', (e) => { if (e.isTrusted && !skip && bar.matches(':focus-visible')) show(); });
    bar.addEventListener('pointerleave', hideSoon);
    bar.addEventListener('blur', () => { skip = false; hideSoon(); });
    bar.addEventListener('keydown', (k) => {
      if (!tip) return;
      if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); drop(); } else if (k.key === 'Tab' && !k.shiftKey && button) {
        button.focus();
        // Only when the focus really went to the button (it cannot in a page that locks focus): else Tab goes on as it would.
        if (doc.activeElement === button) k.preventDefault();
      }
    });
  }

  /** The full label of each bar (its short reason and the eye are made from it). */
  private barName = new WeakMap<HTMLElement, string>();
  /** The label without any hold-to-peek hint or source tag: what the short reason is made from. */
  private barBase = new WeakMap<HTMLElement, string>();
  /** The source tag of a bar ("Strict"), shown after " · " where it fits. */
  private barTag = new WeakMap<HTMLElement, string>();
  /** The short reason a bar draws (with its tag where that fits). */
  private barShort = new WeakMap<HTMLElement, string>();
  /** Bars whose tag is only in the aria-label and the tip (a table, a dialog): never drawn, the short form included. */
  private ariaTagOnly = new WeakSet<HTMLElement>();
  /** `text` with the bar's source tag, if it has one. */
  private tagged(bar: HTMLElement, text: string): string {
    const tag = this.barTag.get(bar);
    return tag ? `${text} · ${tag}` : text;
  }

  /**
   * A label wider than what it covers: at least SHORT_MIN_PX wide and SHORT_MIN_H tall, the reason in a few words inside the cover at its
   * bottom (one line, an ellipsis, the full words in the aria-label); narrower, the eye button. Only ever narrower (full -> short -> eye,
   * never back), so a unit whose width follows its bar's cannot flip. With the reason switched off or a collapsed line: the eye as before.
   */
  private narrowBar(bar: HTMLElement, el: Element, w: number, h: number): void {
    if (bar.hasAttribute('data-gsb-icon')) return;
    const name = this.barName.get(bar) ?? bar.textContent ?? '';
    const collapsed = this.opts.hideMode === 'collapse';
    const short = bar.hasAttribute('data-gsb-short');
    if (!short && w >= this.labelWidth(name, collapsed)) return;
    // The source tag goes first: the full reason without it, when that fits (the aria-label keeps it).
    const tag = this.barTag.get(bar);
    if (!short && tag && name.includes(` · ${tag}`)) {
      const plain = name.replace(` · ${tag}`, '');
      if (w >= this.labelWidth(plain, collapsed)) {
        bar.textContent = plain;
        this.barName.set(bar, plain);
        return;
      }
    }
    // In hold-to-peek mode the hint is part of the label and stays visible: no short form (the eye carries it on hover). A part of a viewer keeps
    // its bar near the top left, where the page's own controls were looked for.
    const hold = (this.opts.revealMode ?? 'click') === 'hold' && this.opts.hideMode === 'blur';
    // A height of 0 is a picture not loaded yet: the short form is tried, and the eye comes if it turns out too low.
    if (this.opts.showReason !== false && !collapsed && !hold && !this.inViewer(el) && el.getClientRects().length <= 1 && w >= SHORT_MIN_PX && (h === 0 || h >= SHORT_MIN_H)) {
      if (!short) {
        const base = this.barBase.get(bar) ?? name;
        const full = this.tagged(bar, shortReason(base));
        bar.setAttribute('data-gsb-short', '');
        // The tag only where it fits; the tip and the aria-label carry it anyway.
        bar.textContent = !this.ariaTagOnly.has(bar) && this.labelWidth(full, true) <= w ? full : shortReason(base);
        this.barShort.set(bar, bar.textContent);
        // The visible words are inside the accessible name (WCAG: label in name).
        bar.setAttribute('aria-label', `${full} (click to show)`);
        this.undecided.set(bar, el);
      }
      bar.style.setProperty('max-width', `${Math.floor(w)}px`);
      return;
    }
    if (short) { bar.removeAttribute('data-gsb-short'); bar.style.removeProperty('max-width'); bar.textContent = this.barName.get(bar) ?? name; bar.setAttribute('aria-label', `${this.tagged(bar, this.barBase.get(bar) ?? name)} (click to show)`); }
    this.iconBar(bar);
  }

  /** The eye button in place of the label: its words stay for screen readers. */
  private iconBar(bar: HTMLElement): void {
    if (!bar.hasAttribute('aria-label')) bar.setAttribute('aria-label', bar.textContent ?? '');
    bar.setAttribute('data-gsb-icon', '');
  }
  private pageContext = false;
  /** The page's own verdict, and the one told by the top page when this is a frame inside it. */
  private ownContext = false;
  private outerContext = false;
  /** The page stopped being about the game, but only since the last page check: its covers stay on until the next. */
  private offPending = false;
  /** A turn to "not about the game" is waiting for its second look (see setContext): the caller looks again soon, without waiting for another change of the page. */
  get contextPending(): boolean { return this.offPending; }
  /** Per block: how many headings it held last time, and which of them name the game. */
  private headings = new WeakMap<Element, { n: number; pass: number; ok: boolean; naming: Element[] }>();
  private pass = 0;
  /** Set while a block is re-read because its heading turned up late: texts are looked at again even if unchanged. */
  private forceJoin = false;
  /** Joined-text length last checked per block, so an unchanged block is not matched twice. */
  private joined = new WeakMap<Element, number>();
  /** The scan pass, cover count and context generation at which each block was last joined. */
  private joinedPass = new WeakMap<Element, { pass: number; changes: number; gen: number }>();
  /** Per post: whether it is about the game, and the text length that answer was based on. */
  private about = new WeakMap<Element, { len: number; why: Why | null }>();
  /** Posts holding a weak term that nothing has qualified yet; re-checked if a game mention arrives later. */
  private waiting = new WeakSet<Element>();
  /** Per post: text length at which the "game plus spoiler word" rule was last tried. */
  /** Chat lines judged with a spoiler word but no game mention in reach yet. */
  private awaitingMention = new WeakSet<Element>();
  private spoilTried = new WeakMap<Element, number>();
  private spoilPass = new WeakMap<Element, { pass: number; changes: number; gen: number }>();
  /** Goes up each time the page context changes: a block or post judged under the old one is read again, even if unchanged. */
  private contextGen = 0;
  private bodyAbout = false;
  private bodyCheckedAt = 0;
  private bodyKey = '';
  private bodyMain: Element | null = null;
  /** Per comment hidden "own content only": the elements marked on the way down to its replies. */
  private marks = new Map<Element, Set<Element>>();
  /** Comments that could not be opened up safely (loose text beside the replies); they stay hidden whole. */
  private whole = new WeakSet<Element>();
  private rescanning = new WeakSet<Element>();
  private shadowSeen = new WeakSet<ShadowRoot>();
  /** Custom elements read before their definition arrived: they may get a shadow root without any change the page watcher sees. */
  private undefinedHosts = new Set<Element>();
  /** The main post of a flat thread page, looked up once per scan pass. */
  private mc: { n: number; el: Element | null; key: string | null; names?: boolean; namesPass: number } | null = null;
  /** A main post just found that holds its comments, not read whole yet (it became one when its first comment arrived): see scan. */
  private mainFresh: Element | null = null;
  /** The site's cards without `threadCards`, and whether these are in `containers` now (see syncCards). */
  private baseCards: string | undefined;
  private threadCardsOn = false;
  /** The main post's block in its list, and the list: the replies are the blocks after it. */
  private anchor: { cell: Element; parent: Element | null } | null = null;
  /** Blocks of that list known to be in the run after the main post, and known to be outside it. */
  /** A post turned up inside the block taken for the main post's own (it grew after it was worked out): see inRun. */
  private anchorStale = false;
  /** Blocks of the list judged to end the replies; one that stops being a boundary (it got a card) is judged again. */
  private ended = new WeakSet<Element>();
  private run = new WeakSet<Element>();
  private out = new WeakSet<Element>();
  /** The thread whose replies are covered now, so replies arriving after the main post is unmounted are still covered. */
  private coverKey: string | null = null;
  /** Threads whose main post the user showed: it is not hidden or covered again on them. */
  private revealedThreads = new Set<string>();
  /**
   * Where the comments are named (Facebook), whose main post rule takes any top post box: the post the person showed whole, with its thread and
   * whether it sat in a dialog. Only it (or the post the site builds again in its place) stays shown, not another post box at the same address.
   */
  private shownMain: { el: Element; key: string; dialog: boolean } | null = null;
  /** The picture settings in full: what the content script resolved, the bare scanner's value for any left out. */
  private pics: Pictures;

  constructor(
    private doc: Document,
    private matcher: Matcher,
    private opts: ScanOptions,
  ) {
    // A value given as undefined counts as left out.
    this.pics = { ...BARE_PICTURES, ...Object.fromEntries(Object.entries(opts.pictures).filter(([, v]) => v !== undefined)) };
    if (!doc.getElementById(STYLE_ID)) {
      const st = doc.createElement('style');
      st.id = STYLE_ID;
      (doc.head ?? doc.documentElement).append(st);
    }
    // Always rewritten, so a restart with a new blur strength takes effect.
    const style = doc.getElementById(STYLE_ID);
    if (style) style.textContent = cssFor(opts.blur);
    this.revealed = opts.keepRevealed ?? new WeakSet();
    this.baseCards = opts.containers;
    if (opts.swallowClicks) doc.documentElement.setAttribute(EAT_ATTR, '');
    else doc.documentElement.removeAttribute(EAT_ATTR);
  }

  /** `threadCards` are cards on a thread page only: added to the cards when the address is one, taken out when it is not. */
  private syncCards(): void {
    const extra = this.opts.threadCards;
    if (!extra || !this.baseCards) return;
    const on = this.threadKey() !== null;
    if (on === this.threadCardsOn) return;
    this.threadCardsOn = on;
    this.opts.containers = on ? `${this.baseCards}, ${extra}` : this.baseCards;
  }

  /** Goes up whenever a cover is put on or taken off, so the page watcher re-reads them for screen readers only then. */
  changes = 0;

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
    // The three tags in one search of the page (asked on every pass; a page without them was searched to the end three times).
    const metas = [...d.querySelectorAll('meta[name="description"], meta[property="og:title"], meta[property="og:description"]')];
    const meta = (sel: string) => metas.find((m) => m.matches(sel))?.getAttribute('content') ?? '';
    // The path, and of the query only what someone searched for: a referrer or tracking parameter (?ref=, ?utm_...) is not what
    // the page is about. A path that will not decode ("/50%-off") is read as it is.
    const asked = [...new URLSearchParams(d.location?.search ?? '')].filter(([k]) => SEARCH_PARAMS.has(k.toLowerCase())).map(([, v]) => v);
    const address = `${safe(d.location?.pathname ?? '')} ${asked.join(' ')}`;
    const title = this.realTitle && d.title === this.realTitle.label ? this.realTitle.title : d.title;
    const self = [title, this.headingText(d.querySelector('h1')), meta('meta[name="description"]'), meta('meta[property="og:title"]'), meta('meta[property="og:description"]'), address].join(' ');
    const pending = this.offPending;
    this.setContext({ own: this.matcher.marksPage(self) || this.articleAbout() });
    // Still not about the game one pass later: now the page covers come off (a quick turn back never shows them).
    if (pending && this.offPending) {
      this.offPending = false;
      this.pageContext = false;
      this.contextChanged(false);
    }
    return this.ownContext || this.outerContext;
  }

  /**
   * The page this frame sits in (the top page) is, or is not, about the game. A frame cannot read it
   * across origins, so it is told. When that turns the frame's own answer to yes, the frame is read again.
   */
  setOuterContext(about: boolean): void {
    this.setContext({ outer: about });
  }

  /**
   * The one way the page context is set: from the page itself, from the top page, or both. A turn to "not about
   * the game" after the first scan only waits here; the next page check makes it count, if it still holds.
   */
  private setContext(next: { own?: boolean; outer?: boolean }): void {
    const was = this.pageContext;
    this.ownContext = next.own ?? this.ownContext;
    this.outerContext = next.outer ?? this.outerContext;
    const now = this.ownContext || this.outerContext;
    this.offPending = was && !now && this.pass > 0;
    if (this.offPending) return;
    this.pageContext = now;
    if (was !== now) this.contextChanged(now);
  }

  /**
   * The page has turned out to be about the game: weak terms read earlier now count, so everything is read again.
   * Every turn counts, also a second one on a single-page site. Before the first scan there is nothing read yet
   * to read again (a frame told at its start). No longer about the game: what was hidden only because of the page
   * (label "page") comes off, and the page is read again, since another rule may still hide it or what it held.
   */
  private contextChanged(about: boolean): void {
    if (!this.pass) return;
    if (!about) {
      let off = false;
      for (const [el, bar] of this.hidden) {
        // Covers that rested on the page being about the game: the page cover itself, and a picture or a result's picture beside it. What
        // stands by its own words (a name next to the picture, a post that names the game) is covered again by the read below.
        const why = el.getAttribute('data-gsb-why');
        if (why !== 'page' && why !== 'near-game' && why !== 'media') continue;
        if (this.revealed.has(el)) continue;
        this.uncoverEl(el, bar);
        off = true;
      }
      if (!off) return;
      this.changes++;
    }
    this.rescanAll();
  }

  /**
   * The page's context changed: everything already read is read again, inside the shadow roots too. A parent scan
   * never enters a root it has seen, so the known ones are scanned on their own (once each: not those found just now).
   */
  private rescanAll(): void {
    this.contextGen++;
    const known = shadowRoots().filter((r) => this.shadowSeen.has(r));
    if (this.doc.body) this.scan(this.doc.body);
    for (const r of known) this.scan(r);
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
    this.hide(this.containerFor(parent), this.settleStrict(res, parent), 'heading', at);
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
    if (this.opts.containers) return false;
    const main = this.doc.querySelector('article, main, [role="main"]') ?? this.doc.body;
    // Which article this is: its box, the address, the title and heading. Text that only goes (a page dropping what scrolled
    // away) keeps the answer; another article in its place (a single-page site moving on) is read at once.
    const key = `${this.doc.location?.href ?? ''}\n${this.doc.title}\n${this.doc.querySelector('h1')?.textContent?.trim() ?? ''}`;
    const same = key === this.bodyKey && main === this.bodyMain;
    if (same && this.bodyAbout) return true;
    const now = Date.now();
    if (same && now - this.bodyCheckedAt < 1500) return this.bodyAbout;
    this.bodyCheckedAt = now;
    this.bodyKey = key;
    this.bodyMain = main;
    const f = this.matcher.inspect(main ? this.textOf(main, PAGE_READ_CHARS) : '');
    // Several mentions, and often enough that it is the subject and not one story among many.
    this.bodyAbout = f.mentions >= 3 && f.mentions * 400 >= f.words;
    return this.bodyAbout;
  }

  scan(root: Node): void {
    this.syncCards();
    this.scanRoot(root);
    // A main post that holds its comments became one only now (its first comment arrived), outside what was read: read it whole too.
    const fresh = this.freshToRead;
    this.freshToRead = null;
    if (fresh?.isConnected) this.scanRoot(fresh);
  }

  /** See scan: a fresh main post outside the root just read. */
  private freshToRead: Element | null = null;

  private scanRoot(root: Node): void {
    // A box can become a post only when its last piece arrives (Bluesky search: a post is the box holding its like button, which
    // can come after the words and pictures): when that piece lands, the whole post is read, now as a post.
    const maker = this.opts.postMaker;
    if (maker && this.opts.containers && root.nodeType === 1 && ((root as Element).matches(maker) || (root as Element).querySelector(maker))) {
      const card = (root as Element).closest(this.opts.containers!);
      if (card && card !== root) root = card;
    }
    this.pass++;
    this.rejudge(root);
    if (root.nodeType === 1) this.coverLateInDialog(root as Element);
    if (this.opts.main) {
      this.syncCover(root);
      // A main post that holds its comments became one only now (its first comment arrived): read it whole once, its picture by its caption.
      // A root inside it is widened to it; a root elsewhere (or a text) is read as it is, and the post after it (see scan).
      const fresh = this.mainFresh;
      this.mainFresh = null;
      if (fresh?.isConnected && !root.contains(fresh) && fresh !== root) {
        if (root.nodeType === 1 && fresh.contains(root)) root = fresh;
        else this.freshToRead = fresh;
      }
      this.coverNew(root);
    }
    if (root.nodeType === 3) {
      this.checkText(root as Text);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    // A new child of a comment hidden "own content only" is covered by the stylesheet alone: screen readers need telling.
    if (root.nodeType === 1 && (root as Element).parentElement?.matches('[data-gsb-own], [data-gsb-in]')) this.changes++;
    if (root.nodeType === 1 && this.flagged) {
      // A rescan of the whole page reaches replies no single added node announced: look under every hidden thread.
      if (root === this.doc.body) for (const h of [...this.hidden.keys()]) if (h.matches(this.opts.threads!)) this.openAll(h);
      this.adopt(root as Element);
    }
    if (this.opts.accounts?.size) this.checkLinks(root as Element | Document | DocumentFragment);
    if (this.pics.hideImages && root.nodeType === 1) this.readSizes(root as Element);
    const walker = this.doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) this.checkText(n as Text);
    this.enterShadows(root as Element | Document | DocumentFragment);
    if (this.pics.hideImages && root.nodeType === 1) {
      const el = root as Element;
      this.liftCleanGif(el);
      if (el.matches('img, video')) this.checkMedia(el);
      el.querySelectorAll('img, video').forEach((m) => this.checkMedia(m));
      this.bgPictures(el).forEach((m) => this.checkMedia(m));
      this.thumbBoxes(el).forEach((m) => this.checkMedia(m));
    } else if (this.pics.hideImages) {
      (root as ParentNode).querySelectorAll?.('img, video').forEach((m) => this.checkMedia(m));
      this.bgPictures(root as ParentNode).forEach((m) => this.checkMedia(m));
      this.thumbBoxes(root as ParentNode).forEach((m) => this.checkMedia(m));
    }
  }

  /** Text drawn inside open shadow roots is read too; each new root is handed to the page watcher (content.ts) to observe. */
  private enterShadows(root: Element | Document | DocumentFragment): void {
    const hosts = root.nodeType === 1 && (root as Element).shadowRoot ? [root as Element] : [];
    for (const el of [...hosts, ...root.querySelectorAll('*')]) {
      const sr = el.shadowRoot;
      if (sr && this.takeRoot(sr)) this.scan(sr);
    }
    // A custom element not defined yet gets its shadow root when the page's code arrives, and the page watcher sees no change
    // then (about one load in eight left a chat spoiler showing). Kept here so lateShadows can look again.
    if (root.nodeType === 1 && (root as Element).matches(':not(:defined)')) this.undefinedHosts.add(root as Element);
    root.querySelectorAll(':not(:defined)').forEach((el) => this.undefinedHosts.add(el));
  }

  /** A shadow root not seen before is noted and handed to the page watcher; false when it was already known. */
  private takeRoot(sr: ShadowRoot): boolean {
    if (this.shadowSeen.has(sr)) return false;
    this.shadowSeen.add(sr);
    ROOTS.add(sr);
    this.opts.onShadowRoot?.(sr);
    return true;
  }

  /** Whether some custom element is still waiting for its definition (content.ts keeps calling lateShadows meanwhile). */
  get lateWaiting(): boolean {
    return this.undefinedHosts.size > 0;
  }

  /**
   * Shadow roots that appeared on elements already read, for the caller to scan. Normally only the elements that were waiting
   * for their definition are looked at; `everywhere` also looks at every element on the page, for a defined element that
   * attaches its root later (a few times per page only: it reads every element).
   */
  lateShadows(everywhere = false): ShadowRoot[] {
    const found: ShadowRoot[] = [];
    for (const el of this.undefinedHosts) {
      if (el.shadowRoot && this.takeRoot(el.shadowRoot)) found.push(el.shadowRoot);
      if (!el.isConnected || el.matches(':defined')) this.undefinedHosts.delete(el);
    }
    if (everywhere) {
      for (const r of [this.doc, ...shadowRoots()]) for (const el of r.querySelectorAll('*')) if (el.shadowRoot && this.takeRoot(el.shadowRoot)) found.push(el.shadowRoot);
    }
    return found;
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
    if (this.opts.bio && this.opts.people && parent.closest(this.opts.people) && parent.closest(this.opts.bio)) {
      this.checkBio(parent);
      return;
    }
    if (this.opts.names && this.inNames(parent) && !(this.opts.bio && parent.closest(this.opts.bio))) {
      this.checkName(parent);
      return;
    }
    if (this.skip(parent)) return;
    // "GTA" and "6" in separate tags are each too short to match. Still read the block once.
    if (text.trim().length < 3) {
      this.checkJoined(parent);
      return;
    }
    const found = this.matcher.inspect(text);
    // A chat line that names the game, arriving after the lines below it (history scrolled in above, a virtual list): the lines it reaches are read again (B-036).
    if (this.opts.chat && found.context && !this.pics.thumbsOnly) this.rejudgeAfterMention(parent);
    if (this.pics.thumbsOnly) {
      // Pictures only: words are never covered, but the game's name still marks the pictures beside it.
      this.relook(parent, found);
      return;
    }
    const res = this.matcher.decide(found, this.pageContext, this.pageContext);
    if (res) {
      this.hide(this.containerFor(parent), this.settleStrict(res, parent), found.strong.size ? 'alone' : found.context ? 'mention' : 'page', parent);
      return;
    }
    if (found.context && !this.pageContext && this.matcher.judgesPosts && parent.closest(HEADING_SELECTOR)) this.headingArrived(parent);
    if (this.headingHide(parent, found, parent)) return;
    // The game's name has just turned up: pictures beside it that were looked at earlier are looked at again.
    this.relook(parent, found);
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
    // Already tried in this pass with nothing covered or shown since: the post reads the same, so the answer is the same no.
    const seen = this.spoilPass.get(post);
    if (seen && seen.pass === this.pass && seen.changes === this.changes) return false;
    this.spoilPass.set(post, { pass: this.pass, changes: this.changes, gen: this.contextGen });
    const cards = this.opts.containers;
    // A site post is judged on its own words: the replies nested inside it are posts in their own right.
    const own = cards && post.matches(cards) ? this.ownText(post, cards) : this.textOf(post, POST_READ_CHARS);
    const text = `${own} ${this.unseenText(post)}`;
    if (seen?.gen === this.contextGen && this.spoilTried.get(post) === text.length) return false;
    this.spoilTried.set(post, text.length);
    const f = this.matcher.inspect(text);
    // In a part that is not the page's subject (a recommendation beside a trailer) the page does not lend it the game: it needs its
    // own. Except for a story word ("ending", "dies"): beside a page about the game it is taken as about the game too.
    const apart = !!this.opts.apart && !!post.closest(this.opts.apart);
    const page = this.pageContext && (!apart || f.spoil.has('story'));
    if (!f.spoil.size) return false;
    const about = !!(f.context || page || this.repliesToMention(post));
    // In a chat a recent mention of the game in the visible lines is the context for a later line that holds a spoiler word of its own
    // ("all endings explained"), with no listed name in it (answer f01).
    if (!about && !(this.opts.chat && this.followsMention(post))) {
      // A chat line with a spoiler word and no mention yet: a mention that turns up above it later covers it (rejudgeAfterMention).
      if (this.opts.chat) this.awaitingMention.add(post);
      return false;
    }
    this.declined = false;
    this.hide(post, { categories: [...f.spoil], custom: false }, about ? 'spoiler-word' : 'chat', el);
    return !this.declined;
  }

  /**
   * Words a post carries without showing them: picture and video descriptions, and the hashtags
   * and searches its links point at (a link to /hashtag/GTA6 names the game even when drawn as an icon).
   */
  /** Our own bar, tip and button: their words (the reason, "Change this") are never the page's. */
  private ownUi(el: Element): boolean {
    return el.classList.contains('gsb-bar') || !!el.closest('.gsb-tip, .gsb-change');
  }

  private unseenText(post: Element, basicOnly = false): string {
    let out = '';
    const els = post.querySelectorAll('img[alt], [aria-label], a[href*="hashtag"], a[href*="/search"], a[href*="/tag/"]');
    const cards = this.opts.containers;
    const nested = !!cards && post.matches(cards) && !!post.querySelector(cards);
    for (let i = 0; i < els.length && i < 60 && out.length < 1500; i++) {
      const el = els[i]!;
      // Our own eye button's words are not the post's.
      if (isEmote(el) || this.isOff(el) || this.ownUi(el)) continue;
      // Leave out what belongs to a reply nested inside this post.
      if (nested && el.closest(cards!) !== post) continue;
      out += ` ${el.getAttribute('alt') ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
      const href = el.tagName === 'A' ? el.getAttribute('href') : null;
      if (href) out += ` ${safe(href).replace(/[/?&=#_+-]+/g, ' ')}`;
    }
    if (basicOnly) return out;
    // Community, wiki and account links (/r/GAME6unmoderated, /wiki/Grand_Theft_Auto_VI, /GAME6news) and the title of a link or
    // picture count only when they name the game itself: a listed name, an unusual name or a place in an account name, a page
    // path or a title adds nothing (an author link to /user/<name> must not cover a post's pictures).
    const more = post.querySelectorAll('a[href], img[title]');
    for (let i = 0, n = 0; i < more.length && i < 200 && n < 40 && out.length < 2000; i++) {
      const el = more[i]!;
      if (this.isOff(el) || this.ownUi(el) || (nested && el.closest(cards!) !== post)) continue;
      const title = el.getAttribute('title') ?? '';
      const path = el.tagName === 'A' ? linkPath(el.getAttribute('href') ?? '') : '';
      if (!title && !path) continue;
      n++;
      for (const w of [title, path]) if (w && this.matcher.namesGame(w)) out += ` ${w}`;
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
        this.declined = false;
        this.hide(post, this.settleStrict(pending, el), why, el);
        return !this.declined;
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
        this.hide(up, this.settleStrict(res, up), 'mention');
      }
    }
    return false;
  }

  /**
   * A match only Strict covers (MatchResult.byStrict), in a post that Medium covers too as a whole (two names, a hint word, a reply to
   * a post about the game): Medium would make the same cover, so Strict is not its source. Only asked when covers carry a source.
   */
  private settleStrict(res: MatchResult, at: Element): MatchResult {
    if (res.byStrict && this.opts.coverSource && this.postAbout(this.containerFor(at))) return { ...res, byStrict: false };
    return res;
  }

  /** The listed account a cover for a spoiler account was made for: one the person added, when any link that decides it is theirs. */
  private accountOf(at: Element | undefined): string | null {
    if (!at) return null;
    const own = this.opts.coverSource?.ownAccounts;
    const key = at.matches('a[href]') ? accountKey((at as HTMLAnchorElement).href) : null;
    if (!own?.size || (key && own.has(key))) return key;
    const row = this.opts.ownPage ? at.closest(this.opts.ownPage.owner) : null;
    for (const l of row?.querySelectorAll('a[href]') ?? []) {
      const k = accountKey((l as HTMLAnchorElement).href);
      if (k && own.has(k)) return k;
    }
    return key;
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
    // With no site rule, a paragraph inside an article is not a reply to it: only a post nested inside another post is (a comment
    // list item inside an article). Without this one mention in a long article made every later paragraph with a weak name a "reply".
    if (!this.opts.containers && !post.matches(sel)) return this.followsMain(post);
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
    // The query only for a pattern that names one (Facebook's permalink.php?story_fbid=): the other sites' keys stay the path's.
    const m = re.exec(re.source.includes('\\?') ? path + (this.doc.location?.search ?? '') : path);
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
    // Where the comments are named (Facebook), whose rule takes any top post box: the main post stays while it is there and still one (same
    // thread), so a post box that lands later (a suggested post) does not end its cover.
    if (!need && c!.n === 1 && this.opts.replies) return;
    if (!need && root) {
      const scope = root.nodeType === 1 || root.nodeType === 9 || root.nodeType === 11 ? (root as ParentNode) : null;
      if (scope) {
        if (root.nodeType === 1 && (root as Element).matches(sel) && root !== c!.el) need = true;
        // No main post yet, on a site whose post holds its comments: its first comment, landing inside it, makes it one (Instagram's live page).
        // Only the block where the main post would be is tried (mainBlock): not every block up the page, each a :has over its subtree.
        else if (c!.n === 0 && this.opts.mainBlock && root.nodeType === 1 && (root as Element).parentElement?.closest(this.opts.mainBlock)?.matches(sel)) need = true;
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
    // A new main post: where its list of replies starts is worked out again.
    if (el && el !== was) this.setAnchor(el);
    if (el && el !== was && this.opts.commentsInside) this.mainFresh = el;
  }

  /**
   * Where the main post's list of replies starts: the highest block around it that holds no other post. Worked out again when a post turns
   * up inside that block (a page that was still being read: the comments had not arrived yet), see inRun.
   */
  private setAnchor(el: Element): void {
    const cards = this.opts.containers;
    let cell: Element = el;
    // Never out of a dialog the post opened in (Instagram's post over the feed): the page under it is not its replies.
    const stop = (p: Element) => p === this.doc.body || p.matches('[role="dialog"]') || !!(cards && this.holdsOther(p, el, cards));
    while (cell.parentElement && !stop(cell.parentElement)) cell = cell.parentElement;
    this.anchor = { cell, parent: cell.parentElement };
    this.anchorStale = false;
    this.ended = new WeakSet();
    this.run = new WeakSet();
    this.out = new WeakSet();
  }

  /** Does `a` hold a site post other than `el` (and anything inside it)? */
  private holdsOther(a: Element, el: Element, cards: string): boolean {
    const all = a.querySelectorAll(cards);
    for (let i = 0; i < all.length; i++) if (all[i] !== el && !el.contains(all[i]!) && !all[i]!.contains(el)) return true;
    return false;
  }

  /** A block of the thread's list that ends the replies: it has a heading and holds no post ("Discover more"). */
  private isBoundary(c: Element): boolean {
    const end = this.opts.threadEnd;
    const cards = this.opts.containers;
    if (end && (c.matches(end) || (!!c.querySelector(end) && !(cards && [...c.querySelectorAll(cards)].some((x) => !x.closest(end)))))) return true;
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
    if (a === cell) {
      // A post inside the main post's block that is not the main post: the block was worked out too early (see setAnchor).
      const m = this.mc?.el;
      if (m && post !== m && !m.contains(post) && !post.contains(m) && this.opts.containers && post.matches(this.opts.containers)) this.anchorStale = true;
      return false;
    }
    if (!a) return false;
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
      if (state && this.isBoundary(chain[i]!)) { state = false; this.ended.add(chain[i]!); }
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
    // A reply the user showed stays shown, as it does for its own hide. A post of the feed that ends the thread is not one of its replies.
    if (this.revealed.has(post) || (this.opts.threadEnd && post.closest(this.opts.threadEnd))) return;
    if (this.hidden.has(post)) this.uncoverEl(post);
    post.setAttribute('data-gsb-under', this.opts.hideMode);
    this.changes++;
  }

  private strip(): void {
    this.coverKey = null;
    this.doc.querySelectorAll('[data-gsb-under]').forEach((e) => e.removeAttribute('data-gsb-under'));
    this.changes++;
  }

  /** Cover the posts in `el` (a block of the run) that are not covered yet. */
  private coverIn(el: Element): void {
    const cards = this.opts.containers!;
    if (el.matches(cards) && !el.hasAttribute('data-gsb-under')) this.cover(el);
    el.querySelectorAll(cards).forEach((p) => { if (!p.hasAttribute('data-gsb-under')) this.cover(p); });
  }

  /**
   * The main post is not hidden whole but its picture is (a picture-only post: only the picture is covered, the author row stays): for the
   * replies under it that is the same, they stay covered (people describe a spoiler picture in plain words there, which no list can catch).
   */
  private holdsPictureCover(main: Element): boolean {
    const cards = this.opts.containers;
    // Not under "pictures only", which never covers words, replies included.
    if (!cards || this.pics.thumbsOnly) return false;
    // A post that holds its comments (Instagram): its picture covered for the game named next to it counts too, else the comments beside the
    // covered picture stay in view. Any picture of the post that is not in a comment (a carousel's slide is a card of its own).
    // Otherwise only where a picture-only post is covered by its picture.
    // Where the comments are named (Facebook): only a picture-only post's cover, which needs a page about the game (near-game covers a picture
    // beside the game's name on any page).
    const inside = this.opts.commentsInside;
    if (inside) {
      const whys = this.opts.replies ? '[data-gsb][data-gsb-why="media"]' : '[data-gsb][data-gsb-why="media"], [data-gsb][data-gsb-why="near-game"]';
      for (const h of main.querySelectorAll(whys)) if (!h.closest(inside) && !this.revealed.has(h)) return true;
      return false;
    }
    if (!this.opts.mediaPostPictures) return false;
    for (const h of main.querySelectorAll('[data-gsb][data-gsb-why="media"]')) if (h.closest(cards) === main && !this.revealed.has(h)) return true;
    return false;
  }

  /** A comment inside the main post, on a site whose posts hold their comments (Instagram): covered with it like a reply that follows it. */
  private inMain(post: Element): boolean {
    const main = this.mc?.el;
    const sel = this.opts.commentsInside;
    return !!sel && !!main && post !== main && main.contains(post) && post.matches(sel);
  }

  /** Cover the comments inside the main post that are not covered yet. */
  private coverInMain(): void {
    const main = this.mc?.el;
    const sel = this.opts.commentsInside;
    if (main && sel) main.querySelectorAll(sel).forEach((p) => { if (!p.hasAttribute('data-gsb-under')) this.cover(p); });
  }

  /** Did the person show this main post (`el`) on thread `key`? Per thread; where the comments are named (Facebook), per post (see shownMain). */
  private mainShown(el: Element | null | undefined, key: string): boolean {
    if (!this.opts.replies) return this.revealedThreads.has(key);
    const s = this.shownMain;
    if (!s || !el || s.key !== key) return false;
    return el === s.el || (!s.el.isConnected && el === this.mc?.el && !!el.closest('[role="dialog"]') === s.dialog);
  }

  /** The main post is hidden: cover what follows it in its list, up to the first boundary. */
  private startCover(): void {
    const key = this.threadKey();
    const cell = this.anchor?.cell;
    if (!this.opts.containers || key === null || !cell || this.opts.hideReplies === false || this.mainShown(this.mc?.el, key)) return;
    this.ensureAnchor();
    this.coverKey = key;
    // A post that holds its comments (Instagram): those are its replies, and what follows it (more posts) is not.
    if (this.opts.commentsInside) this.coverInMain();
    else for (let c = this.anchor!.cell.nextElementSibling; c && this.inRun(c); c = c.nextElementSibling) this.coverIn(c);
  }

  /** Is `post` one of the replies covered with the main post: a comment inside it where it holds its comments, else one of the run after it? */
  private underMain(post: Element): boolean {
    return this.opts.commentsInside ? this.inMain(post) : this.inRun(post);
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
    if (!c || key === null || c.n > 1 || this.opts.hideReplies === false || this.mainShown(c.el, key)) {
      // The comments under the cover were not judged while it stood: they are now.
      if (marked) this.uncover();
      return;
    }
    if (c.el) {
      if (!this.hidden.has(c.el) && !this.holdsPictureCover(c.el)) { if (marked) this.uncover(); return; }
      this.ensureAnchor();
      if (this.coverKey !== key) { this.uncover(); this.startCover(); }
    } else if (marked && this.coverKey !== key) this.uncover();
  }

  /** Posts that arrive (or are scanned) while the main post is hidden are covered too, if they sit in the run. */
  private coverNew(root: Node): void {
    if (this.coverKey === null || !this.opts.containers) return;
    const cards = this.opts.containers;
    const el = root.nodeType === 1 ? (root as Element) : root.parentElement;
    // Comments inside the main post (not all of them are site cards): something landed in it, or it landed, so look in it again.
    if (this.opts.commentsInside) {
      const main = this.mc?.el;
      if (main && el && (main.contains(el) || el.contains(main))) this.coverInMain();
      return;
    }
    this.fixAnchor(root);
    const near = el?.closest(cards);
    if (near && !near.hasAttribute('data-gsb-under') && this.underMain(near)) this.cover(near);
    if (root.nodeType === 3) return;
    const found: Element[] = [];
    if (root.nodeType === 1 && (root as Element).matches(cards) && root !== near) found.push(root as Element);
    (root as ParentNode).querySelectorAll?.(cards).forEach((x) => found.push(x));
    for (const x of found) if (!x.hasAttribute('data-gsb-under') && this.underMain(x)) this.cover(x);
    // A reply turned up inside the block taken for the main post's own: work that out again, and cover what the run now holds.
    if (this.anchorStale) this.fixAnchor(root);
  }

  /**
   * The page was read before the replies arrived: the block taken for the main post's own held them (or a block judged to end the replies
   * was still empty). Work it out again and cover what the run now holds.
   */
  private fixAnchor(root: Node): void {
    const m = this.mc?.el;
    if (!m || this.coverKey === null) return;
    if (!this.anchorStale) {
      // A reply that arrives in a block judged to end the replies while it was empty (a heading and nothing else yet).
      const cards = this.opts.containers;
      const parent = this.anchor?.parent;
      const el = root.nodeType === 1 ? (root as Element) : root.parentElement;
      const card = cards ? el?.closest(cards) ?? (el?.querySelector(cards) ?? null) : null;
      let a: Element | null = card;
      while (a && a.parentElement !== parent) a = a.parentElement;
      if (!a || !this.ended.has(a) || this.isBoundary(a)) return;
      this.ended = new WeakSet();
      this.run = new WeakSet();
      this.out = new WeakSet();
      this.startCover();
      return;
    }
    this.startCover();
  }

  /**
   * The block taken for the main post's own must hold no other post. When it does (the page was read before the replies arrived), it is worked
   * out again, and what the too wide block had covered (a post beside the thread) is let go and judged on its own.
   */
  private ensureAnchor(): void {
    const m = this.mc?.el;
    const cell = this.anchor?.cell;
    const cards = this.opts.containers;
    if (!m || !cell || !cards) return;
    // Also when the main post was moved out of the block (a wrapper added around it).
    if (!this.anchorStale && !(cell.isConnected && this.holdsOther(cell, m, cards)) && !(m.isConnected && !cell.contains(m))) return;
    if (this.coverKey !== null) this.uncover();
    this.setAnchor(m);
  }

  /** The main post was shown again: its replies are uncovered and judged on their own. */
  private uncover(): void {
    this.coverKey = null;
    const posts = [...this.doc.querySelectorAll('[data-gsb-under]')];
    posts.forEach((p) => p.removeAttribute('data-gsb-under'));
    this.changes++;
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
    return !!el && (this.isOffPart(el) || this.inNames(el));
  }

  /** Inside a page part the user switched off (not the names: a spoiler account's link in a person card still covers). */
  private isOffPart(el: Element): boolean {
    const sel = this.opts.offParts;
    if (!sel) return false;
    try {
      return !!el.closest(sel);
    } catch {
      return false; // a selector the browser does not know: the switch does nothing
    }
  }

  /**
   * A person's display name or handle, or anything of a person card (a bio is judged apart, see checkBio): they are never matched against
   * the list, however alike a real person's name is to a character's.
   */
  private inNames(el: Element): boolean {
    const o = this.opts;
    if (!o.names && !o.people) return false;
    try {
      return !!el.closest([o.names, o.people].filter(Boolean).join(', '));
    } catch {
      return false;
    }
  }

  /** The bio of a person card: judged on its own words, and only a high-risk signal (a story spoiler word beside a list name) covers the card. */
  private checkBio(parent: Element): void {
    if (this.pics.thumbsOnly) return; // pictures only: words are never covered
    if (SKIP_TAGS.has(parent.tagName.toUpperCase()) || (parent as HTMLElement).isContentEditable || this.skip(parent, true)) return;
    // The whole bio at once: emoji, @mentions and hashtags split it into pieces, and the name and the story word may sit in different ones.
    const bio = parent.closest(this.opts.bio!) ?? parent;
    const text = ` ${bio.textContent ?? ''} ${this.unseenText(bio, true)}`;
    if (this.bioTried.get(bio) === text.length) return;
    this.bioTried.set(bio, text.length);
    const found = this.matcher.inspect(text);
    if (!found.spoil.size || !(found.strong.size || found.weak.size || found.context)) return;
    // The game's name beside a spoiler word has no name of its own to decide on: it is covered as a spoiler phrase, like a post.
    const decided = this.matcher.decide(found, true, true);
    if (!decided && !this.matcher.judgesPosts) return;
    this.hide(this.containerFor(parent), decided ?? { categories: [...found.spoil], custom: false }, 'spoiler-word', parent);
  }

  /**
   * A display name or handle: a name by itself is never matched (a real person may share a first name with a character), but a name written as
   * a spoiler (a troll renaming an account to "<name> dies in <game>") is high risk like a bio: a story spoiler word beside a list name or the
   * game's name, or a name that hides alone beside the game's name or a spoiler word. It covers the post or card, as a spoiler account does.
   */
  private checkName(parent: Element): void {
    if (this.pics.thumbsOnly) return;
    if (SKIP_TAGS.has(parent.tagName.toUpperCase()) || (parent as HTMLElement).isContentEditable || this.skip(parent, true)) return;
    if (!this.matcher.judgesPosts) return; // Light: words are not judged as spoiler phrases
    const row = (this.opts.names && parent.closest(this.opts.names)) || parent;
    // The pieces with a space between them: the display name and the handle run together in textContent, and a handle is only stripped after a space.
    let text = ' ';
    const walker = this.doc.createTreeWalker(row, 4 /* SHOW_TEXT */);
    for (let n = walker.nextNode(); n && text.length < 400; n = walker.nextNode()) {
      const p = n.parentElement;
      if (p && !SKIP_TAGS.has(p.tagName.toUpperCase()) && !p.classList.contains('gsb-bar')) text += ` ${n.nodeValue ?? ''}`;
    }
    if (this.bioTried.get(row) === text.length) return;
    this.bioTried.set(row, text.length);
    // A name or handle written as one word ("ZorblaxQuuxDiesInZZG9"): split at its capitals and digits, as a person would read it, then judged like the spaced name.
    const found = this.matcher.inspect(this.matcher.splitLower(unglue(text)));
    // A story word beside a name that hides alone or the game's name, or such a name beside the game. A first name or a weak name never counts alone.
    const risky = found.spoil.has('story') ? found.strong.size > 0 || !!found.game : found.strong.size > 0 && !!found.game;
    if (!risky) return;
    // The game's name beside a spoiler word has no name of its own to decide on: it is covered as a spoiler phrase, like a post.
    const res = this.matcher.decide(found, true, true) ?? { categories: [...found.spoil], custom: false };
    this.hide(this.containerFor(parent), res, 'spoiler-word', parent);
  }

  /** What a bio or name row read last: its text length, so it is judged again only when it changed. */
  private bioTried = new WeakMap<Element, number>();

  /** The words of a heading, without our own labels (a covered picture inside it). */
  private headingText(h: Element | null): string {
    return h ? this.textOf(h, 600) : '';
  }

  /** `textContent`, leaving out what sits in a switched-off part. Pieces are joined with no space, as textContent does. */
  private joinedText(el: Element): string {
    // Our own labels are not the page's words: "Hidden: picture next to GTA 6" must not make the block it sits in name the game.
    if (!this.opts.offParts && !this.opts.names && !this.opts.people && !el.querySelector('.gsb-bar')) return el.textContent ?? '';
    let out = '';
    const walker = this.doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
    for (let n = walker.nextNode(); n && out.length <= MAX_POST_CHARS; n = walker.nextNode()) {
      const p = n.parentElement;
      if (!p?.classList.contains('gsb-bar') && !this.isOff(p)) out += n.nodeValue ?? '';
    }
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

  /** A game mention arrived: the next CHAT_REACH lines below it are judged again for a spoiler word of their own (B-036). */
  private rejudgeAfterMention(parent: Element): void {
    const cards = this.opts.containers;
    const line = cards ? parent.closest(cards) : null;
    if (!cards || !line) return;
    let next = line.nextElementSibling;
    for (let i = 0; next && i < CHAT_REACH; next = next.nextElementSibling) {
      if (next.classList.contains('gsb-bar')) continue;
      i++;
      // Only chat lines that were judged with a spoiler word and no mention in reach; the others are read by their own text.
      if (!next.matches(cards) || next.hasAttribute('data-gsb') || !this.awaitingMention.has(next)) continue;
      this.awaitingMention.delete(next);
      this.spoilTried.delete(next);
      this.spoilPass.delete(next);
      this.spoilerPost(next);
    }
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
    // Every piece of text in a card leads here: read the block once per pass, unless a cover went on or came off since.
    const seen = this.joinedPass.get(block);
    if (seen && seen.pass === this.pass && seen.changes === this.changes) return;
    this.joinedPass.set(block, { pass: this.pass, changes: this.changes, gen: this.contextGen });
    // A post's own words only: replies nested inside it are posts in their own right.
    const text = inline ? this.joinedText(block) : this.ownText(block, cards!);
    if (text.length > MAX_POST_CHARS || (!this.forceJoin && seen?.gen === this.contextGen && this.joined.get(block) === text.length)) return;
    this.joined.set(block, text.length);
    const found = this.matcher.inspect(text);
    const res = this.matcher.decide(found, this.pageContext, this.pageContext);
    if (res) this.hide(this.containerFor(block), this.settleStrict(res, block), found.strong.size ? 'alone' : found.context ? 'mention' : 'page', block);
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
      if (!href || !ACCOUNT_HOST.test(href) || this.isOffPart(a) || (a as HTMLElement).isContentEditable || a.closest('[contenteditable=""], [contenteditable="true"], .gsb-bar')) continue;
      if (this.opts.main && a.closest('[data-gsb-under]')) continue;
      const key = accountKey(href);
      const own = this.opts.ownPage && a.closest(this.opts.ownPage.owner) ? this.opts.ownPage : null;
      const listed = !!key && this.opts.accounts!.has(key);
      // Only an account link in the owner row decides; a hashtag or sound link there says nothing about the owner.
      if (own && key) this.ownPost(a, own, listed);
      else if (listed) {
        const box = this.containerFor(a);
        // "Cover pictures only, never words": just the post's pictures and videos.
        if (this.pics.thumbsOnly) for (const m of box.querySelectorAll('img, video')) this.hideMedia(m, { categories: [], custom: false }, 'account', a);
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
    if (this.pics.thumbsOnly) {
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
    // A dialog the person showed (Facebook's photo viewer) keeps its element when the next post is swapped in: judged anew.
    for (const [d, src] of [...this.dialogSrc]) {
      if (!d.isConnected || !this.revealed.has(d)) continue;
      for (const x of [d, ...src.set]) { this.revealed.delete(x); x.removeAttribute('data-gsb-revealed'); }
      this.scan(d);
    }
    // ...and so is a viewer whose covers were made one by one: what was shown in it is covered or shown by the next photo's own words.
    for (const d of [...this.viewerList]) {
      this.viewerList.delete(d);
      if (!d.isConnected) continue;
      // Judged anew whatever was shown in it (even one cover alone: the page may give the next photo to the same picture element).
      this.viewerShown.delete(d);
      for (const x of d.querySelectorAll('[data-gsb-revealed]')) { this.revealed.delete(x); x.removeAttribute('data-gsb-revealed'); }
      this.scan(d);
    }
    this.scheduleStack();
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
    this.uncoverEl(el);
    this.ownHidden.delete(el);
  }

  /** Which cover each bar belongs to: a bar whose cover left the page is a leftover. */
  private barOwner = new WeakMap<HTMLElement, Element>();
  /** Covers at one spot with the first one's (stackBars): that one bar shows and shows them all. */
  private stacked = new Map<Element, Element[]>();
  private stackPending = false;
  /** The cover and those whose bars are not shown for being at its spot, still covered: one click (or hold) is for all of them. */
  private groupOf(el: Element): Element[] {
    const group = new Set([el, ...(this.stacked.get(el) ?? []).filter((g) => this.hidden.has(g))]);
    // The parts of a dialog still covered (not one the person showed, whose later covers are their own).
    const mine = this.dialogOf.get(el);
    if (mine && [...this.dialogSrc].some(([d, src]) => src.set === mine && this.covered(d))) for (const g of mine) if (this.hidden.has(g)) group.add(g);
    // Every cover inside a covered dialog the cover is in (a nested dialog's parts, a comment covered on its own) is one group.
    // Known limit: one press shows EVERY cover inside the dialog while it is covered, covers deeper in a part and in nested dialogs included.
    // Known limit (a product call): in a photo viewer (see viewerOf) one press shows EVERY cover inside it: the photo, comments' pictures and comments covered for their words alike.
    for (const d of this.dialogSrc.keys()) if (d.contains(el) && d !== el && this.covered(d)) for (const g of this.hidden.keys()) if (d.contains(g) && g !== d) group.add(g);
    // Any cover inside a covered viewer (a photo, a comment's picture: covers made one by one, not as the dialog's parts) too.
    const v = this.opts.hideMode === 'blur' ? this.viewerOf(el) : null;
    if (v && this.covered(v)) for (const g of this.hidden.keys()) if (v.contains(g) && g !== v) group.add(g);
    return [...group];
  }
  /**
   * Two covers in one post or card, or close together in the page (a few levels up): only those can be at one spot. `ca` and `cb`
   * are their cards (closest container, or null), found once per cover by the caller.
   */
  private sameSpotScope(a: Element, b: Element, ca: Element | null, cb: Element | null): boolean {
    // A cover in a card and one outside any card are never at one spot.
    if (this.opts.containers && (ca || cb)) return ca === cb;
    const ups = new Set<Element>();
    for (let x = a.parentElement, n = 0; x && n < 4; x = x.parentElement, n++) ups.add(x);
    for (let y = b.parentElement, n = 0; y && n < 4; y = y.parentElement, n++) if (ups.has(y)) return true;
    return false;
  }
  private scheduleStack(): void {
    if (this.stackPending || this.opts.hideMode !== 'blur') return;
    this.stackPending = true;
    const view = this.doc.defaultView;
    const run = () => { this.stackPending = false; this.stackBars(); };
    if (view?.requestAnimationFrame) view.requestAnimationFrame(run);
    else setTimeout(run, 0);
  }
  /**
   * One bar per spot: covers that overlap at one spot (a poster beside a covered video, tiles laid over each other) keep their
   * covers, but a bar lying mostly under an earlier one is not shown; the earlier bar shows the whole group. All bars are
   * measured in one go, then written.
   */
  private stackBars(): void {
    // Measured with every bar shown: a bar not shown last time is laid out where it would be. Runs only when covers change.
    for (const bar of this.hidden.values()) if (bar?.hasAttribute('data-gsb-stacked')) bar.removeAttribute('data-gsb-stacked');
    this.stacked.clear();
    // Each pair is compared: on a page with very many covers the bars stay as they are (a dialog's parts are still one group).
    const many = this.hidden.size > STACK_MAX;
    const shown: { el: Element; bar: HTMLElement; r: DOMRect; u: DOMRect; card: Element | null }[] = [];
    const cards = this.opts.containers;
    for (const [el, bar] of this.hidden) {
      if (!bar?.isConnected || bar.style.display === 'none' || (many && !this.inViewer(el))) continue;
      const r = bar.getBoundingClientRect();
      // Its card once per cover, not once per pair.
      if (r.width && r.height) shown.push({ el, bar, r, u: el.getBoundingClientRect(), card: cards ? el.closest(cards) : null });
    }
    // The first in the page leads its group.
    shown.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    // Over half of the smaller one: two bars on each other, or two covers on one spot (their bars then sit one under the other).
    const mostly = (p: DOMRect, q: DOMRect) => {
      const w = Math.min(p.right, q.right) - Math.max(p.left, q.left);
      const h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
      return w > 0 && h > 0 && w * h >= 0.5 * Math.min(p.width * p.height, q.width * q.height);
    };
    const leaderOf = new Map<Element, Element>();
    // The parts of one dialog are one group: the first one's bar shows, and shows them all. (Only in blur mode, where stackBars runs:
    // a collapsed dialog keeps one line per part, a click on any of them still shows the group.)
    // The lead is the first part whose bar can be clicked (the page's own buttons and panels may lie over one); else the best placed.
    // Every cover inside one viewer is one group, however it was made (as the dialog's parts, or one by one: a photo, a comment's picture):
    // the lead is the largest one whose bar can be clicked, else the best placed (the bar is put at its centre, see clearDialogBars).
    const views = new Map<Element, typeof shown>();
    this.viewerLeads.clear();
    const coveredNow = new Map<Element, boolean>();
    const isCovered = (d: Element) => coveredNow.get(d) ?? coveredNow.set(d, this.covered(d)).get(d)!;
    for (const x of shown) {
      // (The outer viewer shown, a dialog covered by its parts inside it is still a group of its own: groupKey.)
      const v = this.groupKey(x.el, isCovered);
      if (v) (views.get(v) ?? views.set(v, []).get(v)!).push(x);
    }
    // The largest by what is in the window: a tall cover mostly off screen does not lead.
    const area = (x: { el: Element }) => this.visArea(x.el);
    for (const parts of views.values()) {
      if (parts.length < 2) continue;
      // On Facebook: the largest in the window leads, and one in the window when there is one (a scrolled-off photo's bar is no bar).
      if (this.opts.viewers) parts.sort((a, b) => area(b) - area(a));
      const inWindow = this.opts.viewers ? parts.filter((x) => area(x) > 0) : [];
      let lead = parts[0]!;
      let best = -1;
      for (const x of inWindow.length ? inWindow : parts) {
        const sc = this.spotScore(x.el, x.bar);
        if (sc > best) { best = sc; lead = x; }
        if (sc >= SPOT_OK) break;
      }
      for (const x of parts) if (x !== lead) leaderOf.set(x.el, lead.el);
      this.viewerLeads.add(lead.el);
    }
    const root = (el: Element): Element => { let r = el; for (let n = 0; leaderOf.has(r) && n < 50; n++) r = leaderOf.get(r)!; return r; };
    for (let i = 0; i < shown.length && !many; i++) {
      const a = shown[i]!;
      for (let j = 0; j < i; j++) {
        const b = shown[j]!;
        // The cheap test first: most pairs are nowhere near each other.
        if (!mostly(a.r, b.r) && !(a.u.width && a.u.height && b.u.width && b.u.height && mostly(a.u, b.u))) continue;
        // A cover inside another (a reply covered inside a thread that keeps its replies' own covers, words over a player)
        // keeps its own bar; so do covers in different posts (a hovercard or a fixed player over a post is there for a moment).
        if (a.el.contains(b.el) || b.el.contains(a.el) || !this.sameSpotScope(a.el, b.el, a.card, b.card)) continue;
        // The later one in the page loses its bar to the group's first, whose bar shows the whole group.
        if (leaderOf.has(a.el)) continue;
        const rb = root(b.el);
        if (rb === a.el) continue;
        leaderOf.set(a.el, rb);
      }
    }
    const now = new Set<HTMLElement>();
    for (const { el, bar } of shown) {
      if (!leaderOf.has(el)) continue;
      now.add(bar);
      const lead = root(el);
      (this.stacked.get(lead) ?? this.stacked.set(lead, []).get(lead)!).push(el);
    }
    for (const bar of now) bar.setAttribute('data-gsb-stacked', '');
    // The bars that show for a viewer's group are looked after on each refit and scroll, whenever the group was made.
    if (this.opts.viewers) for (const parts of views.values()) for (const x of parts) if (!leaderOf.has(x.el) && !this.probeBars.has(x.bar)) { this.probeBars.set(x.bar, x.el); this.watchScroll(); }
    // A bar shown again may still wait to be placed (settleBars skips stacked bars).
    if (this.undecided.size || this.barOver.size || this.probeBars.size) this.queueRefit();
  }

  /** A covered dialog: one of its parts is still covered, and the person has not shown it. What was left of one shown, or judged clean since, is no group. */
  private covered(d: Element): boolean {
    if (!d.isConnected || this.revealed.has(d) || this.viewerShown.has(d)) return false;
    const src = this.dialogSrc.get(d);
    if (src) return [...src.set].some((p) => this.hidden.has(p));
    for (const g of this.hidden.keys()) if (g !== d && d.contains(g)) return true;
    return false;
  }

  /** Viewers (dialogs) the person showed: what is covered in one later is its own group. `viewerList` is those still to be judged anew when the page moves on. */
  private viewerShown = new WeakSet<Element>();
  private viewerList = new Set<Element>();

  /**
   * The viewer a cover is in: the outermost dialog around it that is a dialog covered by its parts, or, on a site whose dialogs are photo
   * viewers (opts.viewers, Facebook), whose largest picture or video in the window is covered, at least 150 px each way and not in a
   * comment (see bigPicture). A post modal whose photo is clean, or that has no photo, is no viewer: each cover keeps its own bar.
   * Nested dialogs are one viewer with the outermost. Null for the rest.
   */
  private viewerOf(el: Element): Element | null {
    let found: Element | null = null;
    for (let n = this.up(el); n; n = this.up(n)) {
      if (this.isDialogEl(n) && (this.dialogSrc.has(n) || (this.opts.viewers && this.bigPicture(n)))) found = n;
    }
    return found;
  }
  /** What bigPicture answered, kept for one run of the script only (the page can change after it) and dropped when a cover is made or taken off. */
  private bigMemo = new Map<Element, boolean>();
  /** The biggest picture or video in the window in this dialog (the media itself, not its cover's box) is covered, at least 150 px each way, and not in a reply block. */
  private bigPicture(d: Element): boolean {
    const seen = this.bigMemo.get(d);
    if (seen !== undefined) return seen;
    if (!this.bigMemo.size) queueMicrotask(() => this.bigMemo.clear());
    let top: Element | null = null;
    let most = 0;
    for (const m of d.querySelectorAll('img, video')) {
      const a = this.visArea(m);
      if (a > most) { most = a; top = m; }
    }
    let big = false;
    if (top && !(this.opts.replies && top.closest(this.opts.replies))) {
      const r = top.getBoundingClientRect();
      const win = this.doc.defaultView;
      const w = Math.min(r.width, win ? win.innerWidth : r.width), h = Math.min(r.height, win ? win.innerHeight : r.height);
      if (w >= 150 && h >= 150) for (let n: Element | null = top; n && n !== d; n = n.parentElement) if (this.hidden.has(n)) { big = true; break; }
    }
    this.bigMemo.set(d, big);
    return big;
  }
  private dialogAt = 0;
  private dialogYes = false;
  /** Is a dialog in the page? Looked for at most twice a second. */
  private hasDialog(): boolean {
    const now = Date.now();
    if (now - this.dialogAt > 500) { this.dialogAt = now; this.dialogYes = !!this.doc.querySelector('[role="dialog"], [role="alertdialog"], dialog'); }
    return this.dialogYes;
  }
  /** A group whose bar's cover has left the window (a scrolled viewer) while another of its covers is in it: the groups are made again (scheduleStack runs once a frame at most). */
  private checkLeads(): void {
    if (!this.opts.viewers || !this.viewerLeads.size) return;
    for (const lead of this.viewerLeads) {
      const list = this.stacked.get(lead);
      if (!list || !lead.isConnected) continue;
      // The lead has left the window while another of its group is in it, or its dialog stopped being a viewer.
      if ((this.visArea(lead) === 0 && list.some((g) => this.visArea(g) > 0)) || !this.inViewer(lead)) { this.scheduleStack(); return; }
    }
  }
  /** The covers that lead a viewer's group (stackBars): only these are looked at by checkLeads, not covers stacked for lying on each other. */
  private viewerLeads = new Set<Element>();
  /** Where the bars of a cover are looked after (clearDialogBars): in a dialog covered by its parts, or in a photo viewer. */
  private inViewer(el: Element): boolean {
    if (this.dialogOf.has(el)) return true;
    // A cheap look first: no dialog around the cover (in the page itself, not a shadow tree) is no viewer.
    if (!this.opts.viewers || (el.getRootNode() === this.doc && !el.closest('[role="dialog"], [role="alertdialog"], dialog'))) return false;
    return !!this.viewerOf(el);
  }
  /** The dialog a cover is grouped in: its viewer while covered, else the outermost covered dialog of parts around it. `cov` answers covered(d). */
  private groupKey(el: Element, cov: (d: Element) => boolean = (d) => this.covered(d)): Element | null {
    const v = this.viewerOf(el);
    if (v && v !== el && cov(v)) return v;
    let out: Element | null = null;
    for (const d of this.dialogSrc.keys()) if (d !== el && d.contains(el) && cov(d) && (!out || d.contains(out))) out = d;
    return out;
  }
  /** The area of an element's box that is in the window. */
  private visArea(el: Element): number {
    const win = this.doc.defaultView;
    const r = el.getBoundingClientRect();
    if (!win) return r.width * r.height;
    const w = Math.min(r.right, win.innerWidth) - Math.max(r.left, 0), h = Math.min(r.bottom, win.innerHeight) - Math.max(r.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  private uncoverEl(el: Element, bar = this.hidden.get(el)): void {
    this.releaseMedia(el);
    if (bar) this.probeBars.delete(bar);
    if (this.stacked.size || bar?.hasAttribute('data-gsb-stacked')) this.scheduleStack();
    this.unmark(el);
    el.removeAttribute('data-gsb');
    el.removeAttribute('data-gsb-why');
    el.removeAttribute('data-gsb-source');
    // Its label goes with it, so nothing would end a peek: a peek left behind would void the next cover on it.
    el.removeAttribute('data-gsb-peek');
    if (bar) { this.barOver.delete(bar); this.undecided.delete(bar); }
    bar?.remove();
    this.sizes?.unobserve(el);
    this.hidden.delete(el);
    this.bigMemo.clear();
  }

  private checkMedia(el: Element): void {
    if (this.skip(el) || isEmote(el)) return;
    const text = this.mediaText(el);
    const verdict = this.gifVerdict(el);
    const label = verdict === 'none' ? '' : libraryLabel(el);
    let res = text ? this.matcher.match(text, this.pageContext) : null;
    if (!res && label) res = this.matcher.match(label, this.pageContext);
    if (res) res = this.settleStrict(res, el);
    // Inside a known card the whole card goes, like it does for text; elsewhere, or with "pictures only", just the image.
    if (res) { const card = this.pics.thumbsOnly ? null : this.cardFor(el); if (card) this.hide(card, res, 'alone', el); else this.hideMedia(el, res, 'alone', el); }
    else {
      if (verdict === 'dirty') this.coverGif(el, label, text);
      this.mediaPost(el);
      this.nearGame(el, text);
      this.recheckOnLoad(el);
    }
  }

  /**
   * Discord puts a library GIF's words (the message's link, the video's label) or the video itself on the page after the first
   * look, when only a plain picture (its loading placeholder) or a wordless video was there and was covered as one. When something
   * arrives in a message, a picture cover in it is lifted if it holds a library GIF and every picture under it is now judged clean
   * (avatars and emoji, too small for these rules, aside). Not a cover for words, not one in a message covered for its words: those
   * stay. What was under the cover is then read again as usual.
   */
  private liftCleanGif(root: Element): void {
    const item = discordMessageOf(root);
    if (!item || this.wordsCovered(item)) return;
    for (const c of [item, ...item.querySelectorAll('[data-gsb]')]) {
      const why = this.whyOf.get(c);
      if (!this.hidden.has(c) || (why !== 'near-game' && why !== 'media')) continue;
      const media = c.matches('img, video') ? [c] : this.mediaIn(c);
      // One with no size yet (not loaded, no width stated) may be big: it counts too. Discord's data: placeholder is judged clean
      // through its GIF (placeholderFor), so it never holds a lift back.
      const unsized = (m: Element) => m.matches('img, video') && !m.getAttribute('width') && !((m as HTMLImageElement).naturalWidth || (m as HTMLVideoElement).videoWidth);
      // The cover can sit on the placeholder alone (near-game, read live), with the GIF beside it, outside the cover: the
      // placeholder of a library GIF counts as that GIF.
      const gif = (m: Element) => isLibraryGif(m, this.opts.gifs) || placeholderFor(m) !== null;
      const pics = media.filter((m) => gif(m) || this.bigMedia(m, NAMED_CARD_MEDIA_PX) || this.isThumb(m) || unsized(m));
      if (!pics.some(gif) || !pics.every((m) => this.mediaVerdict(m) === 'clean')) continue;
      this.uncoverEl(c);
      // All of it is read again, words too: text that came while it was covered was skipped then (as rejudge does).
      const before = this.forceJoin;
      this.forceJoin = true;
      try {
        this.scan(c);
      } finally {
        this.forceJoin = before;
      }
    }
  }

  private gifVerdicts = new WeakMap<Element, { key: string; v: 'clean' | 'dirty' | 'none' }>();

  /**
   * A reaction GIF from a library is judged by its words: 'clean' (the words say nothing about the game, so it
   * is shown), 'dirty' (they do), or 'none' (not a library GIF, no words, or the setting is "picture").
   */
  private gifVerdict(el: Element): 'clean' | 'dirty' | 'none' {
    if (this.pics.reactionGifs === 'picture') return 'none';
    // A placeholder picture beside a library GIF goes with it when the GIF is shown; otherwise it is a picture like any other.
    const gif = placeholderFor(el);
    if (gif) return this.gifVerdict(gif) === 'clean' ? 'clean' : 'none';
    const isGif = isLibraryGif(el, this.opts.gifs);
    const label = isGif ? libraryLabel(el) : '';
    const key = `${libraryUrls(el).join('|')}|${label}`;
    const seen = this.gifVerdicts.get(el);
    if (seen && seen.key === key) return seen.v;
    let v: 'clean' | 'dirty' | 'none' = 'none';
    if (isGif && label !== '') {
      const f = this.matcher.inspect(label);
      v = this.matcher.match(label, this.pageContext) || f.context || f.strong.size || f.weak.size || f.spoil.size ? 'dirty' : 'clean';
    }
    this.gifVerdicts.set(el, { key, v });
    return v;
  }

  private replyPics = new WeakMap<Element, { pass: number; key: string; v: boolean }>();

  /** What the media check asks: a library GIF is judged by its words, else a plain picture in a reply by its own. */
  private mediaVerdict(el: Element): 'clean' | 'dirty' | 'none' {
    const g = this.gifVerdict(el);
    if (g === 'clean') {
      // The card's own aria-label is not read here: a clean label decides, and a card covered for its words is caught by wordsCovered.
      // A clean label still gives way to what its reply sits under: a covered post, or a words cover it was under before.
      const cards = this.opts.containers;
      const card = cards ? el.closest(cards) : null;
      return card && this.isReply(card) && this.heldBack(el, card) ? 'none' : 'clean';
    }
    return g !== 'none' ? g : this.replyPicture(el) ? 'clean' : 'none';
  }

  /** The address a picture is known by (no query); '' when it has none, and then it is never taken for the same picture. */
  private picSrc(el: Element): string {
    // Markup only: currentSrc changes once the picture loads (a 2x address), which would read as another picture.
    const a = el.getAttribute('src') || libraryUrls(el, false, false)[0] || '';
    return a.split(/[?#]/)[0] ?? '';
  }

  /**
   * A reply picture that must stay covered whatever its own words say: its card is covered for its words (the address is
   * recorded), it was under such a cover at this same address, or the page's own post is covered for its words.
   */
  private heldBack(el: Element, card: Element): boolean {
    const src = this.picSrc(el);
    if (this.wordsCovered(card)) { this.underWords.set(el, src); return true; }
    return (src !== '' && this.underWords.get(el) === src) || this.primaryCovered(card);
  }

  /** Is this card a reply (a comment, or a post on a thread page that is not the main post)? Feeds, searches and chats: no. */
  private isReply(card: Element): boolean {
    const o = this.opts;
    if (o.replies === null) return false;
    const sel = o.replies ?? o.threads;
    if (sel && card.matches(sel)) return true;
    // On a thread page only what follows the main post, before the first boundary: not the posts above it or the suggestions after.
    // Not where the comments are named (Facebook): those are its replies, and a post after the main post's block (a suggested one) is not one.
    const main = o.main && !o.replies ? this.mc?.el : null;
    return !!main && card !== main && !main.contains(card) && this.inRun(card);
  }

  /** Media that is not a reply's own picture: video, a thumbnail, the main post's, a quoted or linked post's, one of a gallery. */
  private ownMedia(el: Element, card: Element): boolean {
    if ((el.tagName === 'VIDEO' && !this.isGifType(el)) || this.isThumb(el)) return true;
    const main = this.mc?.el;
    // Not a comment inside the main post (Instagram): that is a reply, and its picture follows the reply photo setting.
    if (main && (card === main || (main.contains(card) && !this.inMain(card)))) return true;
    const cards = this.opts.containers!;
    let quoted = el.closest('[role="link"]');
    // A wordless, label-less photo link (Facebook wraps a comment photo in one) is the picture's own link: look at the box around it.
    const pl = this.opts.picLinks;
    if (quoted && pl && quoted.matches(pl) && !(quoted.textContent ?? '').trim() && !quoted.getAttribute('aria-label')) quoted = quoted.parentElement?.closest('[role="link"]') ?? null;
    if (quoted && quoted !== card && card.contains(quoted)) return true;
    const a = el.closest('a[href]');
    // A GIF's link goes to its page in the library (giphy.com/gifs/...): that is the GIF itself, not a link card.
    if (a && card.contains(a) && !this.isGifType(el)) {
      try {
        const u = new URL(a.getAttribute('href')!, this.doc.baseURI);
        if (u.host !== (this.doc.location?.host ?? '') && !/\.(jpe?g|png|gif|webp|avif)$/i.test(u.pathname)) return true;
      } catch { /* an address that does not parse is not a link out */ }
    }
    let big = 0;
    for (const m of card.querySelectorAll('img')) if (m.closest(cards) === card && this.bigMedia(m, NAMED_CARD_MEDIA_PX) && ++big > 1) return true;
    return false;
  }

  /** GIF-type media: a library GIF, the site's own GIF picker video, or a picture whose address ends in .gif. */
  private isGifType(el: Element): boolean {
    if (isLibraryGif(el, this.opts.gifs, false)) return true;
    const gifPath = (u: string | null) => {
      try { return !!u && /\.gif$/i.test(new URL(u, this.doc.baseURI).pathname); } catch { return false; }
    };
    return [el, ...el.querySelectorAll('source')].some((x) => gifPath(x.getAttribute('src')));
  }

  /**
   * A plain picture that is all a reply says (no own words naming the game, a label that does not either, not the game's own
   * media) is treated like a clean reaction GIF: shown. Setting "cover", or any doubt, gives false (the usual rules).
   */
  private replyPicture(el: Element): boolean {
    // Avatars, icons and emoji are never covered by these rules: skip the reading for them.
    if (!this.bigMedia(el, NAMED_CARD_MEDIA_PX)) return false;
    // The cheap checks first: both kinds set to cover, then the kind of this one.
    const gifsOn = this.pics.replyGifs !== 'cover';
    const photosOn = this.pics.replyPhotos !== 'cover';
    if (!gifsOn && !photosOn) return false;
    if (!(this.isGifType(el) ? gifsOn : photosOn)) return false;
    const cards = this.opts.containers;
    const card = cards ? el.closest(cards) : null;
    if (!cards || !card || !this.isReply(card)) return false;
    // The reply's own words, @names and addresses included: a listed name inside one still counts. Other pictures' alt text,
    // labels and hashtag links in the reply count too; community and permalink links do not (they would name the game on its own subreddit).
    // The card's own label and title count too (Bluesky puts the post's words in the aria-label of the post box).
    const ownRaw = `${this.ownText(card, cards)} ${this.unseenText(card, true)} ${card.getAttribute('aria-label') ?? ''} ${card.getAttribute('title') ?? ''}`;
    const link = el.closest('a');
    const label = [this.mediaText(el), link?.getAttribute('title')].filter(Boolean).join(' ');
    const urls = libraryUrls(el, false);
    const addr = this.addressWords(el, urls);
    const key = `${urls.join('|')}|${label}|${addr}|${ownRaw}`;
    const seen = this.replyPics.get(el);
    if (seen && seen.pass === this.pass && seen.key === key) return seen.v;
    const names = (t: string) => { const f = this.matcher.inspect(t); return f.context || f.strong.size > 0 || f.weak.size > 0 || f.spoil.size > 0; };
    // Address words count only for the game's own names (see addressWords); alt text, titles and labels get the full rule.
    const named = (t: string) => { const f = this.matcher.inspect(t); return f.context || f.strong.size > 0; };
    // A picture that sat under a words cover and is still at the same address stays covered when the text is later replaced.
    const v = !this.heldBack(el, card)
      && !this.ownMedia(el, card)
      && !(this.pics.reactionGifs === 'picture' && isLibraryGif(el, this.opts.gifs))
      && !names(ownRaw)
      && !this.matcher.match(label, this.pageContext) && !names(label) && !named(addr);
    this.replyPics.set(el, { pass: this.pass, key, v });
    if (v) { this.replyShown.add(el); this.replyShownAny = true; }
    return v;
  }

  private underWords = new WeakMap<Element, string>();

  /**
   * Every address and word-like data value tied to a picture, read as words: query, srcset, sources, poster, the link, and data-*
   * attributes whose name says they hold words or an address. Attributes only. Underscores, dots and the like count as spaces (a
   * file named after the game). Opaque address tokens (16+ characters, 6 or more letter/digit runs: hashes, signatures, IDs) are dropped;
   * data-* values are never dropped. The caller judges these with the
   * game's own names only: everyday URL words and random IDs must not cover every picture.
   */
  private addressWords(el: Element, urls: string[]): string {
    const runs = (t: string) => (t.match(/\p{L}+/gu)?.length ?? 0) + (t.match(/\p{N}+/gu)?.length ?? 0);
    const words = (v: string, drop: boolean) => safe(v).split(/[\s/?&=#_+.:,;-]+/).filter((t) => !(drop && t.length >= 16 && runs(t) >= 6)).join(' ');
    const parts = urls.map((u) => words(u, true));
    for (const a of el.attributes) {
      if (a.value.length < 400 && /title|alt|label|caption|desc|name|src|url|href|original|poster|image|img|gif|mp4|video/i.test(a.name) && !/^data-(gsb|testid|id|index)/i.test(a.name) && /^data-/i.test(a.name)) parts.push(words(a.value, false));
    }
    return parts.join(' ');
  }

  /** On sites whose comments sit beside the page's own post (new Reddit; the adapter names the post): a post covered by its words covers their reply pictures too. */
  private primaryCovered(card: Element): boolean {
    const o = this.opts;
    if (!o.primaryPost || !o.threads || !card.matches(o.threads)) return false;
    // The lookup is kept while the post is connected, and an empty one for the current scan pass.
    if (!(this.primary && (this.primary.el ? this.primary.el.isConnected : this.primary.pass === this.pass))) this.primary = { pass: this.pass, el: this.doc.querySelector(o.primaryPost) };
    const p = this.primary.el;
    return !!p && !p.contains(card) && this.wordsCovered(p);
  }
  private primary: { pass: number; el: Element | null } | null = null;

  /**
   * The match for a picture cover. When covers carry a source: `sitePictures` if the global picture choice alone (pictures checked, and
   * `byGlobal`) would not have made it, so the site's own choice did.
   */
  private pictureRes(byGlobal: (g: Pictures) => boolean): MatchResult {
    const g = this.opts.coverSource?.globalPictures;
    const res: CoverResult = { categories: [], custom: false };
    if (g && !(g.hideImages && byGlobal(g))) res.sitePictures = true;
    return res;
  }

  /** Pictures the reply rule let through: the only ones a late word in the text can still change (see relook). */
  private replyShown = new WeakSet<Element>();
  private replyShownAny = false;

  /**
   * The game's name (or a word that points at it) has just turned up in `parent`: look again at the pictures beside it. The usual
   * near-game look is for the game's name in "post" mode. A picture the reply rule let through is looked at for any such word,
   * in any mode but off, since its own reading has just changed. With no such picture nothing more is read.
   */
  private relook(parent: Element, found: Found): void {
    if (!this.pics.hideImages) return;
    const mode = this.pics.mediaNearGame;
    const all = found.context && mode === 'post';
    const late = this.replyShownAny && !!(found.context || found.strong.size || found.weak.size || found.spoil.size);
    if (!all && !late) return;
    const box = this.cardFor(parent) ?? parent.closest('figure, a');
    if (box) for (const m of this.mediaIn(box)) if (all || this.replyShown.has(m)) mode === 'off' ? this.mediaPost(m) : this.nearGame(m);
    // A caption that is a card of its own: the slides of its post are beside it.
    const post = all && box && this.opts.containers ? box.parentElement?.closest(this.opts.containers) : null;
    if (post && this.captionOf(post) === box) for (const m of this.mediaIn(post)) if (m.closest(this.opts.slides!)) mode === 'off' ? this.mediaPost(m) : this.nearGame(m);
  }

  /** A library GIF whose words point at the game: cover just the GIF, wherever the near-game rule applies. */
  private coverGif(el: Element, label: string, own: string): void {
    const mode = this.pics.mediaNearGame;
    if (mode === 'off' || !this.matcher.judgesPosts || this.skip(el) || el.closest('nav, header, footer')) return;
    if (this.pageContext || (mode === 'post' && this.namedBeside(el, `${own} ${label}`))) {
      this.hideMedia(el, this.pictureRes((g) => g.mediaNearGame !== 'off' && (this.pageContext || g.mediaNearGame === 'post')), 'near-game');
    }
  }

  /** A live stream's player (the adapter's keepClear): never covered, never paused or muted. Not on recorded media (keepClearNot). */
  private keptClear(el: Element): boolean {
    const sel = this.opts.keepClear;
    if (!sel) return false;
    try {
      const root = el.closest(sel);
      if (!root || this.opts.keepClearNot?.test(`${this.doc.location?.hostname ?? ''}${this.doc.location?.pathname ?? ''}${this.doc.location?.search ?? ''}`)) return false;
      // A live stream has no end (duration Infinity); a recorded video has one. An offline channel page that replays a recorded broadcast is not live:
      // it is judged like any video. Not known yet (NaN: nothing loaded, or still loading) counts as live, and is looked at again when it is.
      const media = el instanceof HTMLMediaElement ? el : playerIn(root);
      if (media) {
        if (isRecorded(media.duration)) return false;
        this.watchDuration(media);
      }
      return true;
    } catch {
      return false; // a selector the browser does not know: nothing is kept clear
    }
  }

  private durationWatched = new WeakSet<Element>();
  /** A player that turns out to be recorded (its duration becomes finite: a recorded broadcast loads, the page moves from a live channel to a video) is judged again. */
  private watchDuration(media: HTMLMediaElement): void {
    if (this.durationWatched.has(media)) return;
    this.durationWatched.add(media);
    // Tied to this scanner (a restart aborts it: a dead scanner must not cover or mute later). A finite reading is trusted only if it still holds a moment
    // later: a live stream's player can pass through a finite duration while it starts or ends, and must not be covered for good by that.
    const signal = this.playAbort.signal;
    media.addEventListener('durationchange', () => {
      if (!isRecorded(media.duration) || !media.isConnected) return;
      window.setTimeout(() => {
        if (signal.aborted || !isRecorded(media.duration) || !media.isConnected) return;
        this.nearGame(media);
        this.quiet();
      }, 1200);
    }, { signal });
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
      if (this.quieted.has(m) || this.keptClear(m)) return;
      const media = m as HTMLMediaElement;
      this.quieted.add(m);
      if (this.opts.muteAudio) {
        media.muted = true;
        HELD_MUTED.delete(media);
      }
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

  /**
   * The element that paints a picture. X (and others) draw the picture as a sibling's background-image under a see-through
   * <img>: a cover on that <img> shows its label but leaves the picture in plain view, so the box holding both is covered.
   * Bluesky lays a poster over its video and Facebook a picture beside its images: the same idea, a cousin, not a sibling.
   * So: the smallest box up to 6 levels up (Bluesky: 5) that holds a background picture over half of this media and stays near its size.
   */
  private paintBox(el: Element): Element {
    if (el.tagName !== 'IMG' && el.tagName !== 'VIDEO') return el;
    const view = this.doc.defaultView;
    // A video not laid out yet has no size: measure from the nearest box around it that has one.
    let r = el.getBoundingClientRect();
    for (let x = el.parentElement, up = 0; (!r.width || !r.height) && x && up < 4; x = x.parentElement, up++) r = x.getBoundingClientRect();
    const area = r.width * r.height;
    let a: Element | null = el.parentElement;
    for (let up = 0; a && up < 6 && a !== this.doc.body; up++, a = a.parentElement) {
      const ar = a.getBoundingClientRect();
      if (area && ar.width * ar.height > 3 * area) break;
      for (const c of a.querySelectorAll('*')) {
        if (c === el || el.contains(c)) continue;
        // Set inline or by a stylesheet, on the element or on a ::before / ::after layer of it.
        const bg = view ? [view.getComputedStyle(c), view.getComputedStyle(c, '::before'), view.getComputedStyle(c, '::after')].map((st) => st.backgroundImage).join(' ') : (c as HTMLElement).style?.backgroundImage ?? '';
        if (!/url\(/.test(bg)) continue;
        const cr = c.getBoundingClientRect();
        const w = Math.min(r.right, cr.right) - Math.max(r.left, cr.left);
        const h = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top);
        // Over half of the media, or (no sizes yet, a page still laying out) a sibling of it.
        if ((area && w > 0 && h > 0 && w * h >= area / 2) || (!area && c.parentElement === el.parentElement)) return a;
      }
    }
    return el.tagName === 'VIDEO' ? this.playerBox(el, r) : el;
  }

  /**
   * A video's player: its controls, big play button and badges are laid over it as siblings (RES, Reddit's own player), so a
   * cover on the <video> alone leaves them clickable and they start it. The outermost wrapper up to 4 levels up that is
   * as tall as the video (within 10%) and up to 3 times as wide (a portrait video in a wide frame has side space for controls)
   * and holds no more than a few words is covered instead, with everything in it. A shorter or taller wrapper ends the climb.
   */
  private playerBox(el: Element, r: DOMRect): Element {
    let box = el;
    if (!r.width || !r.height) return box;
    for (let p = el.parentElement, up = 0; p && up < 4 && p !== this.doc.body; p = p.parentElement, up++) {
      // Never a page-level part, page chrome, a form or a part covered for its words; and not a wrapper that holds other pictures.
      if (this.pageLevel(p) || p.matches('nav, header, footer, aside, form') || p.closest('[data-gsb-under]') || (this.opts.containers && p.matches(this.opts.containers))) break;
      const pr = p.getBoundingClientRect();
      if (Math.abs(pr.height - r.height) > 0.1 * r.height || pr.width > 3 * r.width || pr.width < 0.9 * r.width || this.captionLength(p) > 80) break;
      if ([...p.querySelectorAll('[data-gsb]')].some((c) => c !== el && !['near-game', 'media'].includes(c.getAttribute('data-gsb-why') ?? '')) || this.holdsOtherMedia(p, el, r)) break;
      box = p;
    }
    return box;
  }

  /** Does the wrapper hold a visible picture, video, frame or canvas besides this video, other than a poster over it or a control's? */
  private holdsOtherMedia(wrap: Element, video: Element, r: DOMRect): boolean {
    for (const c of wrap.querySelectorAll('img, video, iframe, canvas')) {
      const k = c.closest('button, label, [class*="controls"], [class*="controller"]');
      if (c === video || video.contains(c) || (k && wrap.contains(k))) continue;
      const cr = c.getBoundingClientRect();
      // Not shown, or a pixel or an avatar.
      if (!cr.width || !cr.height || Math.max(cr.width, cr.height) < TINY_MEDIA_PX) continue;
      const w = Math.min(r.right, cr.right) - Math.max(r.left, cr.left);
      const h = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top);
      if (w <= 0 || h <= 0 || w * h < (cr.width * cr.height) / 2) return true;
    }
    return false;
  }

  /**
   * The words a wrapper holds besides a player's own controls: not our labels, not style or script text, and not the text of
   * buttons, labels and control panels (time, tooltips, quality names), which is no caption or title.
   */
  private captionLength(root: Element): number {
    const skip = 'style, script, noscript, template, svg, .gsb-bar, button, label, [role="button"], [role="slider"], [class*="controller"], [class*="controls"]';
    let n = 0;
    const walk = (e: Element): void => {
      for (const c of e.childNodes) {
        if (c.nodeType === 3) n += (c.nodeValue ?? '').trim().length;
        else if (c.nodeType === 1 && !(c as Element).matches(skip)) walk(c as Element);
        if (n > 80) return;
      }
    };
    walk(root);
    return n;
  }

  /**
   * A video or audio in a covered box stays paused and muted until the box is shown: it is stopped now and again if a script
   * starts it (one listener on the page, and one in each open shadow root holding such media: new Reddit's player lives in one),
   * and its sound is turned off, then back on when the cover comes off. Media added to the box later are held too.
   */
  private playAbort = new AbortController();
  private playListening = false;
  private repauses = new WeakMap<Element, { n: number; since: number }>();
  /** Per cover: the media this extension muted under it, so exactly those are unmuted when it comes off (HELD_MUTED holds the rest). */
  private mutedIn = new Map<Element, Set<HTMLMediaElement>>();
  private listenedRoots = new WeakSet<Node>();

  /** The videos and audio in a box: in its own tree, in the open shadow roots inside it (a few levels deep) and in its own. */
  private coveredMedia(box: Element, listen = false): HTMLMediaElement[] {
    const out: HTMLMediaElement[] = [];
    let seen = 0;
    const walk = (root: Element | ShadowRoot, depth: number): void => {
      if (root instanceof ShadowRoot && listen) this.listenForPlay(root);
      for (const m of root.querySelectorAll('video, audio')) out.push(m as HTMLMediaElement);
      if (depth >= 3) return;
      for (const e of root.querySelectorAll('*')) {
        if (++seen > 2000) return;
        if (e.shadowRoot) walk(e.shadowRoot, depth + 1);
      }
    };
    if (box.matches('video, audio')) out.push(box as HTMLMediaElement);
    else walk(box, 0);
    if (box.shadowRoot) walk(box.shadowRoot, 1);
    return out;
  }

  /** The cover that holds a node, through shadow roots (a media element inside one is held by a cover around its host). */
  private coverOf(node: Element): Element | null {
    for (let n: Element | null = node; n; ) {
      const h = n.closest('[data-gsb], [data-gsb-revealed], [data-gsb-in="keep"]');
      if (h) return h;
      const root = n.getRootNode();
      n = root instanceof ShadowRoot ? root.host : null;
    }
    return null;
  }

  private onPlay = (e: Event): void => {
    const media = e.target as Element | null;
    if (!media || !media.matches?.('video, audio')) return;
    // The nearest cover or show decides: a video the person showed inside a covered comment may play.
    const h = this.coverOf(media);
    // A video this extension muted that the site has since moved out of every cover (a mini player, a pinned player): it is nobody's to hold.
    if (!h && HELD_MUTED.delete(media as HTMLMediaElement)) {
      (media as HTMLMediaElement).muted = false;
      return;
    }
    if (!h || !h.hasAttribute('data-gsb') || !this.hidden.has(h) || this.revealed.has(h) || h.hasAttribute('data-gsb-peek')) return;
    // The sound stays off whatever the player does; a player that starts itself again after every pause is left after 20 tries
    // within 10 seconds.
    this.muteHeld(media as HTMLMediaElement, h);
    const now = Date.now();
    let t = this.repauses.get(media);
    if (!t || now - t.since > 10_000) this.repauses.set(media, (t = { n: 0, since: now }));
    if (++t.n <= 20) (media as HTMLMediaElement).pause();
  };

  private listenForPlay(root: Node): void {
    if (this.listenedRoots.has(root)) return;
    this.listenedRoots.add(root);
    root.addEventListener('play', this.onPlay, { capture: true, signal: this.playAbort.signal });
  }

  /** Turn the sound off under `box` and remember it (also for a video a restarted scanner muted before: it is still ours to unmute). */
  private muteHeld(m: HTMLMediaElement, box: Element): void {
    if (!m.muted) {
      m.muted = true;
      HELD_MUTED.add(m);
    }
    if (!HELD_MUTED.has(m)) return;
    let set = this.mutedIn.get(box);
    if (!set) this.mutedIn.set(box, (set = new Set()));
    set.add(m);
  }

  /** The cover comes off: the sound this extension turned off comes back (the video stays paused: the person presses play). */
  private releaseMedia(box: Element): void {
    const set = this.mutedIn.get(box);
    if (!set) return;
    this.mutedIn.delete(box);
    for (const m of set) if (HELD_MUTED.delete(m)) m.muted = false;
  }

  /** Media muted under a cover that the site has moved out of it: the sound comes back (they need not play first). */
  private releaseStrayMedia(): void {
    for (const [box, set] of this.mutedIn) {
      for (const m of set) {
        if (this.coverOf(m) === box) continue;
        set.delete(m);
        if (!this.coverOf(m) && HELD_MUTED.delete(m)) m.muted = false;
      }
      if (!set.size) this.mutedIn.delete(box);
    }
  }

  private pausedWhileCovered(box: Element): void {
    if (!this.hidden.has(box) || this.revealed.has(box)) return;
    // Media under a cover of their own inside this one (a part the person showed, a kept reply) are not this cover's to hold.
    const root = box.getRootNode();
    if (root instanceof ShadowRoot) this.listenForPlay(root);
    for (const m of this.coveredMedia(box, true)) {
      if (this.coverOf(m) !== box) continue;
      if (!m.paused) m.pause();
      this.muteHeld(m, box);
    }
    if (this.playListening) return;
    this.playListening = true;
    this.listenForPlay(this.doc);
  }

  /**
   * Cover a picture or video where it is painted. A poster or picture layer can arrive after the media was covered (Bluesky lays
   * its poster over the video later), so look once more when the media loads and after a moment; the wider cover then takes
   * over (hide drops the cover inside it).
   */
  private hideMedia(el: Element, res: MatchResult, why: Why, at?: Element): void {
    if (this.keptClear(el)) return;
    let box = this.paintBox(el);
    this.hide(box, res, why, at);
    // A player box that could not be covered (a whole page part, a shown or covered part): the video itself still is.
    if (box !== el && el.tagName === 'VIDEO' && !this.hidden.has(box) && !this.revealed.has(box)) { box = el; this.hide(el, res, why, at); }
    this.pausedWhileCovered(box);
    if (box !== el || (el.tagName !== 'IMG' && el.tagName !== 'VIDEO')) return;
    const again = () => {
      if (!el.isConnected || !this.hidden.has(el) || this.revealed.has(el) || el.getAttribute('data-gsb-why') !== why) return;
      const later = this.paintBox(el);
      if (later !== el) { this.hide(later, res, why, at); this.pausedWhileCovered(later); } else this.pausedWhileCovered(el);
    };
    setTimeout(again, 1500);
    el.addEventListener(el.tagName === 'VIDEO' ? 'loadeddata' : 'load', again, { once: true });
  }

  /** A video, or a picture wide enough to show something. Avatars, icons and emoji fall under the size. */
  private bigMedia(el: Element, least?: number): boolean {
    if (el.tagName === 'VIDEO') return true;
    const floor = least ?? (this.opts.containers && el.closest(this.opts.containers) ? CARD_MEDIA_PX : BIG_MEDIA_PX);
    // A picture drawn as a background has no width attribute: its laid-out box counts.
    if (el.tagName !== 'IMG') { const r = this.sizeOf(el); return r.w >= floor && r.h >= floor / 2; }
    const m = el as HTMLImageElement;
    // A control's picture that is not displayed (a toggled icon) and states no width has no size: its file's natural size says nothing.
    if (!el.getAttribute('width') && !el.getClientRects().length) {
      const control = el.closest('button, label, [role="button"]');
      if (control && control.getBoundingClientRect().width < BIG_MEDIA_PX) return false;
    }
    // A picture that has not loaded and states no width has size 0 here and is left alone: guessing would
    // blur every icon on the page. It is looked at again when it finishes loading (recheckOnLoad).
    // A thin strip (a site's wordmark, a divider: Google's 285x16 logo) is the page's own chrome, not a picture of anything: icon height, whatever its width.
    const h = Number(el.getAttribute('height')) || m.naturalHeight || 0;
    // Judged by the stated or natural height, but a loaded and displayed picture that is shown tall is not a strip (a page's own height="1" markup
    // scaled up by its CSS): a broken picture that renders short has not loaded, so its rendered height is not asked.
    const shown = m.complete && m.naturalHeight > 0 && el.getClientRects().length > 0 ? m.height : 0;
    if (h > 0 && h < 24 && !(shown >= 24)) return false;
    return (m.width || Number(el.getAttribute('width')) || m.naturalWidth || 0) >= floor;
  }

  /**
   * Laid-out sizes, read once per scan pass. A label added makes the next size read lay out the whole page again, so a scan
   * reads its pictures' sizes first (readSizes), before any label, and later checks in the same pass use those.
   */
  private boxSizes = new WeakMap<Element, { pass: number; w: number; h: number }>();
  private bgSeen = new WeakMap<Element, { pass: number; found: Element[] }>();
  /** A comment or reply (not a post): its picture-only cover stays the whole card, as before (the owner's answers are about posts). */
  private replyPost(post: Element): boolean {
    const o = this.opts;
    // Reddit: the comment containers are named apart from the posts. X: on a status page every article but the main one is a reply.
    if (o.primaryPost && o.threads && post.matches(o.threads)) return true;
    // (Not where the comments are named, Facebook: those go by the rule below, and a box around the main post is no reply.)
    if (o.main && o.threadKey && !o.replies && o.threadKey.test(this.doc.location?.pathname ?? '') && !post.matches(o.main)) return true;
    // Facebook: a comment's block (it holds its replies, which a cover of its picture alone would leave in view), and a reply inside one
    // that is a post box of its own (an article with siblings).
    if (o.replies && (post.matches(o.replies) || post.parentElement?.closest(o.replies))) return true;
    return false;
  }

  /** A banner or icon, not a picture worth a cover of its own (a 100 x 18 strip): its post is covered whole, as before. */
  private iconSized(el: Element): boolean {
    const s = this.sizeOf(el);
    return s.h > 0 && s.w > 0 && (s.h < 24 || s.w < 24);
  }

  private sizeOf(el: Element): { w: number; h: number } {
    const seen = this.boxSizes.get(el);
    if (seen && seen.pass === this.pass) return seen;
    const r = el.getBoundingClientRect();
    const e = { pass: this.pass, w: r.width, h: r.height };
    this.boxSizes.set(el, e);
    return e;
  }
  private widthOf(el: Element): number {
    return this.sizeOf(el).w;
  }
  private readSizes(el: Element): void {
    if (this.opts.containers) this.bgPictures(el);
  }

  /**
   * Pictures drawn only as a background (a computed background-image url, on the element or its ::before / ::after), with no
   * <img> or <video> in them: Bluesky's video tiles and Facebook's cards. Only inside a site's posts and cards, never page
   * chrome, and never a block of text with a background (that is judged as text).
   */
  private bgPictures(root: ParentNode): Element[] {
    const cards = this.opts.containers;
    const view = this.doc.defaultView;
    if (!cards || !view) return [];
    const scopes = root.nodeType === 1 && (root as Element).closest(cards) ? [root as Element] : [...(root.querySelectorAll?.(cards) ?? [])];
    const out: Element[] = [];
    for (const scope of scopes) {
      // A post is looked through once per scan pass, though its text, its cover and the scan itself all ask.
      const seen = this.bgSeen.get(scope);
      if (seen && seen.pass === this.pass) { out.push(...seen.found); continue; }
      const found: Element[] = [];
      this.bgSeen.set(scope, { pass: this.pass, found });
      for (const e of [scope, ...scope.querySelectorAll('*')]) {
        // Sizes are read here before any label of this scan is added (readSizes), so the page is laid out once for them.
        if ((e as HTMLElement).offsetWidth < CARD_MEDIA_PX || e.matches('img, video') || e.querySelector('img, video')) continue;
        if ((e.textContent ?? '').trim().length > 40 || e.closest('nav, header, footer')) continue;
        const bg = [view.getComputedStyle(e), view.getComputedStyle(e, '::before'), view.getComputedStyle(e, '::after')].map((st) => st.backgroundImage).join(' ');
        if (/url\(/.test(bg) && !this.layerOfMedia(e)) found.push(e);
      }
      out.push(...found);
    }
    return out;
  }

  /**
   * A background that is the painted layer of an <img> or <video> of about its size nearby (X's photos, Bluesky's posters):
   * that media covers it through paintBox, so it is not a picture of its own (two labels for one picture).
   */
  private layerOfMedia(e: Element): boolean {
    const r = e.getBoundingClientRect();
    const area = r.width * r.height;
    let a = e.parentElement;
    for (let up = 0; a && up < 6 && a !== this.doc.body; up++, a = a.parentElement) {
      const ar = a.getBoundingClientRect();
      if (area && ar.width * ar.height > 3 * area) break;
      for (const m of a.querySelectorAll('img, video')) {
        const mr = m.getBoundingClientRect();
        const w = Math.min(r.right, mr.right) - Math.max(r.left, mr.left);
        const h = Math.min(r.bottom, mr.bottom) - Math.max(r.top, mr.top);
        if (!mr.width || !mr.height) { if (m.parentElement === e.parentElement) return true; continue; }
        if (w > 0 && h > 0 && w * h >= (mr.width * mr.height) / 2 && mr.width * mr.height >= area / 2) return true;
      }
    }
    return false;
  }

  /**
   * What is inside a picture or video cannot be read, so one that sits next to the game's name is
   * blurred on its own. Only the media is covered: the words beside it (hype, news) stay readable.
   * `own` is the media's own description and file name, when the caller has already read them.
   */
  private nearGame(el: Element, own?: string): void {
    const mode = this.pics.mediaNearGame;
    if (mode === 'off' || !this.matcher.judgesPosts) return;
    if (mode === 'page' && !this.pageContext) {
      // Not a page about the game: only a picture in a card whose own words are covered (its title part, say) is still covered.
      const c = this.opts.containers ? el.closest(this.opts.containers) : null;
      if (!c || !this.wordsCovered(c)) return;
    }
    // A picture inside a small component's shadow root (Reddit's faceplate-img) is judged and covered at that component.
    const at = this.lightHost(el);
    // Hidden already (alone or inside a hidden post), or shown again by the user.
    if (this.skip(at) || isEmote(el) || at.closest('nav, header, footer')) return;
    // A post the person showed with one press stays shown: a picture that arrives in it later is not covered again.
    if (this.opts.containers) { const shown = this.shownPost(at); if (shown && this.isShown(shown)) return; }
    if (this.officialTrailer(at)) return;
    // In a post or result card that is covered, or that names the game on a page about the game, every picture goes, whatever
    // its size (Reddit's 120 px search thumbnails, Google's result images). Avatars outside cards are not touched.
    const card = this.opts.containers ? at.closest(this.opts.containers) : null;
    // A picture of a part-covered container that lies outside its cover part (a Gmail row's star or avatar) is the site's own controls: it
    // neither takes the row's cover with it nor is covered itself.
    if (card && this.outsideCoverPart(card, at)) return;
    const covered = !!card && this.wordsCovered(card);
    // A card covered by its own words covers everything in it, a reaction GIF too. In a card that only names the game, a
    // library GIF with a clean label is shown: its label decides.
    if (!covered && this.mediaVerdict(el) === 'clean') return;
    // On a page about the game a card naming it takes its result pictures, but not avatars, emoji or badge icons (read live:
    // result pictures from 72 px, avatars 40-55 px, emoji and icons under 40 px). The size first: reading the card for the name
    // costs a whole-card read, and on a big card with many icons that ran for each one on every text piece (a scan of one Google
    // card took over a second, and content arriving later waited behind it).
    const whole = !!card && (covered || (this.pageContext && this.bigMedia(el, NAMED_CARD_MEDIA_PX) && this.namedBeside(at, own)));
    if (!(whole || this.bigMedia(el) || this.isThumb(el))) return;
    // A part of the page that is not its subject (recommended videos, other games' capsules) is judged on its own words.
    const apart = !!this.opts.apart && !!at.closest(this.opts.apart);
    if (whole || (apart ? this.namedBeside(at, own) : this.pageContext || (mode === 'post' && this.namedBeside(at, own)))) {
      // Under the global choice: the same gates as above, with its mode.
      const byGlobal = (g: Pictures) => g.mediaNearGame !== 'off' && (g.mediaNearGame !== 'page' || this.pageContext || covered) && (whole || apart || this.pageContext || g.mediaNearGame === 'post');
      this.hideMedia(at, this.pictureRes(byGlobal), 'near-game');
    }
  }

  /** A media element inside a shadow root no bigger than about three times its own size is represented by that root's host. */
  private lightHost(el: Element): Element {
    const host = (el.getRootNode() as ShadowRoot).host;
    if (!host) return el;
    const r = el.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    return !r.width || !r.height || h.width * h.height <= 3 * r.width * r.height ? host : el;
  }

  private isThumb(el: Element): boolean {
    try {
      // Across an open shadow root too: the rule can name the component that holds the picture.
      const host = (el.getRootNode() as ShadowRoot).host;
      return !!this.opts.thumbs && (el.matches(this.opts.thumbs) || (!!host && host.matches(this.opts.thumbs)));
    } catch {
      return false;
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
    if (names(`${text} ${this.unseenText(card)}`)) return true;
    // A slide of a carousel has no words of its own: the post around it (its caption) is read too.
    const post = this.postOf(card);
    if (post === card) return false;
    const cap = this.captionOf(post);
    return names(`${this.ownText(post, cards)} ${cap ? this.ownText(cap, cards) : ''} ${this.unseenText(post)}`);
  }

  /** A post's caption when it is a card of its own (the first entry of an opened post's comment list, with no comment link), if any. */
  private captionOf(post: Element): Element | null {
    const o = this.opts;
    if (!o.slides || !o.containers) return null;
    for (const c of post.querySelectorAll(o.containers)) {
      if (c.parentElement?.closest(o.containers) !== post || c.matches(o.slides)) continue;
      return o.commentsInside && c.matches(o.commentsInside) ? null : c;
    }
    return null;
  }

  /** The post that one press on a cover in `el` shows: none in a dialog or viewer, unless `el` is in a slide of a carousel post there. */
  private shownPost(el: Element): Element | null {
    const card = this.opts.containers ? el.closest(this.opts.containers) : null;
    if (!card) return null;
    const post = this.postOf(card);
    // In a dialog the slides are not cards (the rule's list entries are those of the page's main), so a slide is found by itself.
    const slide = post !== card || (!!this.opts.slides && !!el.closest(this.opts.slides));
    return el.closest('[role="dialog"]') && !slide ? null : post;
  }

  /** The post a card belongs to: itself, or for a slide of a post's carousel (a card of its own, see Adapter.slides) the post around it. */
  private postOf(card: Element): Element {
    const o = this.opts;
    if (!o.slides || !o.containers || !card.matches(o.slides) || (o.commentsInside && card.matches(o.commentsInside))) return card;
    return card.parentElement?.closest(o.containers) ?? card;
  }

  /** What a picture or video says about itself: description, title and file name. */
  private mediaText(el: Element): string {
    const name = (el.getAttribute('src') ?? el.getAttribute('poster') ?? '').split(/[?#]/)[0]!.split('/').pop() ?? '';
    return [el.getAttribute('alt'), el.getAttribute('title'), el.getAttribute('aria-label'), safe(name)].filter(Boolean).join(' ');
  }

  /**
   * Watch-page players covered before their channel row and title were there: until when they are looked at again, and for which
   * video (a player reused for the next video, while YouTube swaps the page, is not decided by the last page's channel row).
   */
  private trailerWait = new Map<Element, { until: number; video: string }>();
  /**
   * Which video the page shows: its path and its v parameter. Other parameters do not count: YouTube adds and removes some while
   * loading (on a first visit it reloads with one and takes it off again).
   */
  private videoKey(): string {
    const loc = this.doc.location;
    if (!loc) return '';
    return `${loc.pathname}?v=${new URLSearchParams(loc.search).get('v') ?? ''}`;
  }
  /** A player whose page now shows an official trailer comes out from under its cover for being near the game. */
  /** A trailer waiting for its title or channel row is looked at again at once when the page changes (not only in the next clean-up). The caller's pass syncs the readers. */
  recheckNow(): void {
    if (this.trailerWait.size) this.recheckTrailers();
  }

  private recheckTrailers(): boolean {
    let changed = false;
    const now = Date.now();
    const video = this.videoKey();
    // Over a copy: an undecided one goes back on the list while this runs, and must not be visited again in this pass.
    for (const [el, w] of [...this.trailerWait]) {
      this.trailerWait.delete(el);
      if (!el.isConnected || now > w.until || w.video !== video) continue;
      if (!this.officialTrailer(el)) {
        // Still undecided (no channel row or title yet): officialTrailer put it back; it keeps its first deadline.
        if (this.trailerWait.has(el)) this.trailerWait.set(el, w);
        continue;
      }
      // The cover may sit on the box that paints the picture (hideMedia), around the player itself.
      const c = this.hidden.has(el) ? el : el.closest('[data-gsb]');
      const why = c ? this.whyOf.get(c) : undefined;
      if (c && this.hidden.has(c) && (why === 'near-game' || why === 'media')) { this.uncoverEl(c); changed = true; }
    }
    return changed;
  }

  /**
   * An up-next card whose channel row shows an official channel's whole name with a verified badge in the same row. The name alone
   * is not enough (anyone can copy a name); the badge is what a copy does not have.
   */
  private officialLockup(card: Element): boolean {
    const row = card.querySelector('.ytContentMetadataViewModelMetadataRow');
    if (!row || !row.querySelector('[aria-label="Verified"]')) return false;
    return isOfficialName(row.querySelector('.ytContentMetadataViewModelMetadataText')?.textContent ?? '');
  }

  /**
   * An official source's own trailer (Settings.allowTrailers): the main player of a watch page whose channel is official, or the
   * media of a post or result whose channel or author is, when its own title or text says trailer, teaser or reveal; any media on
   * the maker's own site. The channel is matched by its address (a handle or a channel id); only an up-next card, which has none, goes
   * by the whole name with the verified badge (officialLockup). A spoiler word or a name that hides alone in that title still keeps
   * it covered; the announced leads (weak names) do not.
   */
  private officialTrailer(el: Element): boolean {
    if (!this.opts.allowTrailers) return false;
    const host = this.doc.location?.hostname ?? '';
    if (OFFICIAL_SITES.includes(host)) return true;
    // Cheap first: most sites have no official accounts, and the text is read only once the channel is official.
    if (!hasOfficialHandles(host)) return false;
    const card = this.opts.containers ? el.closest(this.opts.containers) : null;
    const own = this.opts.ownPage;
    let link: Element | null = null;
    let title: () => string = () => '';
    if (card) {
      // The first channel or author link is the card's own; a later one may be a mention in its description.
      link = card.querySelector('a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"], a[href*="youtube.com/@"], a[href*="youtube.com/channel/"], [data-testid="User-Name"] a[href]');
      // A card whose words are covered keeps its media covered too.
      title = () => (this.wordsCovered(card) ? '' : this.textOf(card, POST_READ_CHARS));
    } else if (own?.page && el.closest(own.page)) {
      // The watch page's own player: the channel row and title of this page only (YouTube keeps earlier pages, hidden).
      const page = (own.parts ? el.closest(own.parts) : null) ?? el.closest('ytd-watch-flexy');
      link = page?.querySelector(`:is(${own.owner}) a[href]`) ?? null;
      title = () => page?.querySelector('ytd-watch-metadata h1, ytd-reel-video-renderer h2')?.textContent ?? '';
      // The player is built before its channel row and title: until both are there it stays covered, and is looked at again
      // (repair) for a while.
      if (!link || !title().trim()) {
        if (!this.trailerWait.has(el)) this.trailerWait.set(el, { until: Date.now() + TRAILER_WAIT_MS, video: this.videoKey() });
        return false;
      }
    }
    // A link names the channel by its address (a handle, or a /channel/ id of the list). YouTube's up-next cards have none: their
    // channel row holds its name and a verified badge instead.
    const href = link?.getAttribute('href') ?? '';
    const official = link ? isOfficialHandle(host, handleOf(href)) || isOfficialChannelLink(host, href) : !!card && isYouTube(host) && this.officialLockup(card);
    if (!official) return false;
    const text = title();
    if (!TRAILER_WORDS.test(text)) return false;
    const f = this.matcher.inspect(text);
    // The trailer words are spoiler words of the trailers kind themselves; any other kind (a leak, the story) still covers it.
    return ![...f.spoil].some((c) => c !== 'trailers') && !f.strong.size && !f.real?.size;
  }

  /**
   * On a page about the game, a site post that is a picture or video with next to no words is hidden:
   * what is in the media cannot be read, and it is on this page for a reason.
   */
  private mediaPost(el: Element): void {
    const cards = this.opts.containers;
    if (!this.pics.hideMediaPosts || !this.pageContext || !cards || !this.matcher.judgesPosts) return;
    const post = el.closest(cards);
    if (!post || post.hasAttribute('data-gsb') || this.isShown(this.postOf(post))) return;
    if (this.officialTrailer(el)) return;
    // Another thing than the page's subject (a recommended video, a trends card): its own words decide, not the page.
    if (this.opts.apart && el.closest(this.opts.apart)) return;
    if (!this.bigMedia(el) || this.mediaVerdict(el) === 'clean') return;
    // Counts and times are not words: "3  16  79  1.5K  0:12" under a clip says nothing.
    const words = this.ownText(post, cards).split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w) && !/^\d/.test(w));
    if (words.length >= MEDIA_ONLY_WORDS) return;
    const none = this.pictureRes((g) => g.hideMediaPosts);
    if (this.pics.thumbsOnly) this.hideMedia(el, none, 'media');
    else if (this.opts.mediaPostPictures && !this.replyPost(post)) {
      // Only the post's pictures, so its author row stays: this one, and the post's other pictures a whole-post cover took (link
      // previews, stickers), but not avatars and not the pictures of comments in it.
      const others = this.mediaIn(post).filter((m) => m !== el && this.lightHost(m).closest(cards) === post && !m.closest('[data-gsb], [data-gsb-revealed]') && (this.bigMedia(m, NAMED_CARD_MEDIA_PX) || this.isThumb(m)));
      const all = [el, ...others];
      // A banner or icon among them (a 100 x 18 strip): not a picture worth a cover of its own, and the post is covered whole, as before.
      if (all.some((m) => this.iconSized(m))) this.hide(post, none, 'media');
      else {
        for (const m of all) this.coverPicture(m, post, none);
        if (this.opts.main && this.mc?.el === post) this.startCover();
      }
    } else this.hide(post, none, 'media');
  }

  /**
   * One picture of a picture-only post, covered so that a click on it goes nowhere, as under a whole-post cover. A link that holds
   * only this picture (no words, no label) is covered with it: the link itself when it is laid out as the picture's box, else the
   * nearest box around it that is (an inline link around a block picture is a thin strip), else the link anyway.
   */
  private coverPicture(m: Element, post: Element, res: MatchResult): void {
    const link = m.closest('a[href]');
    const bare = (b: Element) => this.mediaIn(b).length <= 1 && !/\p{L}/u.test(b.textContent ?? '') && !b.getAttribute('aria-label');
    if (!link || link === post || !post.contains(link) || !bare(link)) { this.hideMedia(m, res, 'media'); return; }
    const r = this.sizeOf(m);
    // About the picture's height and at least its width: a wider box is fine, as it holds nothing else (bare).
    const fits = (b: Element) => { const s = this.sizeOf(b); return s.h >= 0.9 * r.h && s.h <= 1.5 * r.h && s.w >= 0.9 * r.w; };
    let box: Element = link;
    for (let b: Element | null = link; b && b !== post; b = b.parentElement) if (fits(b) && bare(b)) { box = b; break; }
    this.hide(box, res, 'media');
    this.pausedWhileCovered(box);
  }

  private skip(el: Element, bio = false): boolean {
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
    if ((el as HTMLElement).isContentEditable) return true;
    if (!bio && this.inNames(el)) return true;
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
    this.changes++;
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
    this.changes++;
  }

  /**
   * A site can reuse a hidden card for something else (YouTube does in its suggested-videos column), which
   * would leave a label on a clean card. When the content of a card hidden for a blocks-alone name inside it
   * changes, the card is judged again from scratch. Hides that depend on anything outside the card are left alone.
   * (A spoiler account's card is judged again when its link changes: linkChanged.)
   */
  private rejudge(root: Node): void {
    const cards = this.opts.containers;
    // Not on a thread page whose replies follow the main post (X; Reddit's post pages). Reddit's feeds and searches are judged again as before,
    // and so is all of Facebook (its comments are named, and its post pages kept this rule before they had a main post).
    if (!cards || (!this.opts.replies && this.opts.main && (!this.opts.threads || this.threadKey() !== null))) return;
    const cover = (root.nodeType === 1 ? (root as Element) : root.parentElement)?.closest('[data-gsb]');
    if (!cover || cover === root || !this.hidden.has(cover) || cover.getAttribute('data-gsb-why') !== 'alone' || this.dialogOf.has(cover)) return;
    // The cover may sit on a part of the card (a Gmail row's subject and preview): the card is judged, the part is what comes off (B-037).
    const card = cover.matches(cards) ? cover : cover.closest(cards);
    if (!card || (card !== cover && !this.opts.coverParts)) return;
    if (this.flagged && card.matches(this.opts.threads!)) return;
    // Still a blocks-alone name with the same kind of match: keep the cover as it is. A page that rewrites a counter inside the card
    // every moment would otherwise have us take the cover off and put it on again each time.
    const found = this.matcher.inspect(this.ownText(card, cards));
    const res = found.strong.size ? this.matcher.decide(found, this.pageContext, this.pageContext) : null;
    if (res && JSON.stringify(this.hideKeys.get(cover)) === JSON.stringify(keysFor('alone', res.groups))) return;
    this.unhide(cover);
    // Read again whatever the joined-text cache says: the card reads the same as before, which is why it would be skipped, and
    // its cover has just been taken off (without this, a wordless piece added to a hidden chat line left it open).
    const before = this.forceJoin;
    this.forceJoin = true;
    try {
      this.scan(card);
    } finally {
      this.forceJoin = before;
    }
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

  private styleRoot(r: ShadowRoot): void {
    let st = ROOT_STYLES.get(r);
    if (!st) {
      st = this.doc.createElement('style');
      st.setAttribute('data-gsb-style', '');
      r.append(st);
      ROOT_STYLES.set(r, st);
    }
    // Written only when it changes (a new blur strength): each write is a page change the watcher would read again.
    const css = cssFor(this.opts.blur);
    if (st.textContent !== css) st.textContent = css;
  }

  /** Covers that came from one dialog (see dialogParts): one click or hold shows them all, and one bar is shown for them. */
  private dialogSets = new Set<Set<Element>>();
  private dialogOf = new WeakMap<Element, Set<Element>>();
  /** Each covered dialog with its parts and the verdict that covered it: content that lands later, outside every part, is covered by it. */
  private dialogSrc = new Map<Element, { set: Set<Element>; res: MatchResult; why: Why }>();

  private isDialogEl(el: Element): boolean {
    return el.matches('[role="dialog"], [role="alertdialog"], dialog');
  }

  /** A node whose content cannot be covered piece by piece: a shadow host (its shadow words) or a child with no box of its own. */
  private opaque(node: Element, kids: Element[]): boolean {
    if (node.shadowRoot) return true;
    const view = this.doc.defaultView;
    return !!view && kids.some((c) => view.getComputedStyle(c).display === 'contents');
  }

  /**
   * What to cover instead of a dialog (role=dialog, alertdialog or a dialog element): its content, so each label sits inside it.
   * A single wrapper is stepped through, down to the first level that branches, has words of its own, or holds a picture, a
   * drawing or the like: that level's children, or that level whole when it has words of its own. Null for anything else, a dialog
   * with words of its own or nothing in it, and a dialog nested deeper than the cap is covered at the level reached.
   * Known limit: in every reply mode (also "only that comment") a dialog is covered by its parts, comments inside them included,
   * so showing the post shows the comments in the same parts with it; they are not judged one by one there.
   * The same whole-dialog fallback (its label before the dialog, outside it) also happens when the dialog's own direct children
   * include a display:contents box or the dialog is a shadow host, not only with words straight in the dialog. Those words are not
   * wrapped: the page owns its text nodes.
   */
  private dialogParts(el: Element): Element[] | null {
    if (!this.isDialogEl(el)) return null;
    let node: Element = el;
    for (let i = 0; i < 12; i++) {
      if (this.looseText(node)) return node === el ? null : [node];
      const kids = [...node.children].filter((c) => !c.classList.contains('gsb-bar') && !DIALOG_SKIP.has(c.tagName.toUpperCase()));
      if (kids.length === 0 || this.opaque(node, kids)) return node === el ? null : [node];
      if (kids.length > 1 || kids[0]!.getAttribute('role') === 'article' || DIALOG_LEAF.has(kids[0]!.tagName.toUpperCase())) return kids;
      node = kids[0]!;
    }
    return node === el ? null : [node];
  }

  /**
   * Content that lands in a covered dialog after it was covered, outside every part (a panel swapped in, a composer, "more
   * comments"): the dialog is covered again, which takes it in as a part. Not once the user showed every part.
   */
  private coverLateInDialog(node: Element): void {
    if (!this.dialogSrc.size || node.closest('.gsb-bar')) return;
    for (const [d, src] of this.dialogSrc) {
      if (!d.contains(node) || node === d || !this.covered(d)) continue;
      if ([...src.set].some((p) => p.isConnected && (p.contains(node) || node.contains(p)))) continue;
      this.hide(d, src.res, src.why);
    }
  }

  /**
   * A table cell narrower than the label its cover would carry (a navbox's vertical column of links, 19 px wide) is not a unit worth a bar:
   * the first ancestor that is wide enough, the row and at most the table itself, is covered as one block with one bar (one press shows it all).
   * Never past the table. Only table cells are looked at (a width read), so the common path stays free of layout reads.
   */
  private wideEnough(el: Element, label: string): Element {
    if (el.tagName !== 'TD' && el.tagName !== 'TH') return el;
    // Inside something already covered or shown: nothing to decide (and no layout read for it).
    if (el.parentElement?.closest('[data-gsb], [data-gsb-revealed]')) return el;
    const need = this.labelWidth(label, this.opts.hideMode === 'collapse');
    const w = el.getBoundingClientRect().width;
    if (w === 0 || w >= need) return el;
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (n.tagName === 'TABLE' || n.getBoundingClientRect().width >= need) {
        // Not a whole page layout (a layout table whose row is the page's content, or a long one): then the cell keeps its own cover and its eye.
        if ((n.textContent?.length ?? 0) > MAX_POST_CHARS || n.querySelector('main, nav, header, footer, [role="main"]')) return el;
        return n;
      }
    }
    return el;
  }

  /**
   * The part of a container the adapter says is the cover (an inbox row's subject and preview), when it has one; else the element itself.
   * Not when the match sits outside that part (a name in the sender): the part would leave it showing, so the whole container is covered.
   */
  private partOf(el: Element, at?: Element): Element {
    const parts = this.opts.coverParts;
    if (!parts) return el;
    for (const [container, sel] of Object.entries(parts)) {
      if (!el.matches(container)) continue;
      const part = el.querySelector(sel);
      if (!part) return el;
      if (at && !part.contains(at) && !at.contains(part)) {
        // A match found in text nobody sees (Gmail's screen-reader summary of a row repeats its sender, subject and preview) says nothing about
        // where the words are: what counts is whether a rendered copy outside the part matches (a sender), else the part is the cover.
        if (!this.holdsUnrendered(at, el) || this.renderedMatchOutside(el, part)) return el;
      }
      return part;
    }
    return el;
  }

  /** Is `el` inside `card` but outside the part the adapter says is the card's cover (see partOf)? */
  private outsideCoverPart(card: Element, el: Element): boolean {
    for (const [container, sel] of Object.entries(this.opts.coverParts ?? {})) {
      if (!card.matches(container)) continue;
      const part = card.querySelector(sel);
      return !!part && !part.contains(el) && !el.contains(part);
    }
    return false;
  }

  /** Is `n` (or an ancestor up to `root`) not drawn (display: none)? */
  private unrendered(n: Element, root: Element): boolean {
    const win = this.doc.defaultView;
    for (let e: Element | null = n; e && e !== root.parentElement; e = e.parentElement) if (win?.getComputedStyle(e).display === 'none') return true;
    return false;
  }

  /** Is `at` itself not drawn, or does it hold text that is not drawn? */
  private holdsUnrendered(at: Element, root: Element): boolean {
    if (this.unrendered(at, root)) return true;
    const w = this.doc.createTreeWalker(at, 4);
    for (let t = w.nextNode(); t; t = w.nextNode()) if (t.nodeValue?.trim() && t.parentElement && this.unrendered(t.parentElement, at)) return true;
    return false;
  }

  /** Does drawn text of `root`, outside `part`, hold a match that would cover on its own? */
  private renderedMatchOutside(root: Element, part: Element): boolean {
    const w = this.doc.createTreeWalker(root, 4);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      const p = t.parentElement;
      const text = t.nodeValue;
      if (!p || !text || text.trim().length < 3 || part.contains(p) || this.unrendered(p, root)) continue;
      if (this.matcher.decide(this.matcher.inspect(text), this.pageContext, this.pageContext)) return true;
    }
    return false;
  }

  /**
   * An official store or the publisher's own site (Settings.allowStores): a page of those hosts, a search result or card whose own link goes
   * to one, or a post of the publisher's own account is shown though it names the game. Only the announced leads (weak names, the game's name,
   * pictures beside it): a name that hides alone, a story spoiler word, chat and spoiler accounts keep their cover, as with the trailer allow.
   */
  private storePass(el: Element, why: Why, at?: Element): boolean {
    if (!this.opts.allowStores || !STORE_WHY.has(why)) return false;
    const loc = this.doc.location;
    if (!loc) return false;
    const card = (this.opts.containers ? el.closest(this.opts.containers) : null) ?? el;
    let userCard = false;
    if (!(isStorePage(loc.hostname, loc.pathname) || this.byPublisher(card, loc.hostname))) {
      const link = this.linksToStore(card, loc.hostname);
      if (!link) return false;
      userCard = link === 'card';
    }
    // A card written by people (a Reddit link post, an X link card): only the card's own store-provided picture passes, never the words around
    // it (the post text, the title, any name in the preview): a troll can point any post at a store page.
    if (userCard && !this.inCardPreview(at ?? el, why)) return false;
    // A story spoiler word or a name that hides alone anywhere in it keeps it covered, whatever the reason given (read from its words).
    for (const t of [this.textOf(card, POST_READ_CHARS), this.unseenText(card, true), at ? at.textContent ?? '' : '']) {
      const found = this.matcher.inspect(t);
      if (found.strong.size || found.spoil.size) return false;
    }
    return true;
  }

  /**
   * Does the card's own link go to a store page of an official host? Only where a card IS a link: a search result (its first link that leaves
   * the search engine; never a side panel), a link post's content-href (Reddit), an X post's link card. Not a comment, a message or any
   * other text of people that happens to hold a link.
   */
  private linksToStore(card: Element, host: string): 'search' | 'card' | null {
    let scope: Element | null = null;
    let isX = false;
    if (card.localName === 'shreddit-post') {
      const direct = card.getAttribute('content-href');
      return direct && isStoreLink(direct) ? 'card' : null;
    }
    if (/(?:^|\.)x\.com$|(?:^|\.)twitter\.com$/.test(host)) { scope = card.querySelector('[data-testid="card.wrapper"]'); isX = true; }
    else if (/(?:^|\.)(?:google\.[a-z.]+|bing\.com|duckduckgo\.com)$/.test(host) && !(this.opts.panels && card.closest(this.opts.panels))) scope = card;
    if (!scope) return null;
    for (const a of scope.querySelectorAll('a[href]')) {
      let u: URL;
      try { u = unwrap(new URL((a as HTMLAnchorElement).href, 'https://h.invalid/')); } catch { continue; }
      if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.hostname === host || u.hostname === 'h.invalid') continue;
      return isStoreLink(u.href) ? (isX ? 'card' : 'search') : null;
    }
    return null;
  }

  /** Is this picture the store-provided preview of a link card (X: inside the card wrapper; Reddit: a picture of the link post, not its text)? */
  private inCardPreview(t: Element, why: Why): boolean {
    if (why !== 'media' && why !== 'near-game') return false;
    if (t.matches('shreddit-post') || t.querySelector('[slot="text-body"], [slot="title"]')) return false; // the whole post is not the preview
    if (!(t.matches('img, video, picture, canvas, svg') || t.querySelector('img, video, picture'))) return false;
    return !!t.closest('[data-testid="card.wrapper"]') || (!!t.closest('shreddit-post') && !t.closest('[slot="text-body"], [slot="title"]'));
  }

  /** Is this post by the publisher's own account (the author link of its header)? */
  private byPublisher(card: Element, host: string): boolean {
    if (!hasPublisherAccounts(host)) return false;
    const a = card.querySelector('[data-testid="User-Name"] a[href], header a[href], h2 a[href], h3 a[href]');
    return !!a && isPublisherHandle(host, handleOf(a.getAttribute('href') ?? ''));
  }

  /** Set by hide() when it left the element alone because the site's rule does not cover it (strongOnly): the caller did not cover anything (B-038). */
  private declined = false;

  /** `at` is where the match itself sits, when the hide comes from a match and not from judging the post. */
  private hide(el: Element, res: MatchResult, why: Why = 'alone', at?: Element): void {
    if (this.storePass(el, why, at)) {
      this.declined = true; // nothing was covered: the caller must not say it was (B-038)
      return;
    }
    el = this.partOf(el, at);
    // A channel-list entry is navigation: only a strong listed name by itself covers it, not a weak name, a spoiler word or the chat around it.
    if (this.opts.strongOnly && why !== 'alone' && el.matches(this.opts.strongOnly)) {
      this.declined = true;
      return;
    }
    el = this.wideEnough(el, this.opts.showReason === false ? 'Hidden' : reasonLabel(why, res, el));
    if (this.revealed.has(el)) {
      // A dialog the person showed stays shown, except where new content lands outside every part they showed (the next post swapped
      // in) and that content is a match itself: only that part is covered, by the parts path below.
      const src = this.dialogSrc.get(el);
      if (!src || !at || !el.contains(at) || [...src.set].some((p) => p.isConnected && (p.contains(at) || at.contains(p)))) return;
      // ...and only when the new content matches by itself, not through the words of what they showed (a card is read as a whole).
      const own = at.matches('img, video') ? this.mediaText(at) : at.textContent ?? '';
      if (!own || !this.matcher.match(own, this.pageContext)) return;
    }
    // A dialog is covered by its content, not as a whole: the label sits right before what it covers, and before the dialog
    // that is outside it, where a click is a click on the page behind (Facebook's photo viewer closes on it).
    const parts = this.hidden.has(el) ? null : this.dialogParts(el);
    if (parts) {
      // A dialog inside a dialog's part joins the outer group; one seen before keeps its group.
      const outer = [...this.dialogSrc.keys()].find((d) => d !== el && d.contains(el) && this.covered(d));
      const set = this.dialogSrc.get(el)?.set ?? this.dialogOf.get(el) ?? (outer && this.dialogSrc.get(outer)?.set) ?? new Set<Element>();
      this.dialogSets.add(set);
      // Dialogs already covered inside this one (their parts were covered first) join its group.
      for (const [d2, src2] of this.dialogSrc) {
        if (d2 === el || !el.contains(d2) || src2.set === set || !this.covered(d2)) continue;
        for (const g of src2.set) { set.add(g); this.dialogOf.set(g, set); }
        this.dialogSets.delete(src2.set);
        this.dialogSrc.set(d2, { ...src2, set });
      }
      this.dialogSrc.set(el, { set, res, why });
      this.viewerShown.delete(el);
      for (const g of set) if (!g.isConnected) set.delete(g);
      for (const p of parts) {
        set.add(p);
        this.dialogOf.set(p, set);
        this.hide(p, res, why, at && p.contains(at) ? at : undefined);
      }
      return;
    }
    const r = el.getRootNode();
    if (r !== this.doc && (r as ShadowRoot).host) this.styleRoot(r as ShadowRoot);
    // Never the whole page: that would blank it for one match.
    if (this.pageLevel(el) && !this.cardFor(el)) return;
    if (this.opts.main) {
      if (el.closest('[data-gsb-under]')) return;
      // A main post the user showed stays shown, even when the site builds the element again (Facebook: only that post, see shownMain).
      const k = el.matches(this.opts.main) ? this.threadKey() : null;
      if (k !== null && this.mainShown(el, k)) return;
    }
    // The match sits in the replies' own area ("more replies" text): that area cannot stay uncovered.
    const inReplies = !!at && this.flagged && at !== el && !!this.replyUnder(el, at);
    if (this.hidden.has(el)) {
      if (inReplies && el.hasAttribute('data-gsb-own')) this.widen(el);
      return;
    }
    // Before the cover is set: a collapsed picture has no width after.
    const picW = this.pictureWidth(el);
    const own =this.flagged && el.matches(this.opts.threads!) && !inReplies && !this.whole.has(el);
    // Anything inside this element that was hidden on its own earlier is now covered by this one:
    // drop those so a card never carries labels within labels. Hidden replies under a comment
    // that keeps its replies uncovered stay as they are.
    // The exception: a cover for a picture or video keeps a cover for words inside it (a title laid over the player).
    const mediaCover = why === 'near-game' || why === 'media';
    for (const [inner, innerBar] of this.hidden) {
      if (inner !== el && el.contains(inner) && !(own && this.replyUnder(el, inner)) && !(mediaCover && !['near-game', 'media'].includes(inner.getAttribute('data-gsb-why') ?? ''))) this.uncoverEl(inner, innerBar);
    }
    // A new cover starts unpeeked (a peek can be left over from an earlier run of the extension).
    el.removeAttribute('data-gsb-peek');
    el.setAttribute('data-gsb', this.opts.hideMode);
    this.changes++;
    // Pictures in a comment covered for its words stay covered at the same address if its text is later replaced (reply pictures).
    if (why !== 'near-game' && why !== 'media' && this.opts.threads && el.matches(this.opts.threads)) {
      for (const m of el.querySelectorAll('img, video')) if (m.closest(this.opts.containers!) === el) this.underWords.set(m, this.picSrc(m));
    }
    // Which rule hid it. A rule name only, never the matched words.
    el.setAttribute('data-gsb-why', why);
    this.whyOf.set(el, why);
    // The setting that made it, when the person changed one (a code only).
    const source = this.opts.coverSource ? pickSource(why, res, this.opts.coverSource, why === 'account' ? this.accountOf(at) : null) : null;
    if (source) {
      el.setAttribute('data-gsb-source', source);
      this.sourceOf.set(el, source);
    } else {
      el.removeAttribute('data-gsb-source');
      this.sourceOf.delete(el);
    }
    if (DEBUG_WHY && this.opts.debugWhy) el.setAttribute('data-gsb-debug', [...(res.hits ?? [])].join(' | '));
    this.hideKeys.set(el, keysFor(why, res.groups));
    let bar: HTMLElement | null = null;
    if (this.opts.hideMode !== 'remove') {
      const btn = this.doc.createElement('button');
      btn.type = 'button';
      bar = btn;
      bar.className = 'gsb-bar';
      // The collapsed line is small: the item is gone, only a trace is left.
      if (this.opts.hideMode === 'collapse') bar.setAttribute('data-gsb-line', '');
      const base = this.opts.showReason === false ? 'Hidden' : reasonLabel(why, res, el);
      // " · Strict": the setting that made the cover, after the reason (not with "say why" off). The tip says it in a sentence.
      const tag = source && this.opts.showReason !== false ? SOURCE_TAG[source] : '';
      if (tag) this.barTag.set(bar, tag);
      const name = this.tagged(bar, base);
      this.wireReveal(el, bar, name);
      // A bar in a table's flow takes room from the next cells, and one in a dialog (a photo viewer) lies near the dialog's own controls:
      // there the drawn label stays as long as before, and the tag is only in the aria-label and the tip.
      if (tag && (el.matches('td, th, tr') || !!el.closest('[role="dialog"], [role="alertdialog"], dialog') || this.inViewer(el))) {
        bar.textContent = (bar.textContent ?? name).replace(` · ${tag}`, '');
        this.ariaTagOnly.add(bar);
      }
      this.addChangeTip(bar, el, why, source && this.opts.showReason !== false ? `${base}. ${SOURCE_SENTENCE[source]}` : name, source);
      // A label wider than the picture it covers would hang over the page (and over the next picture in a grid): there it is an
      // eye button, its words for screen readers. Anything else covered in blur is measured again once laid out (sizes).
      // (What is drawn, with the hold-to-peek hint when there is one: the width test measures that.)
      this.barName.set(bar, bar.textContent ?? name);
      this.barBase.set(bar, base);
      if (picW > 0) this.narrowBar(bar, el, picW, this.sizeOf(el).h);
      // Plain-language rule, no names. Debug adds the matched terms, which are the spoilers themselves.
      bar.title = DEBUG_WHY && this.opts.debugWhy ? [WHY_TEXT[why], ...(res.hits ?? [])].join('\n') : WHY_TEXT[why];
      // The page put a new node where a covered one was (Search Fixer, some feeds): the old one's bar is still in front of it
      // until the next clean-up. It goes now, so the new cover has one bar; the clean-up still forgets the old cover.
      const prev = el.previousElementSibling;
      if (prev instanceof HTMLElement && prev.classList.contains('gsb-bar')) {
        const owner = this.barOwner.get(prev);
        if (!owner || !owner.isConnected) prev.remove();
      }
      this.barOwner.set(bar, el);
      this.placeBar(el, bar);
    }
    this.hidden.set(el, bar);
    this.bigMemo.clear();
    // A cover made now may be the first in a dialog just opened: look for a dialog again.
    this.dialogAt = 0;
    // A collapsed item has no size by design, so its line is never tucked away by the size watcher.
    if (bar && this.opts.hideMode === 'blur') { this.sizes?.observe(el); this.scheduleStack(); }
    if (own) this.openAll(el);
    else if (this.flagged) this.whole.add(el);
    if (this.opts.main && this.mc?.el === el) this.startCover();
    // A picture of the main post covered on its own, where that counts as the post covered (see holdsPictureCover): its replies go now,
    // not at the next pass (there may be none).
    else if (this.opts.main && this.coverKey === null && (why === 'near-game' || why === 'media') && this.mc?.el?.contains(el) && this.holdsPictureCover(this.mc.el)) this.startCover();
    // Part of a post or result card is covered (its title, say): every picture in that card goes too, whatever its size.
    if (this.pics.hideImages && this.opts.containers && why !== 'near-game' && why !== 'media') {
      const card = el.closest(this.opts.containers);
      if (card && card !== el) this.mediaIn(card).forEach((m) => this.nearGame(m));
    }
  }

  /** Bars that lie over their unit (see settleBars), not in the page's flow, and bars to be looked at once their unit has a size. Bar -> its unit. */
  private barOver = new Map<HTMLElement, Element>();
  private undecided = new Map<HTMLElement, Element>();
  private refitQueued = false;
  private refitOn = false;
  private onScroll = () => { if (this.barOver.size || this.probeBars.size) this.queueRefit(); };

  /**
   * The bar goes before its unit, in flow. Whether it should lie over the unit instead is decided later, with the page laid out (settleBars).
   * (A bar lost under a sibling stacking context of the page, a link layer say, is not handled: a top-layer or anchor-positioned bar is a
   * possible later step.)
   */
  private placeBar(el: Element, bar: HTMLElement): void {
    if (bar.nextElementSibling !== el) el.before(bar);
    this.barOver.delete(bar);
    for (const p of ['position', 'left', 'top']) bar.style.removeProperty(p);
    // A slotted unit's layout parents are in the shadow tree: its bar stays in flow.
    if (this.opts.hideMode === 'collapse' || (el as HTMLElement).assignedSlot) return;
    this.undecided.set(bar, el);
    this.spotKey.delete(bar);
    // A dialog part's bar is looked at on each refit: the page's own controls may lie over it (clearDialogBars).
    if (this.inViewer(el)) {
      this.probeBars.set(bar, el);
      this.watchScroll();
      // Put back in the same pass where it was moved to, not at the corner for a frame.
      if (this.nudge.has(bar) && bar.isConnected) {
        for (const p of ['left', 'top']) bar.style.setProperty(p, '0px');
        bar.style.setProperty('position', 'absolute');
        this.barOver.set(bar, el);
        this.fitBars([[el, bar]]);
      }
    } else this.nudge.delete(bar);
    this.queueRefit();
  }

  /** Bars of a dialog's parts, with their units; what was last seen of each (its place and the viewport); where each was moved to. */
  private probeBars = new Map<HTMLElement, Element>();
  private probeAt = 0;
  private spotKey = new WeakMap<HTMLElement, string>();
  private nudge = new WeakMap<HTMLElement, { x: number; y: number }>();

  /** How many of five points of a box lie on a node that `ok` accepts (the centre first; 0 when the centre is not one). */
  private probe(bar: HTMLElement, l: number, t: number, w: number, h: number, ok: (n: Element) => boolean): number {
    // From the root the bar is in (a shadow tree answers with its own nodes, the document only with the host).
    const rn = bar.getRootNode() as Document | ShadowRoot;
    const root = typeof rn.elementFromPoint === 'function' ? rn : this.doc;
    let hits = 0;
    let centre = false;
    [[0.5, 0.5], [0.06, 0.2], [0.94, 0.2], [0.06, 0.8], [0.94, 0.8]].forEach(([fx, fy], i) => {
      const n = root.elementFromPoint(l + w * fx!, t + h * fy!);
      if (n && ok(n)) { hits++; if (i === 0) centre = true; }
    });
    return centre ? hits : 0;
  }

  /** Places in its unit where a bar could be clicked, best first (a few inward from the corner): offsets from the unit's top left, and the points hit. */
  private spots(el: Element, bar: HTMLElement, all = false): { x: number; y: number; score: number }[] {
    const win = this.doc.defaultView;
    if (!win) return [];
    const u = el.getBoundingClientRect();
    const L = Math.max(u.left, 0), T = Math.max(u.top, 0), R = Math.min(u.right, win.innerWidth), B = Math.min(u.bottom, win.innerHeight);
    if (R - L < 8 || B - T < 8) return [];
    const b = bar.getBoundingClientRect();
    const w = b.width || 180, h = b.height || 24;
    // Whole pixels: the bar's own width differs by a hair between looks, and a moved bar must not be written again for that.
    const cx = Math.round((R - L - w) / 2), cy = Math.round((B - T - h) / 2);
    // A cover takes no pointer events, so a clear spot over it answers with what lies under it: the unit, or one of its ancestors.
    // (Only a guess: a bar moved there is looked at again with the bar itself, see clearDialogBars.)
    const ok = (n: Element) => bar.contains(n) || el.contains(n) || n.contains(el);
    const found: { x: number; y: number; score: number }[] = [];
    // A viewer's chrome sits at the edges, so the centre of a large unit is the first place tried; a small one keeps its corner.
    const tries = [[0, 0], [0, 64], [96, 0], [96, 64], [0, cy], [cx, 0], [cx, cy], [96, 112]] as [number, number][];
    if (this.opts.viewers && this.roomy(el)) tries.unshift(tries.splice(6, 1)[0]!);
    for (const [dx, dy] of tries) {
      const x = Math.max(0, Math.min(dx, R - L - w)), y = Math.max(0, Math.min(dy, B - T - h));
      const score = this.probe(bar, L + x, T + y, w, h, ok);
      if (score > 0) found.push({ x: L + x - u.left, y: T + y - u.top, score });
      if (score >= SPOT_OK && !all) break;
    }
    return found.sort((p, q) => q.score - p.score);
  }

  /** Is the unit large enough for its bar to lie at its centre (not a small one, whose bar keeps the corner)? */
  private roomy(el: Element): boolean {
    const u = el.getBoundingClientRect();
    return u.width >= 64 && u.height >= 64;
  }

  /** How well a bar can be clicked where it is, else where it could be (see spots; only for bars clearDialogBars moves). */
  private spotScore(el: Element, bar: HTMLElement): number {
    const b = bar.getBoundingClientRect();
    const now = b.width && b.height ? this.probe(bar, b.left, b.top, b.width, b.height, (n) => bar.contains(n)) : 0;
    return now >= SPOT_OK || !this.probeBars.has(bar) || this.blocked.has(bar) ? now : Math.max(now, this.spots(el, bar)[0]?.score ?? 0);
  }

  /** The bars of dialog parts that could not be put where all of them can be clicked (the group's lead is looked for again once). */
  private blocked = new WeakSet<HTMLElement>();

  /** Where a bar is clicked for real: points hit on the bar itself (0 when not all), and, once moved, the bar lies inside its part. */
  private barScore(el: Element, bar: HTMLElement): number {
    const b = bar.getBoundingClientRect();
    if (!b.width || !b.height) return 0;
    const hits = this.probe(bar, b.left, b.top, b.width, b.height, (n) => bar.contains(n));
    if (!this.nudge.has(bar)) return hits;
    const u = el.getBoundingClientRect();
    return b.left >= u.left - 2 && b.top >= u.top - 2 && b.right <= u.right + 2 && b.bottom <= u.bottom + 2 ? hits : 0;
  }

  /** The bar's place, its part's, and the viewport: what a look at the bar depends on. Null for a bar with no box. */
  private spotKeyOf(el: Element, bar: HTMLElement): string | null {
    const win = this.doc.defaultView;
    const b = bar.getBoundingClientRect();
    if (!win || !b.width || !b.height) return null;
    const u = el.getBoundingClientRect();
    return [b.left, b.top, b.width, u.left, u.top, u.width, u.height, win.innerWidth, win.innerHeight].map(Math.round).join();
  }

  /**
   * A dialog part's bar that the page's own controls cover (a viewer's close button, arrows, a comment box lie over its content) moves
   * inward within its part, to the first place where it can be clicked, checked with the bar itself once it is there. Only when the bar's
   * place, its part's or the viewport changed (the key is taken again after a move, so a bar with no good place is not looked at again
   * until something changes). A part with no such place hands the group's bar to another part (stackBars), once.
   */
  private clearDialogBars(pairs: [Element, HTMLElement][]): void {
    // No dialog covered by parts, and no dialog open on a site with photo viewers: nothing to look at (no cost for the other pages).
    if (!this.dialogSrc.size && !(this.opts.viewers && this.hasDialog())) return;
    this.checkLeads();
    // A viewer with very many covers: only those in the window, and a few at a time, from where the last pass stopped.
    const n = pairs.length;
    const from = n ? this.probeAt % n : 0;
    this.probeAt = 0;
    let looked = 0;
    for (let i = 0; i < n; i++) {
      const [el, bar] = pairs[(i + from) % n]!;
      if (!this.inViewer(el)) { this.probeBars.delete(bar); continue; }
      if (!bar.isConnected || !el.isConnected) { this.probeBars.delete(bar); continue; }
      // A part of a viewer keeps its bar near the top left, never the short form at the bottom (a cover made before its dialog was one).
      if (bar.hasAttribute('data-gsb-short')) this.narrowBar(bar, el, 0, 0);
      if (bar.hasAttribute('data-gsb-stacked')) continue;
      // Looked at on every refit and scroll, and the 1 s tick.
      if (!this.probeBars.has(bar)) { this.probeBars.set(bar, el); this.watchScroll(); }
      if (this.visArea(el) === 0) continue;
      const key = this.spotKeyOf(el, bar);
      if (key === null || this.spotKey.get(bar) === key) continue;
      if (looked++ >= 30) { this.probeAt = from + i; break; }
      // A bar of a large unit is put at the centre once (nudge); it stays there while it can be clicked.
      if (this.barScore(el, bar) >= SPOT_OK && (this.nudge.has(bar) || !this.opts.viewers || !this.roomy(el))) {
        this.spotKey.set(bar, key);
        this.blocked.delete(bar);
        continue;
      }
      this.moveBar(el, bar);
      this.spotKey.set(bar, this.spotKeyOf(el, bar) ?? key);
    }
  }

  private moveBar(el: Element, bar: HTMLElement): void {
    // Out of flow first: the part moves up by the bar's height, so the places are looked for in the layout the bar will have.
    if (!this.barOver.has(bar)) {
      this.nudge.delete(bar);
      for (const p of ['left', 'top']) bar.style.setProperty(p, '0px');
      bar.style.setProperty('position', 'absolute');
      this.barOver.set(bar, el);
      this.fitBars([[el, bar]]);
    }
    let best: { x: number; y: number } | null = null;
    let bestScore = -1;
    for (const c of this.spots(el, bar, true).slice(0, 4)) {
      this.nudge.set(bar, { x: c.x, y: c.y });
      this.fitBars([[el, bar]]);
      const sc = this.barScore(el, bar);
      if (sc > bestScore) { best = c; bestScore = sc; }
      if (sc >= SPOT_OK) { this.blocked.delete(bar); return; }
    }
    // No spot at all: back to the part's corner, not the old place (the part may have changed).
    if (best) this.nudge.set(bar, { x: best.x, y: best.y });
    else this.nudge.delete(bar);
    this.fitBars([[el, bar]]);
    if (!this.blocked.has(bar)) { this.blocked.add(bar); this.scheduleStack(); }
  }

  /**
   * Bars in flow that would be an item of a flex row or a grid, or sit outside the box that clips their unit (a ratio box with the
   * picture laid out of flow inside), lie over the unit's top left instead, outside the page's layout. Anywhere else they stay in flow.
   * Then bars lying over their units are put back on them. All styles and sizes are read first, then the bars written.
   */
  private settleBars(pairs: [Element, HTMLElement][]): void {
    const win = this.doc.defaultView;
    if (!win) return;
    const overs: [HTMLElement, Element][] = [];
    const blocks = new Map<Element, Element | null>();
    for (const [el, bar] of pairs) {
      if (!this.undecided.has(bar)) continue;
      if (!bar.isConnected) { this.undecided.delete(bar); continue; }
      if (bar.hasAttribute('data-gsb-stacked')) continue;
      const host = el.parentElement;
      if (!host || el.getClientRects().length === 0 || bar.getClientRects().length === 0) continue;
      this.undecided.delete(bar);
      const hs = win.getComputedStyle(host);
      const e = el as HTMLElement;
      const clips = /hidden|clip/.test(hs.overflowX + hs.overflowY) || /paint|strict|content/.test(hs.contain);
      // In a flex row or grid: an item of it. Not when the unit is shorter than the bar (a line of text): the bar would hang onto the next line.
      let over = (/grid/.test(hs.display) || (/flex/.test(hs.display) && !/column/.test(hs.flexDirection))) && e.offsetHeight >= bar.offsetHeight && !this.clippedBelowBlock(host, this.blockFor(host, blocks));
      if (!over && clips && bar.offsetParent === host && this.blockFor(host, blocks) === host) {
        // Past the box's edge while its unit starts inside (offsets, so a strip moved by script does not count).
        over = e.offsetHeight >= bar.offsetHeight && ((bar.offsetTop + bar.offsetHeight > host.clientHeight + 1 && e.offsetTop < host.clientHeight) || (bar.offsetLeft + bar.offsetWidth > host.clientWidth + 1 && e.offsetLeft < host.clientWidth));
      }
      // A floated unit (a wiki figure on the right) or a table cell is not where its bar falls in the flow: the bar would sit at the
      // other side of the line, or in a cell of its own. It lies over the unit's top left instead, like a flex item's.
      if (!over && bar.hasAttribute('data-gsb-short') && e.offsetHeight >= SHORT_MIN_H && !this.clippedBelowBlock(host, this.blockFor(host, blocks))) over = true;
      if (!over && !/flex|grid/.test(hs.display)) {
        const us = win.getComputedStyle(e);
        // (A block-level table with auto margins, a wiki's centred figure, sits in the middle of its line: the bar falls at the left.)
        if (us.float !== 'none' || /^(table|table-(cell|row|row-group|header-group|footer-group|caption))$/.test(us.display)) {
          // Not where something clips the bar's containing block's content (a table in a scrolling wrapper): there it stays in flow, clipped with its cell.
          if (e.offsetHeight >= bar.offsetHeight) over = !this.clippedBelowBlock(host, this.blockFor(host, blocks));
          // No size yet (a lazy picture): decided again when it has one.
          else if (e.offsetHeight === 0) this.undecided.set(bar, el);
        }
      }
      // A unit set in from its line (a centred or indented post, Instagram's post box in its wrapper): the bar would fall at the line's start
      // (the left, or the right on a right-to-left page), outside the unit. It lies over the unit instead. Decided once per placeBar (the
      // bar is undecided until then), not again on every refit.
      // Not in a host with a shadow root: its children are laid out by its shadow tree (slots), not where their light-tree line starts.
      if (!over && !host.shadowRoot && e.offsetHeight >= bar.offsetHeight) {
        const br = bar.getBoundingClientRect();
        const ur = el.getBoundingClientRect();
        const inset = hs.direction === 'rtl' ? br.right - ur.right : ur.left - br.left;
        if (inset > 24 && !this.clippedBelowBlock(host, this.blockFor(host, blocks))) over = true;
      }
      if (!over && bar.hasAttribute('data-gsb-short')) {
        if (e.offsetHeight === 0) this.undecided.set(bar, el); // not laid out yet: looked at again with a size
        else this.narrowBar(bar, el, 0, 0); // cannot lie over it (clipped, too low): the eye, never a bar above the cover
      }
      if (over) overs.push([bar, el]);
    }
    for (const [bar, el] of overs) {
      bar.style.setProperty('position', 'absolute');
      bar.style.setProperty('left', '0px');
      bar.style.setProperty('top', '0px');
      this.barOver.set(bar, el);
    }
    this.fitBars(pairs);
    this.clearDialogBars(pairs);
    if (overs.length) {
      this.watchScroll();
      this.scheduleStack();
    }
  }

  /** Does this element make a box its own containing block for absolutely positioned boxes (not only a positioned one)? */
  private makesBlock(s: CSSStyleDeclaration): boolean {
    const none = (v: string | undefined) => !v || v === 'none';
    return s.position !== 'static' || !none(s.transform) || !none(s.translate) || !none(s.rotate) || !none(s.scale) || !none(s.filter) || !none(s.backdropFilter) || !none(s.perspective) || !none(s.offsetPath) || s.transformStyle === 'preserve-3d' || s.contentVisibility === 'auto' || (s.containerType ?? 'normal') !== 'normal' || /paint|layout|strict|content/.test(s.contain) || /translate|scale|rotate|transform|filter|perspective/.test(s.willChange);
  }

  /** The parent element, through a shadow root to its host. */
  private up(n: Element): Element | null {
    return n.parentElement ?? ((n.getRootNode() as ShadowRoot).host ?? null);
  }

  /** The element an absolutely positioned child of this one would be placed against; null is the page. */
  private containingBlock(from: Element): Element | null {
    const win = this.doc.defaultView;
    for (let n: Element | null = from; n && n !== this.doc.documentElement; n = this.up(n)) {
      if (n === this.doc.body) return null;
      const s = win?.getComputedStyle(n);
      if (s && this.makesBlock(s)) return n;
    }
    return null;
  }

  private blockFor(n: Element, memo: Map<Element, Element | null>): Element | null {
    if (!memo.has(n)) memo.set(n, this.containingBlock(n));
    return memo.get(n)!;
  }

  /** Between this host and the element a bar lying over its unit would be placed against, does something clip (the bar would paint outside it)? */
  private clippedBelowBlock(host: Element, cb: Element | null): boolean {
    const win = this.doc.defaultView;
    for (let n: Element | null = host; n && n !== cb && n !== this.doc.body; n = this.up(n)) {
      const s = win?.getComputedStyle(n);
      if (s && (s.overflowX !== 'visible' || s.overflowY !== 'visible' || /paint|strict|content/.test(s.contain) || s.clipPath !== 'none')) return true;
    }
    return false;
  }

  /** One passive listener for every scroller: bars that lie over their units are put back on them as the page or a strip moves. */
  private watchScroll(): void {
    if (this.refitOn) return;
    this.refitOn = true;
    this.sizes?.observe(this.doc.documentElement);
    if (this.doc.body) this.sizes?.observe(this.doc.body);
    this.doc.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
  }

  /** Bars lying over their units are put back on them. A bar that is hidden (no box) is left. */
  private fitBars(pairs: [Element, HTMLElement][]): void {
    const win = this.doc.defaultView;
    const moves: [HTMLElement, number, number][] = [];
    const blocks = new Map<Element, Element | null>();
    for (const [el, bar] of pairs) {
      if (!this.barOver.has(bar)) continue;
      if (!bar.isConnected) { this.barOver.delete(bar); continue; }
      if (bar.hasAttribute('data-gsb-stacked')) continue;
      const e = el as HTMLElement;
      const op = bar.offsetParent;
      // The offsets are those against the bar's containing block only where that is its offset parent (not a table cell, the body, or
      // a transformed track, which hold the bar but are not the offset parent).
      if (op && e.offsetParent === op && this.blockFor(bar.parentElement!, blocks) === op) {
        // The unit's own offsets (exact under a scale or zoom, and in a scroller); the bar's top margin is taken off.
        const mt = parseFloat(win?.getComputedStyle(bar).marginTop ?? '0') || 0;
        const nd = this.nudge.get(bar);
        const low = bar.hasAttribute('data-gsb-short') && !nd ? Math.max(0, e.offsetHeight - bar.offsetHeight - 2) : 0;
        moves.push([bar, e.offsetLeft + (nd?.x ?? 0), e.offsetTop - mt + (nd?.y ?? 0) + low]);
        continue;
      }
      const u = el.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      if ((u.width === 0 && u.height === 0) || (b.width === 0 && b.height === 0)) continue;
      const nd = this.nudge.get(bar);
      const low = bar.hasAttribute('data-gsb-short') && !nd ? Math.max(0, u.height - b.height - 2) : 0;
      moves.push([bar, (parseFloat(bar.style.left) || 0) + (u.left + (nd?.x ?? 0) - b.left), (parseFloat(bar.style.top) || 0) + (u.top + (nd?.y ?? 0) + low - b.top)]);
    }
    for (const [bar, x, y] of moves) {
      if (parseFloat(bar.style.left) !== x) bar.style.setProperty('left', `${x}px`);
      if (parseFloat(bar.style.top) !== y) bar.style.setProperty('top', `${y}px`);
    }
  }

  private queueRefit(): void {
    const win = this.doc.defaultView;
    if (this.refitQueued || !win) return;
    this.refitQueued = true;
    win.requestAnimationFrame(() => {
      this.refitQueued = false;
      this.settleBars([...new Map([...this.undecided, ...this.barOver, ...this.probeBars])].map(([bar, el]) => [el, bar] as [Element, HTMLElement]));
    });
  }

  /** The width of a picture or video, or of a box holding only one (its painted layer, a thumbnail host); 0 for anything else. */
  private pictureWidth(el: Element): number {
    // What it is first (no layout), the size last.
    const media = el.matches('img, video') || ((el.textContent ?? '').trim().length <= 40 && (!!el.querySelector('img, video') || !!el.shadowRoot || this.isThumb(el) || /url\(/.test(this.doc.defaultView?.getComputedStyle(el).backgroundImage ?? '')));
    if (!media) return 0;
    // A width the page states is read without laying the page out; only a picture with none is measured.
    return Number(el.getAttribute('width')) || this.widthOf(el);
  }

  private labelCtx: CanvasRenderingContext2D | null | undefined;
  /** How wide a label is drawn (text and side padding), measured in a canvas, which lays nothing out on the page. */
  private labelWidth(text: string, line: boolean): number {
    const [font, pad] = BAR_FONT[line ? 'line' : 'full'];
    if (this.labelCtx === undefined) {
      try { this.labelCtx = this.doc.createElement('canvas').getContext('2d'); } catch { this.labelCtx = null; }
    }
    const ctx = this.labelCtx;
    if (!ctx) return text.length * 6.5 + pad;
    ctx.font = font;
    return ctx.measureText(text).width + pad;
  }

  /**
   * The card itself, or something in it, is covered for its words (not a picture covered by the picture rules). A reply nested
   * inside it (Reddit, YouTube) is a card of its own: its cover says nothing about this card.
   */
  private wordsCovered(card: Element): boolean {
    for (const c of [card, ...card.querySelectorAll('[data-gsb]')]) {
      const why = c.getAttribute('data-gsb-why');
      if (why && why !== 'near-game' && why !== 'media' && (c === card || c.closest(this.opts.containers!) === card)) return true;
    }
    return false;
  }

  /** The pictures and videos in a box: its own, those inside open shadow roots in it, and pictures drawn only as a background. */
  private mediaIn(box: Element): Element[] {
    const inShadows = [...box.querySelectorAll('*')].flatMap((e) => (e.shadowRoot ? [...e.shadowRoot.querySelectorAll('img, video')] : []));
    return [...box.querySelectorAll('img, video'), ...inShadows, ...this.bgPictures(box), ...this.thumbBoxes(box)];
  }

  /**
   * Elements a site rule names as a post's picture that are not <img> or <video> themselves: a component that draws its picture
   * in a closed shadow root (Reddit's faceplate-img). They are covered as a whole.
   */
  private thumbBoxes(root: ParentNode): Element[] {
    const sel = this.opts.thumbs;
    if (!sel) return [];
    try {
      const all = [...(root.nodeType === 1 && (root as Element).matches(sel) ? [root as Element] : []), ...(root.querySelectorAll?.(sel) ?? [])];
      return all.filter((e) => !e.matches('img, video'));
    } catch {
      return [];
    }
  }

  /** Gives a label its reveal behaviour: one click, a second click to confirm, or shown while held down. */
  private wireReveal(el: Element, bar: HTMLElement, text: string): void {
    const mode = this.opts.revealMode ?? 'click';
    const hold = mode === 'hold' && this.opts.hideMode === 'blur';
    // The label is a button and reads the reason; what a click does is in its accessible name (and the eye button's pill).
    const full = `${text} (${hold ? 'hold to peek' : 'click to show'})`;
    // In hold mode the hint stays in the visible text: a click does nothing there, and nobody would know to hold.
    bar.textContent = hold ? full : text;
    bar.setAttribute('aria-label', full);
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    // What the bar does for each event (guardBars hands it the events before the page sees them).
    const acts: Record<string, (e: Event) => void> = {};
    const on = (type: string, fn: (e: Event) => void) => { acts[type] = fn; bar.addEventListener(type, fn); };
    BAR_ACTS.set(bar, acts);
    guardBars(this.doc);
    if (hold) {
      // The covers whose bars sit under this one are peeked with it (stackBars).
      // The group peeked is the one ended, even if the groups change while it is held.
      let peeked: Element[] = [];
      const show = (e: Event) => { stop(e); if (!el.hasAttribute('data-gsb-peek')) { peeked = this.withPost(el); for (const g of peeked) g.setAttribute('data-gsb-peek', ''); syncReaders(this.doc); } };
      const hide = () => {
        if (!peeked.length) return;
        const group = peeked;
        peeked = [];
        for (const g of group) g.removeAttribute('data-gsb-peek');
        syncReaders(this.doc);
        for (const g of group) this.pausedWhileCovered(g);
      };
      on('pointerdown', show);
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) on(ev, hide);
      on('click', stop);
      // Keyboard: the key has to be held, so Enter or Space shows it until the key is released.
      on('keydown', (e) => { if (isActKey(e)) show(e); });
      on('keyup', hide);
      return;
    }
    let armed = false;
    on('click', (e) => {
      stop(e);
      if (mode === 'twice' && !armed) {
        armed = true;
        bar.textContent = 'Click again to show';
        bar.setAttribute('aria-label', 'Click again to show');
        setTimeout(() => {
          armed = false;
          // What the bar is now (it may have gone short while waiting): its short reason or its full label, the tag where it was drawn.
          const base = this.barBase.get(bar) ?? text;
          const isShort = bar.hasAttribute('data-gsb-short');
          bar.textContent = isShort ? this.barShort.get(bar) ?? shortReason(base) : this.barName.get(bar) ?? text;
          bar.setAttribute('aria-label', `${this.tagged(bar, isShort ? shortReason(base) : base)} (click to show)`);
        }, 4000);
        return;
      }
      // The covers whose bars sit under this one are shown with it (stackBars), and so is every other cover in the same post: one press shows the post.
      const post = this.shownPost(el);
      for (const g of this.withPost(el)) this.reveal(g);
      // A post the person showed stays shown: a picture that arrives in it later (a gallery slide, a late image) is not covered again.
      if (post) this.markShown(post);
      syncReaders(this.doc);
    });
  }

  /**
   * The page's own title while the tab shows our label instead (content.ts swaps a title that gives something away): the page
   * judge reads it, so a page whose title was its only sign of the game stays about the game. Only while the tab still shows that
   * label: a page that moved on (a single-page site) and set its own title is judged by that one.
   */
  private realTitle: { title: string; label: string } | null = null;
  setRealTitle(title: string | null, label: string | null): void {
    this.realTitle = title !== null && label !== null ? { title, label } : null;
  }

  /** How a piece of text outside the page body (the tab title) would be judged here, with this page's context. */
  judgeText(text: string): MatchResult | null {
    return this.matcher.match(text, this.pageContext);
  }

  /**
   * The covers of the same post as this one (not those of a comment or reply inside it, which are posts of their own). A press shows the
   * whole post: a post with two covered pictures, or a covered title and a covered picture, opens with one press.
   */
  /** Cards the person showed, each with what it held then (its first link): a site that reuses the element for other content (YouTube's tiles) has it judged again. */
  private shownPosts = new WeakMap<Element, string>();
  private postSig(p: Element): string {
    // A thread-page card (Instagram's live post block): also the thread, as the next post by the same author (its first link the author's)
    // comes in the same element.
    const href = p.querySelector('a[href]')?.getAttribute('href') ?? '';
    return this.opts.threadCards && p.matches(this.opts.threadCards) ? `${href} ${this.threadKey() ?? ''}` : href;
  }
  private markShown(p: Element): void {
    this.shownPosts.set(p, this.postSig(p));
  }
  private isShown(p: Element): boolean {
    const sig = this.shownPosts.get(p);
    if (sig === undefined) return false;
    if (sig === this.postSig(p)) return true;
    this.shownPosts.delete(p);
    return false;
  }

  private samePost(el: Element): Element[] {
    const cards = this.opts.containers;
    // Parts of a dialog or viewer are shown one by one (a viewer's next photo is judged on its own), but a carousel's slides are the post's.
    const post = this.shownPost(el);
    if (!post) return [];
    // In a dialog only the other slides go with it (a comment there need not be a card of its own).
    const dialog = !!el.closest('[role="dialog"]');
    const of = (h: Element) => { const l = this.lightHost(h); const c = l.closest(cards!); return c && (!dialog || l.closest(this.opts.slides!)) ? this.postOf(c) : null; };
    const out: Element[] = [];
    for (const h of this.hidden.keys()) if (h !== el && h.isConnected && of(h) === post && !this.revealed.has(h)) out.push(h);
    return out;
  }

  /** The cover, the covers whose bars sit under its bar, and the other covers of its post. */
  private withPost(el: Element): Element[] {
    return [...new Set([...this.groupOf(el), ...this.samePost(el)])];
  }

  reveal(el: Element): void {
    // The dialogs that are covered now (one judged clean, or shown, is not marked shown for a cover of its own inside it).
    const was = [...this.dialogSrc.keys()].filter((d) => d !== el && d.contains(el) && this.covered(d));
    const view = this.viewerOf(el);
    const viewCovered = !!view && this.covered(view);
    this.uncoverEl(el);
    el.setAttribute('data-gsb-revealed', '');
    this.revealed.add(el);
    // Showing a part of a dialog shows the dialog: what lands in it later is not covered again.
    const group = this.dialogOf.get(el);
    for (const [d, src] of this.dialogSrc) if (src.set === group || was.includes(d)) this.revealed.add(d);
    // The same for a viewer whose covers were made one by one.
    if (view && viewCovered && !this.dialogSrc.has(view)) { this.viewerShown.add(view); this.viewerList.add(view); }
    // A thread that had to stay hidden whole kept its replies unread. Shown, they are judged one by one.
    if (this.flagged && el.matches(this.opts.threads!)) {
      el.querySelectorAll(this.opts.threads!).forEach((r) => { if (this.replyUnder(el, r) === r) this.scan(r); });
    }
    if (this.opts.main && this.mc?.el && (this.mc.el === el || (this.coverKey !== null && this.mc.el.contains(el)))) {
      const k = this.threadKey();
      // Facebook: only a press on the post's own cover marks it shown; a press on its picture shows the comments, and a later cover of the
      // post itself (its words, once "See more" opens them) still counts.
      if (k !== null && !this.opts.replies) this.revealedThreads.add(k);
      else if (k !== null && this.mc.el === el) this.shownMain = { el, key: k, dialog: !!el.closest('[role="dialog"]') };
      this.uncover();
    }
  }

  revealAll(): void {
    // Showing a thread or a main post judges what it hid, which can hide more. Go again until nothing is left.
    for (let round = 0; this.hidden.size && round < 10; round++) {
      for (const el of [...this.hidden.keys()]) this.reveal(el);
    }
    syncReaders(this.doc);
  }

  /** Undo everything (used before rescanning with new settings). */
  clear(): void {
    for (const t of this.doc.querySelectorAll('.gsb-tip')) t.remove();
    this.stacked.clear();
    this.probeBars.clear();
    this.dialogSets.clear();
    this.dialogSrc.clear();
    this.viewerList.clear();
    if (!this.opts.keepRevealed) { this.viewerShown = new WeakSet(); this.shownPosts = new WeakMap(); }
    // The play listeners of this run end with it (a restart would otherwise stack another set on each video).
    this.playAbort.abort();
    this.playAbort = new AbortController();
    this.durationWatched = new WeakSet();
    this.playListening = false;
    this.listenedRoots = new WeakSet();
    this.repauses = new WeakMap();
    for (const [el, bar] of this.hidden) {
      this.releaseMedia(el);
      el.removeAttribute('data-gsb');
      el.removeAttribute('data-gsb-why');
      el.removeAttribute('data-gsb-source');
      bar?.remove();
    }
    this.hidden.clear();
    this.marks.clear();
    this.strip();
    this.mc = null;
    this.anchor = null;
    this.revealedThreads.clear();
    this.shownMain = null;
    this.sizes?.disconnect();
    if (this.refitOn) this.doc.removeEventListener('scroll', this.onScroll, { capture: true });
    this.refitOn = false;
    this.barOver.clear();
    this.undecided.clear();
    this.undefinedHosts.clear();
    // Marks inside shadow roots too: the root's own copy of the cover style would keep them covered.
    for (const r of [this.doc, ...shadowRoots()]) {
      r.querySelectorAll('[data-gsb-in], [data-gsb-own]').forEach((e) => (e.removeAttribute('data-gsb-in'), e.removeAttribute('data-gsb-own')));
      r.querySelectorAll('[data-gsb-peek]').forEach((e) => e.removeAttribute('data-gsb-peek'));
      // Items the user already showed stay shown across a restart when the caller keeps that set.
      if (!this.opts.keepRevealed) r.querySelectorAll('[data-gsb-revealed]').forEach((e) => e.removeAttribute('data-gsb-revealed'));
    }
    if (!this.opts.keepRevealed) this.revealed = new WeakSet();
    syncReaders(this.doc);
  }

  /**
   * Drop bookkeeping for elements removed from the page, and keep every label right in front of its item.
   * Sites move and replace cards after they are hidden (YouTube does), which would leave a label behind.
   */
  prune(): void {
    this.releaseStrayMedia();
    const mine = new Set<Element>();
    for (const [el, bar] of this.hidden) {
      if (!el.isConnected) {
        // Sites put the same node back later (virtual lists): it must come back clean to be judged again.
        this.uncoverEl(el, bar);
        // ...and what was read in it goes too (joined text, the game-plus-spoiler-word check, the post verdict), or the same text
        // put back would be skipped as already read.
        for (const b of [el, ...el.querySelectorAll('*')]) {
          this.joined.delete(b);
          this.joinedPass.delete(b);
          this.spoilTried.delete(b);
          this.spoilPass.delete(b);
          this.about.delete(b);
        }
        continue;
      }
      if (!bar) continue;
      mine.add(bar);
      if (bar.nextElementSibling !== el) this.placeBar(el, bar);
    }
    // Covered dialogs gone from the page, and their parts.
    for (const [d, src] of this.dialogSrc) {
      for (const m of src.set) if (!m.isConnected) src.set.delete(m);
      if (!d.isConnected) this.dialogSrc.delete(d);
    }
    for (const set of this.dialogSets) if (!set.size) this.dialogSets.delete(set);
    for (const b of this.doc.querySelectorAll('.gsb-bar')) if (!mine.has(b)) b.remove();
    // A unit can move without a size change (something loads above it): bars lying over their units look again, and so do the
    // dialog bars (the page's own controls may have come up over one without a scroll or a resize).
    for (const [b, e] of this.probeBars) if (!b.isConnected || !e.isConnected) this.probeBars.delete(b);
    for (const d of this.viewerList) if (!d.isConnected) this.viewerList.delete(d);
    if (this.probeBars.size) this.spotKey = new WeakMap();
    this.checkLeads();
    // A covered dialog whose shown bar could not be put anywhere clear: the controls over another part may have moved, so the lead is chosen again.
    for (const [b, e] of this.probeBars) {
      if (this.blocked.has(b) && !b.hasAttribute('data-gsb-stacked') && this.groupKey(e)) { this.scheduleStack(); break; }
    }
    if (this.barOver.size || this.probeBars.size) this.queueRefit();
    if (this.opts.main) this.syncCover(this.doc);
  }

  /**
   * The page or another extension took our stylesheet out or emptied it, or stripped the cover mark from something we hide
   * (cleanup scripts, head rewrites): put them back. Only what is missing is written, so a page left alone sees no change. Called
   * about once a second (content.ts), never in a loop with the page.
   */
  repair(): void {
    const css = cssFor(this.opts.blur);
    let st = this.doc.getElementById(STYLE_ID);
    if (!st) {
      st = this.doc.createElement('style');
      st.id = STYLE_ID;
      (this.doc.head ?? this.doc.documentElement).append(st);
    }
    if (st.textContent !== css) st.textContent = css;
    let fixed = this.trailerWait.size ? this.recheckTrailers() : false;
    for (const el of this.hidden.keys()) {
      if (!el.isConnected || this.revealed.has(el) || el.hasAttribute('data-gsb')) continue;
      el.setAttribute('data-gsb', this.opts.hideMode);
      // Its reason too, so a cover put on because of the page still comes off when the page stops being about the game.
      const why = this.whyOf.get(el);
      if (why && !el.hasAttribute('data-gsb-why')) el.setAttribute('data-gsb-why', why);
      const source = this.sourceOf.get(el);
      if (source && !el.hasAttribute('data-gsb-source')) el.setAttribute('data-gsb-source', source);
      this.changes++;
      fixed = true;
    }
    // Screen readers are told again what is hidden.
    if (fixed) syncReaders(this.doc);
  }
  /** Why each item was hidden, kept apart from the page so a stripped mark can be put back with its reason (repair). */
  private whyOf = new WeakMap<Element, Why>();
  /** The source of each cover that has one (data-gsb-source), to put back like whyOf. */
  private sourceOf = new WeakMap<Element, Source>();
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

/** A community, user, wiki or one-part account link's path as words ("/r/Some_Sub/" -> "r Some Sub"); '' for any other link. */
function linkPath(href: string): string {
  // Cheap first: only an address whose path has one part, or two under r/, u/, user/ or wiki/, is parsed.
  if (!/^(?:[a-z][a-z0-9+.-]*:\/\/[^/?#]*)?\/(?:(?:r|u|user|wiki)\/)?[^/?#]+\/?(?:[?#]|$)/i.test(href)) return '';
  let path: string;
  try {
    path = new URL(href, 'https://link.invalid/').pathname;
  } catch {
    return '';
  }
  if (!/^\/(?:(?:r|u|user|wiki)\/[^/]+\/?|[^/]+\/?)$/i.test(path)) return '';
  return safe(path).replace(/[/_+-]+/g, ' ').trim();
}
