// Beta build only. Builds the STRUCTURE-ONLY picture of a page that the "This looks wrong" report carries.
// Privacy: the output holds no page text, no alt text, no titles, no labels, no ids, no data-* values and no query or hash.
// It holds tag names, our own and the site rules' class names (any other class becomes its shape: ~w, ~slug, ~id), the reason kind
// (data-gsb-why, known values only), the setting that made it (data-gsb-source, known values only), the registrable domain
// (hostShape), rectangles and yes/no facts, and a skeleton of the elements around the click (buildSkeleton: the same shapes, sizes
// and our own state only). The screenshot that goes with a
// report can hold spoilers and private content; it stays on the owner's disk and is a separate file. Pure: no browser API is used
// except what is passed in, so it unit-tests with a made-up DOM.

export const SNAPSHOT_VERSION = 1;
export type Rect = { x: number; y: number; w: number; h: number };
export type Shape = { tag: string; classes: string[] };
export type CoverInfo = Shape & { why: string; source: string; mode: string; rect: Rect; hasBar: boolean; near: boolean; distance: number };
export type BarInfo = Shape & { rect: Rect; visible: boolean; topmost: boolean; topAtCentre: Shape | null; why: string; flags: string[] };
export type Snapshot = {
  v: number;
  noPageText: true;
  site: { host: string; adapter: string | null; pathShape: string; frame: 'top' | 'sub' };
  window: { width: number; height: number; devicePixelRatio: number; scrollX: number; scrollY: number };
  click: { x: number; y: number } | null;
  atClick: { chain: Shape[]; insideCover: boolean } | null;
  counts: { covers: number; bars: number; near: number; barsHidden: number; barsUnderneath: number };
  covers: CoverInfo[];
  bars: BarInfo[];
  /** The structure around the element under the click (buildSkeleton); null without a click. Missing in reports made before it. */
  skeleton?: Skeleton | null;
};
/**
 * One element of the skeleton. cover: our data-gsb mode ('' if none); why: our rule id; bar: one of our label bars; flags: which of our
 * own data-gsb-* attributes it has (names only, never values); hasText: it has text of its own (never the text); kids: how many
 * child elements it has; children: the ones kept; more: how many of them were left out.
 */
export type SkelNode = { tag: string; classes: string[]; w: number; h: number; kids: number; hasText: boolean; hidden: boolean; cover: string; why: string; bar: boolean; flags: string[]; target?: true; more?: number; children?: SkelNode[] };
/** up: levels above the reported element (3, fewer near the top); insideCover: it is in one of our covers; cut: a cap left some out. */
export type Skeleton = { up: number; insideCover: boolean; nodes: number; cut: boolean; root: SkelNode };
/** Our own state attributes (data-gsb-<name>) whose presence the skeleton records. */
export const SKELETON_FLAGS = ['own', 'in', 'under', 'hold', 'revealed', 'peek', 'icon', 'line', 'stacked', 'short'] as const;
export type SnapshotInput = {
  doc: Document;
  click: { x: number; y: number } | null;
  adapter: string | null;
  href: string;
  isTop: boolean;
  nearPx?: number;
};

const MAX_COVERS = 80;
const MAX_BARS = 80;
// Words that are routes of a site, not of a page: the only path segments kept as they are.
const ROUTE_WORDS = new Set('r user u watch status comments post posts search wiki video videos channel c p photo photos groups events reel shorts w t i hashtag tag news forums thread threads topic topics questions article articles feed home explore results'.split(' '));

