import { parseAccount } from './accounts';
import { DEFAULT_HINTS } from './matcher/hints';
import { TEXT } from './text';
import { CATEGORIES, KINDS, KIND_BASE_LEVEL, KIND_CATEGORY, type Category, type Kind, type Strictness } from './types';

/** blur: covered, click to show. collapse: gone, with a small line in its place. remove: gone, no trace. */
export type HideMode = 'blur' | 'collapse' | 'remove';
export type MediaNearGame = 'off' | 'page' | 'post';
/** Reaction GIFs from a GIF library: 'label' judges them by their label, 'picture' covers them like any picture. */
export type ReactionGifs = 'label' | 'picture';
/** Pictures posted as a reply: 'show' leaves a bare one alone, 'cover' treats it like any picture. */
export type ReplyPictures = 'show' | 'cover';
/** The defaults for GIFs and photos posted as a reply, in one place. */
export const REPLY_PICTURE_DEFAULTS = { replyGifs: 'show', replyPhotos: 'cover' } as const;
export type UpdateEvery = 'hourly' | '6h' | 'daily' | 'manual';
/** How strongly a cover blurs. 'solid' replaces the content with a plain box. */
export type BlurStrength = 'light' | 'medium' | 'heavy' | 'solid';
/** click: one click shows it. hold: shown only while pressed. twice: a second click confirms. */
export type RevealMode = 'click' | 'hold' | 'twice';
/** off: never hide this category. mention: only when the page names the game. always: follow strictness. */
export type CategoryMode = 'off' | 'mention' | 'always';
/**
 * What to protect, as one choice. big: only the biggest spoilers (level 3). story: the main story (levels 2-3).
 * all: everything on the list (levels 1-3). custom: the user set each kind by hand.
 * Level 0 never hides in any of them; it only marks a page as being about the game.
 */
export type Protect = 'big' | 'story' | 'all' | 'custom';
export const PROTECTS: readonly Protect[] = ['big', 'story', 'all', 'custom'];
export type PresetProtect = Exclude<Protect, 'custom'>;
const PRESET_PROTECTS: readonly PresetProtect[] = ['big', 'story', 'all'];
/** The lowest level each preset hides. */
export const PROTECT_THRESHOLD: Record<PresetProtect, 1 | 2 | 3> = { big: 3, story: 2, all: 1 };

/** The row of choices a preset fills in: hide every kind whose level meets the preset, show the rest. */
export function presetKindModes(protect: Protect): Record<Kind, CategoryMode> {
  const min = PROTECT_THRESHOLD[protect === 'custom' ? 'story' : protect];
  return Object.fromEntries(KINDS.map((k) => [k, KIND_BASE_LEVEL[k] >= min ? 'always' : 'off'])) as Record<Kind, CategoryMode>;
}

/** Parts of a page, so a site can be checked in some places and left alone in others. */
export const PAGE_PARTS = ['titles', 'comments', 'search', 'sidebar', 'news'] as const;
export type PagePart = (typeof PAGE_PARTS)[number];
export type Preset = 'casual' | 'careful' | 'blackout' | 'custom';

/** What one site changes. A field left out means "same as the global setting". */
export interface SiteOverride {
  /** Nothing is hidden on this site. */
  off?: boolean;
  strictness?: Strictness;
  hideMode?: HideMode;
  blur?: BlurStrength;
  parts?: Partial<Record<PagePart, boolean>>;
  // Pictures on this site (SITE_PICTURE_FIELDS): each one in place of the global setting of the same name.
  hideImages?: boolean;
  hideMediaPosts?: boolean;
  mediaNearGame?: MediaNearGame;
  reactionGifs?: ReactionGifs;
  replyGifs?: ReplyPictures;
  replyPhotos?: ReplyPictures;
  thumbsOnly?: boolean;
}

/** The picture settings a site can have its own value for. */
export const SITE_PICTURE_FIELDS = ['hideImages', 'hideMediaPosts', 'mediaNearGame', 'reactionGifs', 'replyGifs', 'replyPhotos', 'thumbsOnly'] as const;
export type SitePictureField = (typeof SITE_PICTURE_FIELDS)[number];

export interface Settings {
  enabled: boolean;
  strictness: Strictness;
  hideMode: HideMode;
  hideImages: boolean;
  /** On a page about the game, hide site posts that are only a picture or clip (it cannot be read). */
  hideMediaPosts: boolean;
  /**
   * Blur big pictures and video next to the game's name: 'page' on pages about the game,
   * 'post' also beside a caption, link or post that names it on any page.
   */
  mediaNearGame: MediaNearGame;
  /** How reaction GIFs from a GIF library are treated. 'label': by their label. 'picture': like any other picture. */
  reactionGifs: ReactionGifs;
  /** GIFs (library GIFs, X GIF video, .gif pictures) that are all a reply says. */
  replyGifs: ReplyPictures;
  /** Other pictures (uploads, photos) that are all a reply says. */
  replyPhotos: ReplyPictures;
  /** When a comment is hidden, hide every reply nested under it too. Off: each reply is judged on its own. */
  hideReplies: boolean;
  categories: Record<Category, boolean>;
  customWords: string[];
  /** Hide everything from the built-in spoiler accounts (src/accounts.ts), and posts that link to or name them. */
  spoilerAccounts: boolean;
  /** The person's own accounts to hide: links to an account's page, or a YouTube @handle. */
  blockedAccounts: string[];
  allowWords: string[];
  /**
   * Accounts never to hide (account keys, as in `blockedAccounts`, so each one is for one site). They are left out of the built-in
   * account rule only: their posts are still checked word by word like anyone's, and `blockedAccounts` wins over this list.
   */
  allowAccounts: string[];
  /** Words that make a nearby name count as being about the game. Starts as the built-in list. */
  hintWords: string[];
  /** Safe places (a whole site, part of a site, or one page) where nothing is ever hidden. */
  allowSites: SitePattern[];
  /** Places that always use Strict. */
  blockSites: SitePattern[];
  updateEvery: UpdateEvery;

