/**
 * Official sources whose trailers are let through when trailers are allowed (Settings.allowTrailers): the game's maker and the
 * major outlets that publish its trailers. Matched by the exact channel or account address (handle or channel id), never by the
 * name shown, which anyone can copy. The one exception is a card with no address at all (YouTube's up-next cards): it goes by the
 * whole name plus the verified badge in the same row (see OFFICIAL_NAMES). A fixed list in the extension: nothing is fetched.
 */
export const OFFICIAL_HANDLES: Record<string, readonly string[]> = {
  'youtube.com': ['rockstargames', 'ign', 'gamespot', 'playstation', 'xbox', 'thegameawards'],
  'x.com': ['rockstargames', 'ign', 'gamespot', 'playstation', 'xbox', 'thegameawards'],
  'twitter.com': ['rockstargames', 'ign', 'gamespot', 'playstation', 'xbox', 'thegameawards'],
};

/** The maker's own site: its media are its own trailers and art. Only these hosts: other sites under it hold players' own pictures. */
export const OFFICIAL_SITES: readonly string[] = ['rockstargames.com', 'www.rockstargames.com'];

/** Whether `host` (or a site under it) is one with official accounts at all. */
export function hasOfficialHandles(host: string): boolean {
  return Object.keys(OFFICIAL_HANDLES).some((h) => host === h || host.endsWith(`.${h}`));
}

/** Trailer words in a title or post: only such official media are let through. */
export const TRAILER_WORDS = /\b(?:trailer|teaser|reveal)s?\b/i;

/** The handle an address names ("/@RockstarGames", "/RockstarGames", "https://x.com/IGN/status/1"): lower case, no "@". */
export function handleOf(href: string): string | null {
  let path: string;
  try {
    path = new URL(href, 'https://h.invalid/').pathname;
  } catch {
    return null;
  }
  const first = path.split('/')[1] ?? '';
  return first ? first.replace(/^@/, '').toLowerCase() : null;
}

/** Whether `host` (or a site under it) has `handle` as an official account. Exact match only. */
export function isOfficialHandle(host: string, handle: string | null): boolean {
  if (!handle) return false;
  for (const [h, list] of Object.entries(OFFICIAL_HANDLES)) if ((host === h || host.endsWith(`.${h}`)) && list.includes(handle)) return true;
  return false;
}

/**
 * The official channels' display names, for the cards that name their channel in text only (YouTube's up-next cards carry no
 * channel address). Lower case; a card matches only on the whole name, and only with the verified badge in the same row.
 */
export const OFFICIAL_NAMES: readonly string[] = ['rockstar games', 'ign', 'gamespot', 'playstation', 'xbox', 'the game awards'];

/** The same channels' ids, each read from the channel's own page (canonical link and feed agreeing), for any /channel/ link. */
export const OFFICIAL_CHANNEL_IDS: ReadonlySet<string> = new Set([
  'UC6VcWc1rAoWdBCM0JxrRQ3A', // rockstargames
  'UCKy1dAqELo0zrOtPkf0eTMw', // ign
  'UCbu2SsF-Or3Rsn3NxqODImw', // gamespot
  'UC-2Y8dQb0S6DtpxNgAKoJKA', // playstation
  'UCjBp_7RuDBUYbd1LegWEJ8g', // xbox
  'UCqDS7KWjAPKv-7ZSlro9OiQ', // thegameawards
]);

/** Whether `host` is YouTube. */
export function isYouTube(host: string): boolean {
  return host === 'youtube.com' || host.endsWith('.youtube.com');
}

/** An exact, whole-name, case-insensitive match (spaces collapsed): "IGN Fan Clips" and "Rockstar Games Fans" are not official. */
export function isOfficialName(name: string): boolean {
  // Plain spaces only: a no-break or zero-width space, or any other odd character, is not the official name (fail closed).
  return OFFICIAL_NAMES.includes(name.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '').replace(/[ \t\r\n]+/g, ' ').toLowerCase());
}

/** Whether an address is a /channel/<id> link to one of the official channels (on YouTube only). */
export function isOfficialChannelLink(host: string, href: string): boolean {
  if (!isYouTube(host)) return false;
  let path: string;
  try {
    const u = new URL(href, 'https://www.youtube.com/');
    if (!isYouTube(u.hostname)) return false;
    path = u.pathname;
  } catch {
    return false;
  }
  const m = /^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/.exec(path);
  return !!m && OFFICIAL_CHANNEL_IDS.has(m[1]!);
}