/** A path with its words gone: route words stay, numbers become #, anything else becomes a kind (id, slug, w). */
export function pathShape(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);
  return '/' + segs.slice(0, 8).map((s) => (/^\d+$/.test(s) ? '#' : ROUTE_WORDS.has(s.toLowerCase()) ? s.toLowerCase() : /\d/.test(s) ? 'id' : /[-_%.]/.test(s) || s.length > 12 ? 'slug' : 'w')).join('/');
}

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
};
// Class names kept as they are: ours (exactly; a unit test checks every one the scanner sets), the ones the site rules in src/adapters
// select on, and a few plain structural words. A page's own class can carry words (a tag or user name in "tag-<name>"), so every
// other class becomes its shape.
const KEPT_CLASSES = new Set(
  ('gsb-bar gsb-tip gsb-change gsb-sr post card comment reply thread message feed item title link thumbnail media ' +
    'thing zA g MjjYud SoaBEf WYczDe hP kp-wholepage b_algo b_ans b_vidAns sbct news-card search-result react-results--sidebar ' +
    'chat-line__message commentthread_comment apphub_Card forum_op forum_topic steam_curators_block game_area_purchase_game').split(' '),
);
/** A class name as it may appear in a report: ours or a site rule's as is, any other as its shape (~id, ~slug or ~w). */
export function classShape(c: string): string {
  if (KEPT_CLASSES.has(c)) return c;
  return /\d/.test(c) ? '~id' : /[-_%.:]/.test(c) || c.length > 12 ? '~slug' : '~w';
}
/** Custom elements the site rules in src/adapters name (a unit test checks each is there). Any other custom element is "~custom". */
export const ADAPTER_TAGS: readonly string[] = (
  'shreddit-post shreddit-comment faceplate-img faceplate-partial g-card ' +
  'yt-live-chat-text-message-renderer yt-live-chat-paid-message-renderer yt-live-chat-paid-sticker-renderer yt-live-chat-membership-item-renderer ' +
  'yt-lockup-view-model ytd-channel-name ytd-channel-renderer ytd-comment-replies-renderer ytd-comment-thread-renderer ytd-compact-video-renderer ' +
  'ytd-engagement-panel-section-list-renderer ytd-grid-video-renderer ytd-playlist-renderer ytd-reel-item-renderer ytd-reel-player-overlay-renderer ' +
  'ytd-reel-shelf-renderer ytd-reel-video-renderer ytd-rich-item-renderer ytd-video-description-header-renderer ' +
  'ytd-video-description-infocards-section-renderer ytd-video-owner-renderer ytd-video-renderer ytd-watch-flexy ytd-watch-metadata ' +
  'ytd-watch-next-secondary-results-renderer ytm-shorts-lockup-view-model ytm-slim-owner-renderer ytm-slim-video-metadata-section-renderer'
).split(' ');
const ADAPTER_TAG_SET = new Set(ADAPTER_TAGS);
/** A tag name as it may appear in a report: a custom element's name is the page's own choice, so only the site rules' ones stay. */
export function tagShape(tagName: string): string {
  const t = tagName.toLowerCase();
  if (!t.includes('-')) return t.replace(/[^\w]/g, '').slice(0, 16);
  return ADAPTER_TAG_SET.has(t) ? t : '~custom';
}
/**
 * A tag the browser does not know is a word the page chose (<zorblax>, or any name inside svg or math): it is "~unknown". The
 * browser tells: an unknown HTML tag is an HTMLUnknownElement, an unknown svg one a plain SVGElement; nothing of MathML is kept.
 */
function madeUpTag(el: Element): boolean {
  const v = el.ownerDocument?.defaultView as (Window & typeof globalThis) | null | undefined;
  // Fails closed: with no window to ask, every tag counts as made up.
  if (el.namespaceURI === 'http://www.w3.org/1999/xhtml') return !v?.HTMLUnknownElement || el instanceof v.HTMLUnknownElement;
  if (el.namespaceURI === 'http://www.w3.org/2000/svg') return !v?.SVGElement || Object.getPrototypeOf(el) === v.SVGElement.prototype;
  return true;
}
export const shapeOf = (el: Element): Shape => ({ tag: madeUpTag(el) ? '~unknown' : tagShape(el.tagName), classes: [...el.classList].slice(0, 8).map(classShape).filter(Boolean) });
/** The rule ids a cover can carry (the Why type in src/content/scanner.ts; a unit test keeps the two the same). Anything else is "other". */
export const KNOWN_WHY = ['alone', 'mention', 'page', 'two-names', 'hint', 'reply', 'chat', 'spoiler-word', 'media', 'near-game', 'heading', 'account'] as const;
/** The source codes a cover can carry (data-gsb-source; SOURCES in src/cover-source.ts, a unit test keeps the two the same). '' for none. */
export const KNOWN_SOURCE = ['strict', 'site-strict', 'site-list', 'site-pictures', 'own-words', 'own-accounts', 'builtin-account', 'blackout'] as const;
export const KNOWN_MODES = ['blur', 'collapse', 'remove'] as const;
const known = (v: string | null | undefined, values: readonly string[]) => (!v ? '' : values.includes(v) ? v : 'other');
// Second-level names under which people register their own names (example.co.uk): the domain keeps three labels there.
const TWO_PART = new Set('co.uk org.uk ac.uk gov.uk me.uk com.au net.au org.au co.nz co.jp ne.jp co.kr co.in com.br com.mx com.ar com.tr co.za com.cn com.tw com.hk com.sg co.il'.split(' '));
// Leading labels that say which version of a site this is, not whose page it is: kept.
const SITE_LABELS = new Set(['www', 'old', 'new', 'm', 'mobile']);
/**
 * The registrable domain: each extra label in front becomes "sub", except www, old, new, m and mobile (a.b.example.com -> sub.sub.example.com).
 * Loopback addresses stay as they are; any other address becomes "ip". A home network's own names (one label, or ending in .local,
 * .lan, .home, .internal or .localdomain) become "local".
 */