  // Finer controls. Each starts at today's behaviour.
  preset: Preset;
  blur: BlurStrength;
  /** The cover says what kind of thing it hides (character, place, mission, story), never the word. */
  showReason: boolean;
  /** Opt-in debug: label tooltips and a page attribute show the rule and the matched terms. Shows spoilers. */
  debugWhy: boolean;
  revealMode: RevealMode;
  /** A revealed item stays revealed on this page after a rescan. */
  rememberReveals: boolean;
  categoryModes: Record<Category, CategoryMode>;
  /** What to protect: a preset, or 'custom' when `kindModes` was edited by hand. */
  protect: Protect;
  /**
   * The preset Custom started from (the preset itself while one is chosen). A Custom row still set as this preset sets it keeps
   * the preset's behaviour, raises included: only a row the user really changed is final for its kind.
   */
  customBase: PresetProtect;
  /** One choice per kind of list entry. Follows the preset unless `protect` is 'custom'. */
  kindModes: Record<Kind, CategoryMode>;
  /**
   * Rare made-up person names (list entries with `r`): their own row, in place of their kind's. Whatever the choice, such a name
   * still marks a post as being about the game.
   */
  rareNames: CategoryMode;
  parts: Record<PagePart, boolean>;
  /** Per-site overrides, keyed by host ("youtube.com"). */
  sites: Record<string, SiteOverride>;
  /** Overrides for a group of sites (groupsFor). A site's own entry beats its groups, field by field. */
  siteGroups: Partial<Record<SiteGroup, SiteOverride>>;
  pauseVideo: boolean;
  muteAudio: boolean;
  /** Blur only thumbnails and pictures, never text. */
  thumbsOnly: boolean;
  /** Epoch milliseconds. Nothing is hidden before this time. 0 = not paused. */
  pausedUntil: number;
  /** "YYYY-MM-DD": nothing is hidden on or after this day. "" = none. */
  endDate: string;
  /** When hiding starts, same forms as endDate. Empty: no start limit. */
  startDate: string;
  /** The start and end times are switched off and kept for later. */
  timerOff: boolean;
  /** Launch-week blackout: hide every post naming the game for this many days from release (0 = off, the default; -1 = no end). */
  blackoutDays: -1 | 0 | 3 | 7 | 14;
  /** When the blackout starts (YYYY-MM-DDTHH:MM). Empty: the release day from the list. */
  blackoutFrom: string;
  /** The time zone blackoutFrom is in. Empty: the browser's own. */
  blackoutZone: string;
  /** Things shown in official trailers are never hidden (needs list entries marked as trailer content). */
  allowTrailers: boolean;
  /** The big official stores and the publisher's own site and accounts are let through (src/adapters/official.ts): their pages, search results and cards that link to them. */
  allowStores: boolean;
  /** "I have finished the story": nothing is hidden. */
  storyFinished: boolean;
  showBadge: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  strictness: 'medium',
  hideMode: 'blur',
  hideImages: true,
  hideMediaPosts: true,
  mediaNearGame: 'post',
  reactionGifs: 'label',
  replyGifs: REPLY_PICTURE_DEFAULTS.replyGifs,
  replyPhotos: REPLY_PICTURE_DEFAULTS.replyPhotos,
  hideReplies: true,
  categories: Object.fromEntries(CATEGORIES.map((c) => [c, c !== 'trailers'])) as Record<Category, boolean>,
  customWords: [],
  spoilerAccounts: true,
  blockedAccounts: [],
  allowWords: [],
  allowAccounts: [],
  hintWords: DEFAULT_HINTS,
  allowSites: [],
  blockSites: [],
  updateEvery: 'hourly',
  preset: 'careful',
  blur: 'medium',
  showReason: true,
  debugWhy: false,
  revealMode: 'click',
  rememberReveals: false,
  // Official trailer content shows by default: the trailers category is off and trailer names are let through.
  categoryModes: Object.fromEntries(CATEGORIES.map((c) => [c, c === 'trailers' ? 'off' : 'always'])) as Record<Category, CategoryMode>,
  protect: 'story',
  customBase: 'story',
  kindModes: presetKindModes('story'),
  rareNames: 'mention',
  parts: Object.fromEntries(PAGE_PARTS.map((p) => [p, true])) as Record<PagePart, boolean>,
  sites: {},
  siteGroups: {},
  pauseVideo: true,
  muteAudio: true,
  thumbsOnly: false,
  pausedUntil: 0,
  endDate: '',
  startDate: '',
  timerOff: false,
  blackoutDays: 0,
  blackoutFrom: '',
  blackoutZone: '',
  allowTrailers: true,
  allowStores: true,
  storyFinished: false,
  showBadge: true,
};

export const UPDATE_MINUTES: Record<UpdateEvery, number | null> = {
  hourly: 60,
  '6h': 360,
  daily: 1440,
  manual: null,
};