/**
 * The big official stores and the publisher's own site (Settings.allowStores): their game and store pages are shown, and so are the search
 * results and social cards that link to them. Exact host or a subdomain only ("rockstargames.com.evil.tld" and "rockstargames-leaks.com"
 * are neither). Steam is not here: its store pages carry user reviews (its search results are: SEARCH_STORE_HOSTS). A fixed list: nothing user-submitted, nothing fetched.
 */
export const OFFICIAL_STORE_HOSTS: readonly string[] = ['rockstargames.com', 'store.playstation.com', 'playstation.com', 'xbox.com'];

/** The publisher's own accounts, per site: its posts are shown (Settings.allowStores). Matched by the address, never by the name shown. */
export const PUBLISHER_ACCOUNTS: Record<string, readonly string[]> = {
  'instagram.com': ['rockstargames'],
  'x.com': ['rockstargames'],
  'twitter.com': ['rockstargames'],
  'facebook.com': ['rockstargames'],
};

/** Whether `host` is an official store host or a subdomain of one. */
export function isOfficialStoreHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return OFFICIAL_STORE_HOSTS.some((o) => h === o || h.endsWith(`.${o}`));
}

/** Hosts whose first label says people write there: Social Club, forums, the support community. */
const USER_LABEL = /^(?:socialclub|forums?|community|communities|support|help|answers|discussions?|boards?|ugc|media|clips|captures|screenshots)$/i;
/** Paths that list achievements or trophies, or hold what people write or share: stats, feeds, crews, comments, profiles, reviews, captures, forums. */
const USER_PATH = /achievement|trophi|\/stats(?:\/|$)|\/feed(?:\/|$)|\/crews?(?:\/|$)|comment|\/community|\/forums?(?:\/|$)|\/curators?(?:\/|$)|\/profiles?(?:\/|$)|\/members?(?:\/|$)|\/reviews?(?:\/|$)|\/players?(?:\/|$)|\/play\/(?:media|user)|\/(?:media|captures?|clips?|screenshots?|ugc|questions?|user|ratings?)(?:\/|$)/i;

/** A game or store page of an official host: not an achievements or trophies page, not a place where people write. */
export function isStorePage(host: string, pathname: string): boolean {
  // Any label of the host: a place where people write is not a store page, however deep in the name it sits.
  if (!isOfficialStoreHost(host) || host.toLowerCase().split('.').some((l) => USER_LABEL.test(l))) return false;
  let path = pathname;
  try { path = decodeURIComponent(pathname); } catch { /* keep the raw path */ }
  return !USER_PATH.test(path);
}

// Google search in every country, from Google's own list (google.com/supported_domains): google.co.uk and the
// rest got no rule before. All shorter than mail.google.com, so Gmail keeps its own rule.
export const GOOGLE_HOSTS = 'com ad ae com.af com.ag al am co.ao com.ar as at com.au az ba com.bd be bf bg com.bh bi bj com.bn com.bo com.br bs bt co.bw by com.bz ca cd cf cg ch ci co.ck cl cm cn com.co co.cr com.cu cv com.cy cz de dj dk dm com.do dz com.ec ee com.eg es com.et fi com.fj fm fr ga ge gg com.gh com.gi gl gm gr com.gt gy com.hk hn hr ht hu co.id ie co.il im co.in iq is it je com.jm jo co.jp co.ke com.kh ki kg co.kr com.kw kz la com.lb li lk co.ls lt lu lv com.ly co.ma md me mg mk ml com.mm mn com.mt mu mv mw com.mx com.my co.mz com.na com.ng com.ni ne nl no com.np nr nu co.nz com.om com.pa com.pe com.pg com.ph com.pk pl pn com.pr ps pt com.py com.qa ro ru rw com.sa com.sb sc se com.sg sh si sk com.sl sn so sm sr st com.sv td tg co.th com.tj tl tm tn to com.tr tt com.tw co.tz com.ua co.ug co.uk com.uy co.uz com.vc co.ve co.vi com.vn vu ws rs co.za co.zm co.zw cat'.split(' ').map((t) => `google.${t}`);

