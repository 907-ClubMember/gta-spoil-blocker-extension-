import { parseAccount } from './accounts';
import { DEFAULT_HINTS } from './matcher/hints';
import { TEXT } from './text';
import { CATEGORIES, KINDS, KIND_BASE_LEVEL, KIND_CATEGORY, type Category, type Kind, type Strictness } from './types';

/** blur: covered, click to show. collapse: gone, with a small line in its place. remove: gone, no trace. */
export type HideMode = 'blur' | 'collapse' | 'remove';
export type MediaNearGame = 'off' | 'page' | 'post';
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
}

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
  /** When a comment is hidden, hide every reply nested under it too. Off: each reply is judged on its own. */
  hideReplies: boolean;
  categories: Record<Category, boolean>;
  customWords: string[];
  /** Hide everything from the built-in spoiler accounts (src/accounts.ts), and posts that link to or name them. */
  spoilerAccounts: boolean;
  /** The person's own accounts to hide: links to an account's page, or a YouTube @handle. */
  blockedAccounts: string[];
  allowWords: string[];
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
  pauseVideo: boolean;
  muteAudio: boolean;
  /** Blur only thumbnails and pictures, never text. */
  thumbsOnly: boolean;
  /** Epoch milliseconds. Nothing is hidden before this time. 0 = not paused. */
  pausedUntil: number;
  /** "YYYY-MM-DD": nothing is hidden on or after this day. "" = none. */
  endDate: string;
  /** Launch-week blackout: hide every post naming the game for this many days from release (0 = off, the default). */
  blackoutDays: 0 | 3 | 7 | 14;
  /** Things shown in official trailers are never hidden (needs list entries marked as trailer content). */
  allowTrailers: boolean;
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
  mediaNearGame: 'page',
  hideReplies: true,
  categories: Object.fromEntries(CATEGORIES.map((c) => [c, true])) as Record<Category, boolean>,
  customWords: [],
  spoilerAccounts: true,
  blockedAccounts: [],
  allowWords: [],
  hintWords: DEFAULT_HINTS,
  allowSites: [],
  blockSites: [],
  updateEvery: 'hourly',
  preset: 'careful',
  blur: 'medium',
  showReason: true,
  revealMode: 'click',
  rememberReveals: false,
  categoryModes: Object.fromEntries(CATEGORIES.map((c) => [c, 'always'])) as Record<Category, CategoryMode>,
  protect: 'story',
  customBase: 'story',
  kindModes: presetKindModes('story'),
  rareNames: 'mention',
  parts: Object.fromEntries(PAGE_PARTS.map((p) => [p, true])) as Record<PagePart, boolean>,
  sites: {},
  pauseVideo: false,
  muteAudio: false,
  thumbsOnly: false,
  pausedUntil: 0,
  endDate: '',
  blackoutDays: 0,
  allowTrailers: false,
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
      // Older saved settings only had a switch per category: on is "always", off is "off".
      oneOf(modeIn[c], ['off', 'mention', 'always'] as const, cats[c] === false ? 'off' : 'always'),
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

  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    strictness: oneOf(r.strictness, ['light', 'medium', 'strict'] as const, d.strictness),
    hideMode: oneOf(r.hideMode, ['blur', 'collapse', 'remove'] as const, d.hideMode),
    hideImages: typeof r.hideImages === 'boolean' ? r.hideImages : d.hideImages,
    hideMediaPosts: typeof r.hideMediaPosts === 'boolean' ? r.hideMediaPosts : d.hideMediaPosts,
    mediaNearGame: oneOf(r.mediaNearGame, ['off', 'page', 'post'] as const, d.mediaNearGame),
    hideReplies: typeof r.hideReplies === 'boolean' ? r.hideReplies : d.hideReplies,
    // `categories` is the on/off view of `categoryModes`, kept so older readers keep working.
    categories: Object.fromEntries(CATEGORIES.map((c) => [c, categoryModes[c] !== 'off'])) as Record<Category, boolean>,
    customWords: list(r.customWords, (s) => s.trim().slice(0, 80)),
    spoilerAccounts: typeof r.spoilerAccounts === 'boolean' ? r.spoilerAccounts : d.spoilerAccounts,
    blockedAccounts: list(r.blockedAccounts, (s) => parseAccount(s.slice(0, 200)) ?? ''),
    allowWords: list(r.allowWords, (s) => s.trim().slice(0, 80)),
    // An empty saved list is a real choice (no hints at all); only a missing one falls back to the built-in list.
    hintWords: Array.isArray(r.hintWords) ? list(r.hintWords, (s) => s.trim().slice(0, 40)) : d.hintWords,
    allowSites: patternList(r.allowSites),
    blockSites: patternList(r.blockSites),
    updateEvery: oneOf(r.updateEvery, ['hourly', '6h', 'daily', 'manual'] as const, d.updateEvery),
    preset: oneOf(r.preset, ['casual', 'careful', 'blackout', 'custom'] as const, d.preset),
    blur: oneOf(r.blur, BLURS, d.blur),
    showReason: typeof r.showReason === 'boolean' ? r.showReason : d.showReason,
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
    pauseVideo: typeof r.pauseVideo === 'boolean' ? r.pauseVideo : d.pauseVideo,
    muteAudio: typeof r.muteAudio === 'boolean' ? r.muteAudio : d.muteAudio,
    thumbsOnly: typeof r.thumbsOnly === 'boolean' ? r.thumbsOnly : d.thumbsOnly,
    pausedUntil: typeof r.pausedUntil === 'number' && Number.isFinite(r.pausedUntil) && r.pausedUntil > 0 ? Math.floor(r.pausedUntil) : 0,
    endDate: typeof r.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.endDate) ? r.endDate : '',
    blackoutDays: ([0, 3, 7, 14] as const).find((n) => n === r.blackoutDays) ?? 0,
    allowTrailers: typeof r.allowTrailers === 'boolean' ? r.allowTrailers : d.allowTrailers,
    storyFinished: typeof r.storyFinished === 'boolean' ? r.storyFinished : d.storyFinished,
    showBadge: typeof r.showBadge === 'boolean' ? r.showBadge : d.showBadge,
  };
}