/** Fill gaps and drop junk so a damaged or older saved value never breaks the extension. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const oneOf = <T extends string>(v: unknown, ok: readonly T[], fallback: T): T =>
    ok.includes(v as T) ? (v as T) : fallback;
  const list = (v: unknown, clean: (s: string) => string): string[] =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map(clean).filter(Boolean))] : [];
  const cats = (r.categories && typeof r.categories === 'object' ? r.categories : {}) as Record<string, unknown>;

  const modeIn = (r.categoryModes && typeof r.categoryModes === 'object' ? r.categoryModes : {}) as Record<string, unknown>;
  const categoryModes = Object.fromEntries(
    CATEGORIES.map((c) => [
      c,
      // Older saved settings only had a switch per category: on is "always", off is "off". Nothing saved: the default.
      wordsOnly(c, oneOf(modeIn[c], ['off', 'mention', 'always'] as const, cats[c] === false ? 'off' : cats[c] === true ? 'always' : DEFAULT_SETTINGS.categoryModes[c])),
    ]),
  ) as Record<Category, CategoryMode>;
  const { protect, kindModes, customBase } = normalizeProtect(r, categoryModes);
  const partsIn = (r.parts && typeof r.parts === 'object' ? r.parts : {}) as Record<string, unknown>;
  const sitesIn = (r.sites && typeof r.sites === 'object' && !Array.isArray(r.sites) ? r.sites : {}) as Record<string, unknown>;
  const sites: Record<string, SiteOverride> = {};
  for (const [k, v] of Object.entries(sitesIn).slice(0, 200)) {
    const host = normalizeHost(k);
    if (host && v && typeof v === 'object') sites[host] = normalizeSite(v as Record<string, unknown>);
  }
  const groupsIn = (r.siteGroups && typeof r.siteGroups === 'object' && !Array.isArray(r.siteGroups) ? r.siteGroups : {}) as Record<string, unknown>;
  const siteGroups: Partial<Record<SiteGroup, SiteOverride>> = {};
  for (const g of SITE_GROUPS) {
    const v = groupsIn[g];
    if (v && typeof v === 'object' && !Array.isArray(v)) siteGroups[g] = normalizeSite(v as Record<string, unknown>);
  }

  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    strictness: oneOf(r.strictness, ['light', 'medium', 'strict'] as const, d.strictness),
    hideMode: oneOf(r.hideMode, ['blur', 'collapse', 'remove'] as const, d.hideMode),
    hideImages: typeof r.hideImages === 'boolean' ? r.hideImages : d.hideImages,
    hideMediaPosts: typeof r.hideMediaPosts === 'boolean' ? r.hideMediaPosts : d.hideMediaPosts,
    mediaNearGame: oneOf(r.mediaNearGame, ['off', 'page', 'post'] as const, d.mediaNearGame),
    reactionGifs: oneOf(r.reactionGifs, ['label', 'picture'] as const, d.reactionGifs),
    replyGifs: oneOf(r.replyGifs, ['show', 'cover'] as const, REPLY_PICTURE_DEFAULTS.replyGifs),
    replyPhotos: oneOf(r.replyPhotos, ['show', 'cover'] as const, REPLY_PICTURE_DEFAULTS.replyPhotos),
    hideReplies: typeof r.hideReplies === 'boolean' ? r.hideReplies : d.hideReplies,
    // `categories` is the on/off view of `categoryModes`, kept so older readers keep working.
    categories: Object.fromEntries(CATEGORIES.map((c) => [c, categoryModes[c] !== 'off'])) as Record<Category, boolean>,
    customWords: list(r.customWords, (s) => s.trim().slice(0, 80)),
    spoilerAccounts: typeof r.spoilerAccounts === 'boolean' ? r.spoilerAccounts : d.spoilerAccounts,
    blockedAccounts: list(r.blockedAccounts, (s) => parseAccount(s.slice(0, 200)) ?? ''),
    allowWords: list(r.allowWords, (s) => s.trim().slice(0, 80)),
    allowAccounts: allowAccountList(r.allowAccounts),
    // An empty saved list is a real choice (no hints at all); only a missing one falls back to the built-in list.
    hintWords: Array.isArray(r.hintWords) ? list(r.hintWords, (s) => s.trim().slice(0, 40)) : d.hintWords,
    allowSites: patternList(r.allowSites),
    blockSites: patternList(r.blockSites),
    updateEvery: oneOf(r.updateEvery, ['hourly', '6h', 'daily', 'manual'] as const, d.updateEvery),
    preset: oneOf(r.preset, ['casual', 'careful', 'blackout', 'custom'] as const, d.preset),
    blur: oneOf(r.blur, BLURS, d.blur),
    showReason: typeof r.showReason === 'boolean' ? r.showReason : d.showReason,
    debugWhy: typeof r.debugWhy === 'boolean' ? r.debugWhy : d.debugWhy,
    revealMode: oneOf(r.revealMode, ['click', 'hold', 'twice'] as const, d.revealMode),
    rememberReveals: typeof r.rememberReveals === 'boolean' ? r.rememberReveals : d.rememberReveals,
    categoryModes,
    protect,
    customBase,
    kindModes,
    // Settings saved before the row existed get its default.
    rareNames: oneOf(r.rareNames, KIND_MODES, d.rareNames),
    parts: Object.fromEntries(PAGE_PARTS.map((p) => [p, typeof partsIn[p] === 'boolean' ? partsIn[p] : d.parts[p]])) as Record<PagePart, boolean>,
    sites,
    siteGroups,
    pauseVideo: typeof r.pauseVideo === 'boolean' ? r.pauseVideo : d.pauseVideo,
    muteAudio: typeof r.muteAudio === 'boolean' ? r.muteAudio : d.muteAudio,
    thumbsOnly: typeof r.thumbsOnly === 'boolean' ? r.thumbsOnly : d.thumbsOnly,
    pausedUntil: typeof r.pausedUntil === 'number' && Number.isFinite(r.pausedUntil) && r.pausedUntil > 0 ? Math.floor(r.pausedUntil) : 0,
    endDate: isTimeText(r.endDate) ? r.endDate : '',
    startDate: isTimeText(r.startDate) ? r.startDate : '',
    timerOff: r.timerOff === true,
    blackoutDays: ([-1, 0, 3, 7, 14] as const).find((n) => n === r.blackoutDays) ?? 0,
    blackoutFrom: isTimeText(r.blackoutFrom) && r.blackoutFrom.includes('T') ? r.blackoutFrom : '',
    blackoutZone: isZone(r.blackoutZone) ? r.blackoutZone : '',
    allowTrailers: typeof r.allowTrailers === 'boolean' ? r.allowTrailers : d.allowTrailers,
    allowStores: typeof r.allowStores === 'boolean' ? r.allowStores : d.allowStores,
    storyFinished: typeof r.storyFinished === 'boolean' ? r.storyFinished : d.storyFinished,
    showBadge: typeof r.showBadge === 'boolean' ? r.showBadge : d.showBadge,
  };
}

const KIND_MODES = ['off', 'mention', 'always'] as const;

/** The most accounts never to hide kept, and the most words the right-click adds to the words never to hide. */
export const MAX_ALLOW = 500;

/** Saved accounts never to hide: account keys in their one spelling, no junk, no repeats. */
function allowAccountList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const keys = v.filter((x): x is string => typeof x === 'string').map((x) => parseAccount(x.slice(0, 200)) ?? '');
  return [...new Set(keys.filter(Boolean))].slice(0, MAX_ALLOW);
}

/**
 * Topics that go by words only (leaks, trailers). Their words count the same under Hide and the middle choice (the matcher only
 * asks whether the topic is on), so the page offers no middle choice and a saved one is read as Hide. The one difference: a list
 * entry tagged leaks or trailers (none in today's list) would now hide as the list says instead of waiting for a page about the
 * game (levels.ts).
 */
export const WORDS_ONLY_TOPICS: ReadonlySet<Category> = new Set(['leaks', 'trailers']);
const wordsOnly = (c: Category, m: CategoryMode): CategoryMode => (m === 'mention' && WORDS_ONLY_TOPICS.has(c) ? 'always' : m);

/**
 * A preset decides every kind's choice itself. Only 'custom' keeps what was saved per kind.
 * Settings saved before kinds existed start from "Main story"; a category that was switched off
 * (or set to "only when the page is about the game") carries over to the kinds inside it, and
 * that makes the result Custom, since it no longer matches the preset.
 * `customBase` is the preset Custom came from. Custom saved before it existed gets the preset its rows match best
 * (a tie goes to Main story, the default every older Custom started from).
 */