export function hostShape(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (h === '' || h === '127.0.0.1' || h === '[::1]') return h;
  if (/^\d+(\.\d+){3}$/.test(h) || h.startsWith('[')) return 'ip';
  if (!h.includes('.') || /\.(local|lan|home|internal|localdomain)$/.test(h)) return 'local';
  const labels = h.split('.');
  const keep = labels.length >= 3 && TWO_PART.has(labels.slice(-2).join('.')) ? 3 : 2;
  const head = labels.slice(0, -keep).map((l) => (SITE_LABELS.has(l) ? l : 'sub'));
  return [...head, ...labels.slice(-keep)].join('.');
}
/** Distance in px from a point to a rectangle (0 inside). */
export function distanceTo(r: Rect, p: { x: number; y: number }): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.round(Math.hypot(dx, dy));
}

const SKEL_UP = 3;
const SKEL_DOWN = 2;
const SKEL_KIDS = 16;
const SKEL_NODES = 200;
/**
 * The structure around a reported element, enough to rebuild it as a test page: from its third parent (or body) down to two levels
 * below it, siblings included, so a label bar next to its cover is there. Each element is its tag and class shapes (as shapeOf),
 * its size, and our own cover and bar state. Never text, ids, attribute values, addresses or form values; nothing inside a shadow
 * root or a frame.
 */
export function buildSkeleton(el: Element): Skeleton {
  let root = el;
  let up = 0;
  while (up < SKEL_UP && root.parentElement && root !== el.ownerDocument?.body) { root = root.parentElement; up++; }
  const win = el.ownerDocument?.defaultView;
  let nodes = 0;
  let cut = false;
  const node = (e: Element, depth: number): SkelNode => {
    nodes++;
    const { w, h } = rectOf(e);
    let hidden = false;
    try { const cs = win?.getComputedStyle(e); hidden = cs?.display === 'none' || cs?.visibility === 'hidden'; } catch { /* not styled */ }
    const n: SkelNode = {
      ...shapeOf(e),
      w, h,
      kids: e.children.length,
      hasText: [...e.childNodes].some((c) => c.nodeType === 3 && /\S/.test(c.nodeValue ?? '')),
      hidden,
      cover: known(e.getAttribute('data-gsb'), KNOWN_MODES),
      why: known(e.getAttribute('data-gsb-why'), KNOWN_WHY),
      bar: e.classList.contains('gsb-bar'),
      flags: SKELETON_FLAGS.filter((f) => e.hasAttribute(`data-gsb-${f}`)),
    };
    if (e === el) n.target = true;
    // The head holds no page structure, only titles and settings: never looked into.
    if (depth >= up + SKEL_DOWN || n.kids === 0 || e.tagName === 'HEAD') { if (n.kids) cut = true; return n; }
    // The child on the path to the reported element always stays, whatever the caps.
    const onPath = [...e.children].find((c) => c === el || c.contains(el));
    const kept = [...e.children].filter((c, i) => c === onPath || (i < SKEL_KIDS && nodes < SKEL_NODES));
    n.children = [];
    for (const c of kept) if (c === onPath || nodes < SKEL_NODES) n.children.push(node(c, depth + 1));
    if (n.children.length < n.kids) { n.more = n.kids - n.children.length; cut = true; }
    return n;
  };
  const tree = node(root, 0);
  return { up, insideCover: !!el.closest('[data-gsb]'), nodes, cut, root: tree };
}

/**
 * A blurred cover and everything in it take no clicks (pointer-events none), so the element under the click is the one behind it:
 * from there, go down through our covers to the innermost box that holds the point.
 */