/** Google, Bing or DuckDuckGo, by the exact host (bare or www. Google in each country, bing.com, duckduckgo.com and its HTML version). */
export function searchEngine(host: string): 'google' | 'bing' | 'duckduckgo' | null {
  const h = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (GOOGLE_HOSTS.includes(h)) return 'google';
  if (h === 'bing.com') return 'bing';
  if (h === 'duckduckgo.com' || h === 'html.duckduckgo.com') return 'duckduckgo';
  return null;
}

/** A results page of a search engine: Google's and Bing's /search, DuckDuckGo's / or /html, each with a query. */
export function isResultsPage(host: string, pathname: string, search: string): boolean {
  const e = searchEngine(host);
  if (!e || !new URLSearchParams(search).get('q')) return false;
  return e === 'duckduckgo' ? /^\/(?:html\/?)?$/.test(pathname) : pathname === '/search';
}

/** An engine's own tool for a result, not another page: a translation (Google's translate.goog proxy too) or a cached copy. */
export function isEngineTool(u: URL): boolean {
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  return GOOGLE_HOSTS.some((g) => h === `translate.${g}`) || h.endsWith('.translate.goog') || h === 'webcache.googleusercontent.com' || h === 'cc.bingj.com';
}

/** Bing's result redirect ("/ck/a?...&u=a1<base64url of the address>"): the address, or null when it is not that form. */
function bingTarget(v: string | null): string | null {
  if (!v || !v.startsWith('a1')) return null;
  try { return atob(v.slice(2).replace(/-/g, '+').replace(/_/g, '/')); } catch { return null; }
}

/** The target of a search engine's own redirect link (Google's "/url?q=", Bing's "/ck/a", DuckDuckGo's "uddg"), or the address itself. Exact engine hosts only. */
export function unwrap(u: URL): URL {
  const e = searchEngine(u.hostname);
  const t = e === 'duckduckgo' ? u.searchParams.get('uddg') : e === 'google' && u.pathname === '/url' ? u.searchParams.get('q') : e === 'bing' && u.pathname === '/ck/a' ? bingTarget(u.searchParams.get('u')) : null;
  if (t) {
    try { return new URL(t); } catch { /* not an address */ }
  }
  return u;
}

/** Whether an address (absolute, or relative to `base`) is a store page of an official host. Only http and https. */
export function isStoreLink(href: string, base = 'https://h.invalid/'): boolean {
  let u: URL;
  try { u = unwrap(new URL(href, base)); } catch { return false; }
  return (u.protocol === 'https:' || u.protocol === 'http:') && isStorePage(u.hostname, u.pathname);
}

/**
 * The big PC stores, for search results only: a result's title and snippet are the store's own text. Exact hosts, no subdomains. Not their
 * pages or link cards: user reviews sit on the store page itself.
 */
export const SEARCH_STORE_HOSTS: readonly string[] = ['store.steampowered.com', 'store.epicgames.com'];
/** A game's page on those stores: Steam /app/<id>[/<name>], Epic [/<locale>]/p/<slug>. */
const PC_GAME_PAGE = /^\/(?:app\/\d+(?:\/[^/]*)?\/?|(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?p\/[^/]+\/?)$/i;

/** Whether a search result's address goes to a store page of an official host, or to a game page of a big PC store. Only http and https. */
export function isSearchStoreLink(href: string, base = 'https://h.invalid/'): boolean {
  let u: URL;
  try { u = unwrap(new URL(href, base)); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (isStorePage(u.hostname, u.pathname)) return true;
  if (!SEARCH_STORE_HOSTS.includes(u.hostname.toLowerCase().replace(/\.$/, ''))) return false;
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
  // A game page only (Steam /app/<id>, Epic /p/<slug>): not a curator's list, a search, news or a developer page.
  return PC_GAME_PAGE.test(path) && !USER_PATH.test(path);
}

/** Whether `handle` is the publisher's own account on `host` (or a site under it). */
export function isPublisherHandle(host: string, handle: string | null): boolean {
  if (!handle) return false;
  for (const [h, list] of Object.entries(PUBLISHER_ACCOUNTS)) if ((host === h || host.endsWith(`.${h}`)) && list.includes(handle)) return true;
  return false;
}

/** Whether `host` is a site with a publisher account at all. */
export function hasPublisherAccounts(host: string): boolean {
  return Object.keys(PUBLISHER_ACCOUNTS).some((h) => host === h || host.endsWith(`.${h}`));
}