function normalizeProtect(r: Record<string, unknown>, categoryModes: Record<Category, CategoryMode>) {
  const saved = r.kindModes && typeof r.kindModes === 'object' && !Array.isArray(r.kindModes) ? (r.kindModes as Record<string, unknown>) : undefined;
  const named = PROTECTS.includes(r.protect as Protect) ? (r.protect as Protect) : undefined;
  if (named && named !== 'custom') return { protect: named, kindModes: presetKindModes(named), customBase: named };
  if (named === 'custom' || saved) {
    const savedBase = PRESET_PROTECTS.includes(r.customBase as PresetProtect) ? (r.customBase as PresetProtect) : undefined;
    // A kind added since the rows were saved ("other") starts as the preset Custom came from sets it (Main story when that is unknown).
    const base = presetKindModes(savedBase ?? 'story');
    const kindModes = Object.fromEntries(KINDS.map((k) => [k, KIND_MODES.includes(saved?.[k] as CategoryMode) ? (saved![k] as CategoryMode) : base[k]])) as Record<Kind, CategoryMode>;
    return { protect: 'custom' as const, kindModes, customBase: savedBase ?? closestPreset(kindModes) };
  }
  const kindModes = presetKindModes('story');
  for (const k of KINDS) {
    const m = categoryModes[KIND_CATEGORY[k]];
    if (m === 'off') kindModes[k] = 'off';
    else if (m === 'mention' && kindModes[k] === 'always') kindModes[k] = 'mention';
  }
  const same = KINDS.every((k) => kindModes[k] === presetKindModes('story')[k]);
  return { protect: same ? ('story' as const) : ('custom' as const), kindModes, customBase: 'story' as const };
}

/** The preset whose rows match the most of these; Main story wins a tie. */
function closestPreset(kindModes: Record<Kind, CategoryMode>): PresetProtect {
  const score = (p: PresetProtect) => KINDS.filter((k) => presetKindModes(p)[k] === kindModes[k]).length;
  return (['story', 'big', 'all'] as const).reduce((best, p) => (score(p) > score(best) ? p : best));
}

const BLURS = ['light', 'medium', 'heavy', 'solid'] as const;

function normalizeSite(v: Record<string, unknown>): SiteOverride {
  const out: SiteOverride = {};
  // false is kept: a site switched on beats a group that is switched off.
  if (typeof v.off === 'boolean') out.off = v.off;
  if (['light', 'medium', 'strict'].includes(v.strictness as string)) out.strictness = v.strictness as Strictness;
  if (v.hideMode === 'blur' || v.hideMode === 'collapse' || v.hideMode === 'remove') out.hideMode = v.hideMode;
  if (BLURS.includes(v.blur as BlurStrength)) out.blur = v.blur as BlurStrength;
  if (v.parts && typeof v.parts === 'object') {
    const parts: Partial<Record<PagePart, boolean>> = {};
    for (const p of PAGE_PARTS) {
      const x = (v.parts as Record<string, unknown>)[p];
      if (typeof x === 'boolean') parts[p] = x;
    }
    if (Object.keys(parts).length) out.parts = parts;
  }
  for (const f of ['hideImages', 'hideMediaPosts', 'thumbsOnly'] as const) if (typeof v[f] === 'boolean') out[f] = v[f];
  if (['off', 'page', 'post'].includes(v.mediaNearGame as string)) out.mediaNearGame = v.mediaNearGame as MediaNearGame;
  if (v.reactionGifs === 'label' || v.reactionGifs === 'picture') out.reactionGifs = v.reactionGifs;
  if (v.replyGifs === 'show' || v.replyGifs === 'cover') out.replyGifs = v.replyGifs;
  if (v.replyPhotos === 'show' || v.replyPhotos === 'cover') out.replyPhotos = v.replyPhotos;
  return out;
}

/** The site entry that applies to a host: its own, or the closest parent site's (the most specific name wins). */
function siteKey(s: Pick<Settings, 'sites'>, host: string): string | undefined {
  const h = host.toLowerCase().replace(/^www\./, '');
  return h ? Object.keys(s.sites).filter((k) => h === k || h.endsWith('.' + k)).sort((a, b) => b.length - a.length)[0] : undefined;
}

/** Groups of sites that can share one override. */
export type SiteGroup = 'livestream' | 'youtube';
export const SITE_GROUPS: readonly SiteGroup[] = ['livestream', 'youtube'];

/** A YouTube page that is a live stream by its address alone. A live stream opened as a /watch link is not seen (BUGS.md B-049). */
const YOUTUBE_LIVE_PATH = /^\/(live\/[^/]+|@[^/]+\/live|channel\/[^/]+\/live|c\/[^/]+\/live)$/i;

/**
 * The groups an address belongs to, the most specific first. livestream: Twitch, Kick, and YouTube live pages. youtube: every
 * YouTube host (music, mobile, youtu.be). Read from the address only, never the page.
 */
export function groupsFor(url: string): SiteGroup[] {
  const a = parseAddress(url);
  if (!a) return [];
  const under = (h: string) => a.host === h || a.host.endsWith('.' + h);
  const youtube = under('youtube.com') || a.host === 'youtu.be';
  const out: SiteGroup[] = [];
  if (under('twitch.tv') || under('kick.com') || (youtube && YOUTUBE_LIVE_PATH.test(a.path))) out.push('livestream');
  if (youtube) out.push('youtube');
  return out;
}

/** The entries that apply, strongest first: the site's own, then its groups. */
function overrides(s: Pick<Settings, 'sites' | 'siteGroups'>, host: string, url: string): SiteOverride[] {
  const key = siteKey(s, host);
  return [key ? s.sites[key] : undefined, ...groupsFor(url).map((g) => s.siteGroups?.[g])].filter((o): o is SiteOverride => !!o);
}