export function coveredUnder(hit: Element, p: { x: number; y: number }): Element {
  const win = hit.ownerDocument?.defaultView;
  // Only a blur that is not being peeked at lets clicks through; a box that is there but hidden is not what was under the pointer.
  const shown = (c: Element) => { try { return win?.getComputedStyle(c).visibility !== 'hidden'; } catch { return true; } };
  let t = hit;
  for (;;) {
    const next = [...t.children].reverse().find((c) => !!c.closest('[data-gsb="blur"]:not([data-gsb-peek])') && distanceTo(rectOf(c), p) === 0 && rectOf(c).w > 0 && shown(c));
    if (!next) return t;
    t = next;
  }
}

export function buildSnapshot(input: SnapshotInput): Snapshot {
  const { doc, click, adapter } = input;
  const near = input.nearPx ?? 300;
  const win = doc.defaultView;
  let host = '';
  let path = '/';
  try { const u = new URL(input.href); host = hostShape(u.hostname); path = u.pathname; } catch { /* no address */ }
  const top = (x: number, y: number): Element | null => { try { return doc.elementFromPoint(x, y); } catch { return null; } };

  const covers: CoverInfo[] = [...doc.querySelectorAll('[data-gsb]')].map((el) => {
    const rect = rectOf(el);
    const distance = click ? distanceTo(rect, click) : 0;
    const prev = el.previousElementSibling;
    return { ...shapeOf(el), why: known(el.getAttribute('data-gsb-why'), KNOWN_WHY), source: known(el.getAttribute('data-gsb-source'), KNOWN_SOURCE), mode: known(el.getAttribute('data-gsb'), KNOWN_MODES), rect, hasBar: !!prev?.classList.contains('gsb-bar'), near: !!click && distance <= near, distance };
  });
  // Near the click first, so a long page keeps the covers the owner is pointing at.
  const ordered = click ? [...covers].sort((a, b) => a.distance - b.distance) : covers;

  const bars: BarInfo[] = [...doc.querySelectorAll('.gsb-bar')].map((el) => {
    const rect = rectOf(el);
    const cs = win?.getComputedStyle(el);
    const visible = rect.w > 0 && rect.h > 0 && cs?.visibility !== 'hidden' && cs?.display !== 'none';
    const at = visible ? top(rect.x + rect.w / 2, rect.y + rect.h / 2) : null;
    const topmost = !!at && (at === el || el.contains(at));
    const owner = el.nextElementSibling?.hasAttribute('data-gsb') ? el.nextElementSibling : el.previousElementSibling?.hasAttribute('data-gsb') ? el.previousElementSibling : el.parentElement?.closest('[data-gsb]');
    const flags = ['data-gsb-icon', 'data-gsb-line', 'data-gsb-stacked'].filter((a) => el.hasAttribute(a)).map((a) => a.slice(9));
    return { ...shapeOf(el), rect, visible, topmost, topAtCentre: at && !topmost ? shapeOf(at) : null, why: known(owner?.getAttribute('data-gsb-why'), KNOWN_WHY), flags };
  });

  let atClick: Snapshot['atClick'] = null;
  let skeleton: Skeleton | null = null;
  if (click) {
    const hit = top(click.x, click.y);
    if (hit) {
      skeleton = buildSkeleton(coveredUnder(hit, click));
      const chain: Shape[] = [];
      for (let e: Element | null = hit; e && chain.length < 6; e = e.parentElement) chain.push(shapeOf(e));
      atClick = { chain, insideCover: !!hit.closest('[data-gsb]') };
    }
  }
  return {
    v: SNAPSHOT_VERSION,
    noPageText: true,
    site: { host, adapter, pathShape: pathShape(path), frame: input.isTop ? 'top' : 'sub' },
    window: { width: win?.innerWidth ?? 0, height: win?.innerHeight ?? 0, devicePixelRatio: win?.devicePixelRatio ?? 1, scrollX: Math.round(win?.scrollX ?? 0), scrollY: Math.round(win?.scrollY ?? 0) },
    click: click ? { x: Math.round(click.x), y: Math.round(click.y) } : null,
    atClick,
    counts: { covers: covers.length, bars: bars.length, near: covers.filter((c) => c.near).length, barsHidden: bars.filter((b) => !b.visible).length, barsUnderneath: bars.filter((b) => b.visible && !b.topmost).length },
    covers: ordered.slice(0, MAX_COVERS),
    bars: bars.slice(0, MAX_BARS),
    skeleton,
  };
}