const KIND_MODES = ['off', 'mention', 'always'] as const;

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
  if (v.off === true) out.off = true;
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
  return out;
}

/**
 * Settings that apply at one address: the global values, then the per-site override matched by host (the most specific
 * host wins), then the Safe and Strict lists matched against the whole address: a listed place is Strict "whatever you chose
 * above", a site's own level included. A frame passes `ownHost` so that per-site
 * look-and-feel overrides still follow the frame's own site while the lists follow the tab's page (`url`).
 */
export function settingsForUrl(s: Settings, url: string, ownHost?: string): Settings {
  const parsed = parseAddress(url);
  const h = (ownHost ?? parsed?.host ?? '').toLowerCase().replace(/^www\./, '');
  const key = h ? Object.keys(s.sites).filter((k) => h === k || h.endsWith('.' + k)).sort((a, b) => b.length - a.length)[0] : undefined;
  const o = key ? s.sites[key] : undefined;
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

/** Is the launch-week blackout on now? From the release day (local midnight) for `blackoutDays` days; never without a date. */
export function blackoutOn(s: Pick<Settings, 'blackoutDays'>, release: string | undefined, now: number): boolean {
  if (!s.blackoutDays || !release || !/^\d{4}-\d{2}-\d{2}$/.test(release)) return false;
  const start = Date.parse(`${release}T00:00:00`);
  return now >= start && now < start + s.blackoutDays * 86_400_000;
}

/** When the blackout next starts or ends, so an open tab can look again then; undefined when it will not change. */
export function blackoutNextChange(s: Pick<Settings, 'blackoutDays'>, release: string | undefined, now: number): number | undefined {
  if (!s.blackoutDays || !release || !/^\d{4}-\d{2}-\d{2}$/.test(release)) return undefined;
  const start = Date.parse(`${release}T00:00:00`);
  const end = start + s.blackoutDays * 86_400_000;
  return now < start ? start : now < end ? end : undefined;
}

/** What the on/off line should say: "on" only when hiding really is happening. */
export function blockingStatus(s: Settings, now: number): { on: boolean; text: string } {
  if (!s.enabled) return { on: false, text: TEXT.masterOff };
  if (s.storyFinished) return { on: false, text: TEXT.masterFinished };
  if (s.pausedUntil > now) return { on: false, text: TEXT.masterPaused };
  if (isSuspended(s, now)) return { on: false, text: TEXT.masterEnded };
  return { on: true, text: TEXT.masterOn };
}

/** Nothing is hidden: paused, past the end date, or the story is finished. `now` is passed in so tests need no clock. */
export function isSuspended(s: Settings, now: number): boolean {
  if (s.storyFinished) return true;
  if (s.pausedUntil > now) return true;
  if (s.endDate && now >= Date.parse(`${s.endDate}T00:00:00`)) return true;
  return false;
}

/** The named presets set the how-it-looks fields. Anything else the user changed stays. */
export const PRESETS: Record<Exclude<Preset, 'custom'>, Partial<Settings>> = {
  casual: { strictness: 'light', blur: 'light', hideMode: 'blur', showReason: true, mediaNearGame: 'page', hideMediaPosts: false },
  careful: { strictness: 'medium', blur: 'medium', hideMode: 'blur', showReason: true, mediaNearGame: 'page', hideMediaPosts: true },
  blackout: { strictness: 'strict', blur: 'solid', hideMode: 'remove', showReason: false, mediaNearGame: 'post', hideMediaPosts: true },
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

const patternKey = (p: SitePattern) => `${p.kind}|${p.host}|${p.path.toLowerCase()}`;

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
    return p.kind === 'page' && p.host === v.host && p.path.toLowerCase() === v.path.toLowerCase();
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