/** One override from several, field by field: the first that sets a field wins it (page parts one by one too). */
function merged(list: SiteOverride[]): SiteOverride | undefined {
  if (!list.length) return undefined;
  const out: SiteOverride = {};
  for (const o of [...list].reverse()) {
    const { parts, ...rest } = o;
    Object.assign(out, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
    if (parts) out.parts = { ...out.parts, ...parts };
  }
  return out;
}

/**
 * Settings that apply at one address: the global values, then the site's own entry and its groups (settings.ts groupsFor; the
 * site's own entry wins, then the most specific group), then the Safe and Strict lists matched against the whole address: a
 * listed place is Strict "whatever you chose above", a site's own level included. A frame passes `ownHost` so that a site's own
 * look-and-feel entry still follows the frame's own site; the groups and the lists follow the tab's page (`url`), as groups are
 * read from the page address and a frame has none of its own.
 * Pictures are not here: picturesFor is the one place a site's picture values are read.
 */
export function settingsForUrl(s: Settings, url: string, ownHost?: string): Settings {
  const parsed = parseAddress(url);
  const o = merged(overrides(s, ownHost ?? parsed?.host ?? '', url));
  const verdict = listVerdict(s, url);
  const listOff = verdict === 'safe';
  const listStrict = verdict === 'strict';
  if (!o && !listOff && !listStrict) return s;
  return {
    ...s,
    enabled: s.enabled && !o?.off && !listOff,
    strictness: listStrict ? 'strict' : (o?.strictness ?? s.strictness),
    hideMode: o?.hideMode ?? s.hideMode,
    blur: o?.blur ?? s.blur,
    parts: { ...s.parts, ...(o?.parts ?? {}) },
  };
}

/** Where the level at an address comes from, as settingsForUrl reads it: the Strict list, the site's own entry, a group, a changed global level, or none. */
export type StrictnessSource = 'default' | 'global' | 'site' | 'group' | 'list';
export function strictnessSource(s: Settings, url: string, ownHost?: string): StrictnessSource {
  if (listVerdict(s, url) === 'strict') return 'list';
  const key = siteKey(s, ownHost ?? parseAddress(url)?.host ?? '');
  if (key && s.sites[key]?.strictness !== undefined) return 'site';
  if (groupsFor(url).some((g) => s.siteGroups?.[g]?.strictness !== undefined)) return 'group';
  return s.strictness === DEFAULT_SETTINGS.strictness ? 'default' : 'global';
}

/** Settings as a group's own entry sets them, pictures included (the options page draws a group's examples with these). */
export function settingsForGroup(s: Settings, group: SiteGroup): Settings {
  const o = s.siteGroups[group] ?? {};
  const pictures = Object.fromEntries(SITE_PICTURE_FIELDS.filter((f) => o[f] !== undefined).map((f) => [f, o[f]]));
  return { ...s, enabled: s.enabled && !o.off, strictness: o.strictness ?? s.strictness, hideMode: o.hideMode ?? s.hideMode, blur: o.blur ?? s.blur, parts: { ...s.parts, ...o.parts }, ...pictures };
}

/** The seven picture settings, each with its value. */
export type Pictures = Pick<Settings, SitePictureField>;

/** What a scanner built without settings does (tests, previews of one choice): pictures are not checked. */
export const BARE_PICTURES: Pictures = { hideImages: false, hideMediaPosts: true, mediaNearGame: 'page', reactionGifs: 'label', ...REPLY_PICTURE_DEFAULTS, thumbsOnly: false };

/** Each picture setting's values from the most lenient to the strictest. thumbsOnly false is stricter: words are hidden too. */
const PICTURE_STRICTNESS: { [F in SitePictureField]: readonly Pictures[F][] } = {
  hideImages: [false, true],
  hideMediaPosts: [false, true],
  mediaNearGame: ['off', 'page', 'post'],
  reactionGifs: ['label', 'picture'],
  replyGifs: ['show', 'cover'],
  replyPhotos: ['show', 'cover'],
  thumbsOnly: [true, false],
};

/**
 * The one place picture settings are resolved: the global values (a missing or broken one gets its default), then the site's own
 * entry and its groups, as settingsForUrl merges them. The site is the tab's (`url`); `host` is only used when the address has
 * none, so a frame follows the page it sits in. `fromSite`: the fields a site or group decided. `global`: the values without them.
 * `blackout`: the launch-week blackout is on; a site or group value counts then only when it is at least as strict as the
 * global one, so a site set to show pictures never weakens the blackout.
 */
export function picturesFor(saved: Settings, url: string, host?: string, at: { blackout?: boolean } = {}): { values: Pictures; fromSite: Set<SitePictureField>; global: Pictures } {
  const values = Object.fromEntries(
    SITE_PICTURE_FIELDS.map((f) => [f, (PICTURE_STRICTNESS[f] as readonly unknown[]).includes(saved[f]) ? saved[f] : DEFAULT_SETTINGS[f]]),
  ) as Pictures;
  const global = { ...values };
  const fromSite = new Set<SitePictureField>();
  const list = overrides(saved, parseAddress(url)?.host ?? host ?? '', url);
  for (const f of SITE_PICTURE_FIELDS) {
    const rank = (x: unknown) => (PICTURE_STRICTNESS[f] as readonly unknown[]).indexOf(x);
    // The strongest entry that sets the field and, in the blackout, is at least as strict as the global value.
    const v = list.map((o) => o[f]).find((x) => x !== undefined && (!at.blackout || rank(x) >= rank(values[f])));
    if (v === undefined) continue;
    (values as Record<string, unknown>)[f] = v;
    fromSite.add(f);
  }
  return { values, fromSite, global };
}

/**
 * What the site entries and groups decide at an address, as one string ('' when there are none). A single-page site that moves
 * to an address where it differs (YouTube home to a live page) starts its scan again.
 */
export function siteDecisionKey(s: Settings, url: string, host?: string): string {
  if (!Object.keys(s.sites).length && !Object.keys(s.siteGroups ?? {}).length) return '';
  const o = settingsForUrl(s, url, host);
  return JSON.stringify([o.enabled, o.strictness, o.hideMode, o.blur, o.parts, picturesFor(s, url, host).values]);
}

/** The group that switches everything off at an address, when the site's own entry does not (the popup names it). */
export function groupSwitchedOff(s: Pick<Settings, 'sites' | 'siteGroups'>, url: string): SiteGroup | undefined {
  const key = siteKey(s, parseAddress(url)?.host ?? '');
  if (key && s.sites[key]!.off !== undefined) return undefined;
  return groupsFor(url).find((g) => s.siteGroups?.[g]?.off);
}

/**
 * The group that decides some of the pictures at an address (the popup names it), or undefined when the site's own entry or
 * nothing does.
 */
export function groupDeciding(s: Pick<Settings, 'sites' | 'siteGroups'>, url: string, host?: string): SiteGroup | undefined {
  const key = siteKey(s, parseAddress(url)?.host ?? host ?? '');
  const own = key ? s.sites[key] : undefined;
  const open = SITE_PICTURE_FIELDS.filter((f) => own?.[f] === undefined);
  return groupsFor(url).find((g) => open.some((f) => s.siteGroups?.[g]?.[f] !== undefined));
}

/**
 * The one-tap choice for pictures on a site (the popup and the right-click menu).
 * covered: the strictest picture choices, the same as the Blackout preset's: pictures and clips near the game are covered.
 * shown: pictures are not covered for being pictures (no picture check, nothing for being near the game, reply and reaction GIFs
 * and photos shown). A post whose words give something away is still hidden, pictures and all.
 * Neither touches "Cover pictures only, never words" (thumbsOnly): it decides about words, not pictures. 'same' removes every
 * picture field of the site, thumbsOnly included.
 */
export type SitePictures = 'covered' | 'shown' | 'same';
type PictureChoice = Pick<Settings, Exclude<SitePictureField, 'thumbsOnly'>>;
export const SITE_PICTURES: Record<Exclude<SitePictures, 'same'>, PictureChoice> = {
  covered: { hideImages: true, hideMediaPosts: true, mediaNearGame: 'post', reactionGifs: 'picture', replyGifs: 'cover', replyPhotos: 'cover' },
  shown: { hideImages: false, hideMediaPosts: false, mediaNearGame: 'off', reactionGifs: 'label', replyGifs: 'show', replyPhotos: 'show' },
};

/** Where a one-tap choice is read or written: a site (by host) or a group. */
export type PictureTarget = string | { group: SiteGroup };

/** What a site's or a group's pictures are set to now. 'mixed': it has picture values of its own that are neither choice. */
export function sitePicturesChoice(s: Pick<Settings, 'sites'> & Partial<Pick<Settings, 'siteGroups'>>, target: PictureTarget): SitePictures | 'mixed' {
  let o: SiteOverride = {};
  if (typeof target === 'string') {
    const key = siteKey(s, target);
    o = key ? s.sites[key]! : {};
  } else o = s.siteGroups?.[target.group] ?? {};
  if (SITE_PICTURE_FIELDS.every((f) => o[f] === undefined)) return 'same';
  for (const c of ['covered', 'shown'] as const) if (Object.entries(SITE_PICTURES[c]).every(([f, v]) => o[f as SitePictureField] === v)) return c;
  return 'mixed';
}

/** An entry with its pictures set to `choice`; undefined when 'same' leaves nothing in it. */
function withChoice(o: SiteOverride, choice: SitePictures): SiteOverride | undefined {
  if (choice !== 'same') return { ...o, ...SITE_PICTURES[choice] };
  const kept = Object.fromEntries(Object.entries(o).filter(([f]) => !(SITE_PICTURE_FIELDS as readonly string[]).includes(f))) as SiteOverride;
  return Object.keys(kept).length ? kept : undefined;
}

/**
 * The sites with a host's pictures set to `choice`, written to the site entry that already applies to the host (so a subdomain
 * keeps its parent site's other choices), or a new one for the host. 'same' drops the entry when nothing else is left in it.
 */
export function withSitePictures(s: Pick<Settings, 'sites'>, host: string, choice: SitePictures): Record<string, SiteOverride> {
  const key = siteKey(s, host) ?? normalizeHost(host);
  if (!key) return s.sites;
  const { [key]: old, ...rest } = s.sites;
  const next = withChoice(old ?? {}, choice);
  return next ? { ...s.sites, [key]: next } : rest;
}

/** The same for a group. */
export function withGroupPictures(s: Pick<Settings, 'siteGroups'>, group: SiteGroup, choice: SitePictures): Partial<Record<SiteGroup, SiteOverride>> {
  const { [group]: old, ...rest } = s.siteGroups ?? {};
  const next = withChoice(old ?? {}, choice);
  return next ? { ...s.siteGroups, [group]: next } : rest;
}

/** What the two address lists say about one address. Safe wins over Strict. */
export type ListVerdict = 'safe' | 'strict' | 'normal';

export function listVerdict(s: Pick<Settings, 'allowSites' | 'blockSites'>, url: string): ListVerdict {
  if (urlMatches(url, s.allowSites)) return 'safe';
  if (urlMatches(url, s.blockSites)) return 'strict';
  return 'normal';
}

/**
 * Pure decision for a single-page site that changed address: restart only when the Safe/Strict answer
 * differs from the one the running scan was started with.
 */
export function addressChange(s: Pick<Settings, 'allowSites' | 'blockSites'>, prev: ListVerdict, url: string): { verdict: ListVerdict; restart: boolean } {
  const verdict = listVerdict(s, url);
  return { verdict, restart: verdict !== prev };
}

/** The game's own name in its usual spellings: during the launch-week blackout any post naming it is hidden (game name only). */
export const BLACKOUT_WORDS = ['GTA 6', 'GTA VI', 'GTA Six', 'Grand Theft Auto 6', 'Grand Theft Auto VI', 'Grand Theft Auto Six', 'GTA6Leak', 'GTA6Leaks', 'GTA6Spoiler', 'GTA6Spoilers', 'GTAVILeaks', 'GTAVISpoilers'] as const;

/** A wall-clock time in a named time zone, as a moment. Empty or unknown zone: the browser's own. */
export function zonedTime(text: string, zone: string): number {
  if (!zone) return timeOf(text);
  const wall = Date.parse(`${text}Z`);
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(t).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - t;
  };
  try {
    // Twice, as the offset at the first guess can differ across a clock change.
    return wall - offsetAt(wall - offsetAt(wall));
  } catch {
    return timeOf(text);
  }
}
const isZone = (z: unknown): z is string => {
  if (typeof z !== 'string' || !z) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return true;
  } catch {
    return false;
  }
};

type BlackoutSettings = Pick<Settings, 'blackoutDays'> & Partial<Pick<Settings, 'blackoutFrom' | 'blackoutZone'>>;
/** The person's own start time if set, otherwise the release day (local midnight); undefined when neither is known. */
function blackoutStart(s: BlackoutSettings, release: string | undefined): number | undefined {
  if (s.blackoutFrom) return zonedTime(s.blackoutFrom, s.blackoutZone ?? '');
  return release && /^\d{4}-\d{2}-\d{2}$/.test(release) ? Date.parse(`${release}T00:00:00`) : undefined;
}

/** Is the blackout on now? For `blackoutDays` days from its start; never without a start. */
export function blackoutOn(s: BlackoutSettings, release: string | undefined, now: number): boolean {
  const start = blackoutStart(s, release);
  if (!s.blackoutDays || start === undefined) return false;
  return now >= start && (s.blackoutDays < 0 || now < start + s.blackoutDays * 86_400_000);
}

/** When the blackout next starts or ends, so an open tab can look again then; undefined when it will not change. */
export function blackoutNextChange(s: BlackoutSettings, release: string | undefined, now: number): number | undefined {
  const start = blackoutStart(s, release);
  if (!s.blackoutDays || start === undefined) return undefined;
  if (now < start) return start;
  if (s.blackoutDays < 0) return undefined;
  const end = start + s.blackoutDays * 86_400_000;
  return now < end ? end : undefined;
}

/** A day (YYYY-MM-DD), read as local midnight, or a day and time (YYYY-MM-DDTHH:MM), read as local time. */
const isTimeText = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v) && !Number.isNaN(timeOf(v));
export const timeOf = (v: string): number => Date.parse(v.includes('T') ? v : `${v}T00:00:00`);

/** The next moment the start or end time changes whether anything is hidden; undefined when neither lies ahead. */
export function timerNextChange(s: Pick<Settings, 'startDate' | 'endDate' | 'timerOff'>, now: number): number | undefined {
  if (s.timerOff) return undefined;
  const ahead = [s.startDate, s.endDate].filter(Boolean).map(timeOf).filter((t) => t > now);
  return ahead.length ? Math.min(...ahead) : undefined;
}

/** What the on/off line should say: "on" only when hiding really is happening. */
export function blockingStatus(s: Settings, now: number): { on: boolean; text: string } {
  if (!s.enabled) return { on: false, text: TEXT.masterOff };
  if (s.storyFinished) return { on: false, text: TEXT.masterFinished };
  if (s.pausedUntil > now) return { on: false, text: TEXT.masterPaused };
  if (!s.timerOff && s.startDate && now < timeOf(s.startDate)) return { on: false, text: TEXT.masterNotYet };
  if (isSuspended(s, now)) return { on: false, text: TEXT.masterEnded };
  return { on: true, text: TEXT.masterOn };
}

/** Nothing is hidden: paused, past the end date, or the story is finished. `now` is passed in so tests need no clock. */
export function isSuspended(s: Settings, now: number): boolean {
  if (s.storyFinished) return true;
  if (s.pausedUntil > now) return true;
  if (!s.timerOff && s.endDate && now >= timeOf(s.endDate)) return true;
  if (!s.timerOff && s.startDate && now < timeOf(s.startDate)) return true;
  return false;
}

/** The named presets set the how-it-looks fields. Anything else the user changed stays. */
export const PRESETS: Record<Exclude<Preset, 'custom'>, Partial<Settings>> = {
  casual: { strictness: 'light', blur: 'light', hideMode: 'blur', showReason: true, mediaNearGame: 'page', hideMediaPosts: false },
  careful: { strictness: 'medium', blur: 'medium', hideMode: 'blur', showReason: true, mediaNearGame: 'post', hideMediaPosts: true },
  blackout: { strictness: 'strict', blur: 'solid', hideMode: 'remove', showReason: false, mediaNearGame: 'post', reactionGifs: 'picture', replyGifs: 'cover', replyPhotos: 'cover', hideMediaPosts: true },
};

export function applyPreset(s: Settings, name: Exclude<Preset, 'custom'>): Settings {
  return normalizeSettings({ ...s, ...PRESETS[name], preset: name });
}

/** "https://www.Reddit.com/r/x" -> "reddit.com". Returns "" for junk. */
export function normalizeHost(input: string): string {
  let s = input.trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0]!.replace(/:\d+$/, '');
  s = s.replace(/^www\./, '');
  return /^[a-z0-9.-]+$/.test(s) && s.includes('.') ? s : '';
}

export function hostMatches(host: string, entries: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return entries.some((e) => h === e || h.endsWith('.' + e));
}

// ---------------------------------------------------------------------------------------------
// Safe / Strict entries: a whole site, part of a site, or one page.
// ---------------------------------------------------------------------------------------------

/**
 * site:   `host` only (`path` is ''); matches the host and its subdomains.
 * prefix: `host` plus `path` ("/r/gta", no query, no trailing slash); matches that path and everything below it,
 *         on the host and its subdomains. Whole segments only: "/r/gta" does not match "/r/gtaonline".
 * page:   `host` plus `path` that includes the cleaned, sorted query ("/watch?v=abc"; the home page is "/");
 *         matches exactly that address on exactly that host.
 * Host is lower case without "www.". Paths are compared ignoring letter case (most sites treat them so, and a
 * wrong "match" on a Strict entry is harmless); query values are compared exactly, because video ids are case sensitive.
 */
export interface SitePattern {
  kind: 'site' | 'prefix' | 'page';
  host: string;
  path: string;
}

const PATTERN_KINDS = ['site', 'prefix', 'page'] as const;
/** Query parts that only say where a link was shared from. Ignored, so one page matches however it was copied. */
const TRACKING_PARAM = /^(utm_.*|si|fbclid|gclid|feature|ref_src)$/i;

interface Address {
  host: string;
  /** No trailing slash; '' for the site's front page. */
  path: string;
  /** Tracking removed, sorted, "a=1&b=2"; '' when none. */
  query: string;
}

/** Per-site extra query parts that do not change which page it is (where in the video, which playlist). */
const SITE_IGNORED_PARAMS: { hosts: string[]; params: string[] }[] = [
  { hosts: ['youtube.com', 'm.youtube.com', 'youtu.be'], params: ['t', 'start', 'list', 'index', 'pp'] },
];

function cleanQuery(params: URLSearchParams, host = ''): string {
  const extra = SITE_IGNORED_PARAMS.find((x) => x.hosts.includes(host))?.params ?? [];
  return [...params.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k) && !extra.includes(k.toLowerCase()))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/** Reads an address as pasted or typed. Anything that is not a web address on a dotted host gives null. */
function parseAddress(input: string): Address | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s || s.length > 2000) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (scheme) {
    if (!/^https?$/i.test(scheme[1]!)) return null;
  } else {
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return null; // "mailto:x@y.com", "javascript:..." (a port is digits)
    s = 'https://' + s.replace(/^\/\//, '');
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes('.') || host.includes('..')) return null;
  // "%74" and "t" are the same letter, and a pasted non-English name may arrive either way: compare them decoded.
  let path = u.pathname.replace(/\/+$/, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    /* a broken escape: keep it as it came */
  }
  // A short video link is the same page as the long one.
  const short = host === 'youtu.be' ? /^\/([\w-]+)$/.exec(path) : null;
  if (short) {
    const p = new URLSearchParams(u.searchParams);
    p.set('v', short[1]!);
    return { host: 'youtube.com', path: '/watch', query: cleanQuery(p, 'youtube.com') };
  }
  return { host, path, query: cleanQuery(u.searchParams, host) };
}

const pagePathOf = (a: Address) => (a.path || '/') + (a.query ? '?' + a.query : '');

/**
 * Turns what people paste into a pattern, or null for junk. Accepts a scheme, "www.", a port, a #fragment,
 * a trailing slash and tracking query bits; the host is lower-cased. Without `kind` a bare host is a site and
 * anything with a path or query is a page. An explicit 'prefix' drops the query, and with no path it becomes a
 * site; an explicit 'site' keeps the host only.
 */
export function parsePattern(input: string, kind?: SitePattern['kind']): SitePattern | null {
  const a = parseAddress(input);
  if (!a) return null;
  const k = kind ?? (a.path || a.query ? 'page' : 'site');
  if (k === 'site' || (k === 'prefix' && !a.path)) return { kind: 'site', host: a.host, path: '' };
  if (k === 'prefix') return { kind: 'prefix', host: a.host, path: a.path };
  return { kind: 'page', host: a.host, path: pagePathOf(a) };
}

/** Short text for a list row: "reddit.com", "reddit.com/r/gta", "youtube.com/watch?v=abc". */
export function patternLabel(p: SitePattern): string {
  return p.host + (p.kind === 'site' ? '' : p.path === '/' && p.kind === 'page' ? '/' : p.path);
}

/** Path words that only name a kind of page. A part of a site that ends in one of these would cover far too much ("reddit.com/r"). */
const GENERIC_SEGMENTS = new Set([
  'r', 'u', 'user', 'users', 'c', 'channel', 'watch', 'p', 'post', 'posts', 'status', 'comments', 'search', 'hashtag', 'explore', 'results',
  'home', 'i', 'in', 'pin', 'video', 'videos', 'shorts', 'playlist', 'wiki', 'topic', 'topics', 'tag', 'tags', 'thread', 'threads',
]);

/** A word after which comes the id of one single thing (a post, a video). That is "just this page", not a part. */
const ITEM_WORDS = new Set(['comments', 'status', 'p', 'post', 'posts', 'watch', 'video', 'shorts', 'playlist', 'thread', 'threads', 'topic', 'i']);

/**
 * What can be offered for an address, narrowest first: this page, up to two parts (the next meaningful folders,
 * such as /r/gta, never a bare "/r"), then the whole site. Empty for a non-web address.
 */
export function patternChoices(url: string): SitePattern[] {
  const a = parseAddress(url);
  if (!a) return [];
  const segs = a.path.split('/').filter(Boolean);
  const parts: SitePattern[] = [];
  for (let i = 1; i <= segs.length && parts.length < 2; i++) {
    if (GENERIC_SEGMENTS.has(segs[i - 1]!.toLowerCase())) continue;
    if (i > 1 && ITEM_WORDS.has(segs[i - 2]!.toLowerCase())) break; // everything after is one post or video
    parts.push({ kind: 'prefix', host: a.host, path: '/' + segs.slice(0, i).join('/') });
  }
  return [{ kind: 'page', host: a.host, path: pagePathOf(a) }, ...parts.reverse(), { kind: 'site', host: a.host, path: '' }];
}

/** The path part ignoring letter case, the query exactly (video ids are case sensitive). */
const pathKey = (path: string) => {
  const q = path.indexOf('?');
  return q < 0 ? path.toLowerCase() : path.slice(0, q).toLowerCase() + path.slice(q);
};
const patternKey = (p: SitePattern) => `${p.kind}|${p.host}|${pathKey(p.path)}`;

/** The same entry: same kind and host, the path ignoring letter case, the query exactly. */
export const samePattern = (a: SitePattern, b: SitePattern) => patternKey(a) === patternKey(b);

/** The entry for exactly this page: address and query, without the #hash or tracking bits. Undefined for a non-web address. */
export function pagePattern(url: string): SitePattern | undefined {
  const a = parseAddress(url);
  return a ? { kind: 'page', host: a.host, path: pagePathOf(a) } : undefined;
}

/** Adds an entry unless the same one is there; `added` is what Undo should take back (nothing when it was already there). */
export function addPattern(list: SitePattern[], p: SitePattern): { list: SitePattern[]; added?: SitePattern } {
  return list.some((x) => patternKey(x) === patternKey(p)) ? { list } : { list: [...list, p], added: p };
}

/** Takes back one entry that addPattern added; nothing else. */
export function removePattern(list: SitePattern[], added: SitePattern | undefined): SitePattern[] {
  return added ? list.filter((x) => patternKey(x) !== patternKey(added)) : list;
}

/** Saved lists: old plain-text hosts become whole-site entries; damaged entries are dropped. */
function patternList(v: unknown): SitePattern[] {
  if (!Array.isArray(v)) return [];
  const out = new Map<string, SitePattern>();
  for (const x of v.slice(0, 1000)) {
    let p: SitePattern | null = null;
    if (typeof x === 'string') p = parsePattern(x, 'site');
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (PATTERN_KINDS.includes(o.kind as SitePattern['kind']) && typeof o.host === 'string') {
        const path = typeof o.path === 'string' ? o.path : '';
        p = parsePattern(o.kind === 'site' ? o.host : o.host + (path.startsWith('/') || path.startsWith('?') ? '' : '/') + path, o.kind as SitePattern['kind']);
      }
    }
    if (p) out.set(patternKey(p), p);
  }
  return [...out.values()];
}

/** Whether an address falls under any entry. Not a web address: false. */
export function urlMatches(url: string, patterns: SitePattern[]): boolean {
  if (!patterns.length) return false;
  const a = parseAddress(url);
  if (!a) return false;
  const path = a.path.toLowerCase();
  return patterns.some((p) => {
    const underHost = a.host === p.host || a.host.endsWith('.' + p.host);
    if (p.kind === 'site') return underHost;
    if (p.kind === 'prefix') {
      const pp = p.path.toLowerCase();
      return underHost && (path === pp || path.startsWith(pp + '/'));
    }
    const [pPath = '/', pQuery = ''] = p.path.split(/\?(.*)/s);
    return a.host === p.host && (path || '/') === pPath.toLowerCase() && a.query === pQuery;
  });
}

/** An existing entry that already covers everything `p` would cover, or undefined. */
export function coveringEntry(patterns: SitePattern[], p: SitePattern): SitePattern | undefined {
  return patterns.find((v) => {
    const under = p.host === v.host || p.host.endsWith('.' + v.host);
    if (v.kind === 'site') return under;
    if (v.kind === 'prefix') {
      if (p.kind === 'site' || !under) return false;
      const vp = v.path.toLowerCase();
      const pp = p.path.toLowerCase().split('?')[0]!.replace(/\/$/, '');
      return pp === vp || pp.startsWith(vp + '/');
    }
    return p.kind === 'page' && p.host === v.host && pathKey(p.path) === pathKey(v.path);
  });
}

export async function loadSettings(): Promise<Settings> {
  try {
    const got = await chrome.storage.local.get('settings');
    return normalizeSettings(got.settings);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: s });
}
