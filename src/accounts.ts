/**
 * Spoiler accounts: everything an account posts is hidden on every site, whatever its words say, and so is
 * anything that links to the account or names it. An account is matched by the address of its own page
 * (a YouTube channel id or @handle, an X handle...), read from the links inside each post, never by the
 * display name alone: names are copied by fan channels and re-uploads.
 *
 * Keys are the account's own address in one spelling: `youtube.com/@handle`, `youtube.com/channel/UC…`,
 * `x.com/handle`, `reddit.com/user/name`, `tiktok.com/@name`, `instagram.com/name`, `twitch.tv/name`,
 * `kick.com/name`. Handles are lower case; a YouTube channel id keeps its case (ids are case-sensitive).
 */
export interface SpoilerAccount {
  name: string;
  /** The account's own pages. */
  keys: string[];
  /** Words that name the account in text: a post saying them is hidden like one of your own words. */
  words: string[];
}

// Read from the channel's own page: its id, its handle, and the one other account its
// description links to ("Follow me on Twitter"). Accounts the channel does not link itself are not guessed.
export const SPOILER_ACCOUNTS: readonly SpoilerAccount[] = [
  {
    name: 'Shirrako',
    keys: ['youtube.com/channel/UC7eAfUjR9gdIjoaoQaS0W-A', 'youtube.com/@shirrako', 'x.com/shirrakogaming'],
    words: ['Shirrako', 'shirrakogaming'],
  },
];

const HOSTS: Record<string, string> = {
  'youtube.com': 'youtube.com', 'm.youtube.com': 'youtube.com', 'www.youtube.com': 'youtube.com', 'music.youtube.com': 'youtube.com',
  'x.com': 'x.com', 'twitter.com': 'x.com', 'mobile.twitter.com': 'x.com', 'mobile.x.com': 'x.com',
  'reddit.com': 'reddit.com', 'old.reddit.com': 'reddit.com', 'new.reddit.com': 'reddit.com', 'sh.reddit.com': 'reddit.com',
  'tiktok.com': 'tiktok.com', 'instagram.com': 'instagram.com', 'twitch.tv': 'twitch.tv', 'm.twitch.tv': 'twitch.tv', 'kick.com': 'kick.com',
};
/** First path parts that are site pages, not accounts. */
const NOT_ACCOUNTS: Record<string, ReadonlySet<string>> = {
  'x.com': new Set(['home', 'search', 'explore', 'i', 'settings', 'hashtag', 'intent', 'share', 'messages', 'notifications', 'compose', 'tos', 'privacy', 'login', 'signup']),
  'instagram.com': new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'direct', 'tv', 'about', 'legal']),
  'twitch.tv': new Set(['directory', 'videos', 'search', 'settings', 'subscriptions', 'inventory', 'downloads', 'jobs', 'p']),
  'kick.com': new Set(['browse', 'categories', 'category', 'search', 'following', 'dashboard', 'video', 'clips']),
};
const HANDLE = /^[a-z0-9][a-z0-9._-]{0,49}$/i;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/** The account a link points to, as a key, or null when it is not an account page. */
export function accountKey(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const site = HOSTS[u.hostname.toLowerCase().replace(/^www\./, '')];
  if (!site) return null;
  // A broken %-escape stays as written: one odd link must never stop a page from being checked.
  const decode = (p: string) => { try { return decodeURIComponent(p); } catch { return p; } };
  const [a = '', b = ''] = u.pathname.split('/').filter(Boolean).map(decode);
  const handle = (h: string) => (HANDLE.test(h) ? h.toLowerCase() : null);
  switch (site) {
    case 'youtube.com': {
      if (a.startsWith('@')) return handle(a.slice(1)) && `youtube.com/@${handle(a.slice(1))}`;
      if (a === 'channel' && CHANNEL_ID.test(b)) return `youtube.com/channel/${b}`;
      return null;
    }
    case 'reddit.com':
      return (a === 'user' || a === 'u') && handle(b) ? `reddit.com/user/${handle(b)}` : null;
    case 'tiktok.com':
      return a.startsWith('@') && handle(a.slice(1)) ? `tiktok.com/@${handle(a.slice(1))}` : null;
    default: {
      if (!a || NOT_ACCOUNTS[site]?.has(a.toLowerCase())) return null;
      const h = handle(a.replace(/^@/, ''));
      return h ? `${site}/${h}` : null;
    }
  }
}

/**
 * What a person typed into "add an account": a link to the account's page, or a bare @handle (read as a
 * YouTube handle, where the @ spelling comes from). Null when it is neither.
 */
export function parseAccount(input: string): string | null {
  const v = input.trim();
  if (/^@[a-z0-9][a-z0-9._-]{0,49}$/i.test(v)) return `youtube.com/${v.toLowerCase()}`;
  return accountKey(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v.replace(/^\/+/, '')}`);
}

/** The site a host belongs to, as account keys spell it ("www.youtube.com" -> "youtube.com"), or null for other sites. */
export function siteOf(host: string): string | null {
  return HOSTS[host.toLowerCase().replace(/^www\./, '')] ?? null;
}

/**
 * Every account key to hide: the built-in list (when it is on) less the accounts never to hide, then the person's own
 * additions. Those win over never hide: taking one off "my accounts to hide" is how to show it again.
 */
export function accountKeys(s: { spoilerAccounts: boolean; blockedAccounts: string[]; allowAccounts?: string[] }): Set<string> {
  const allowed = allowedAccounts(s);
  const keys = new Set<string>(s.spoilerAccounts ? SPOILER_ACCOUNTS.flatMap((a) => a.keys).filter((k) => !allowed.has(k)) : []);
  for (const v of s.blockedAccounts) {
    const k = parseAccount(v);
    if (k) keys.add(k);
  }
  return keys;
}

/**
 * Words that name a built-in account, hidden like one of the person's own words while the list is on. On a site where the
 * account is allowed its name is left out (it sits beside every one of its posts there); other sites still hide it.
 */
export function accountWords(s: { spoilerAccounts: boolean; allowAccounts?: string[] }, host = ''): string[] {
  if (!s.spoilerAccounts) return [];
  const allowed = allowedAccounts(s);
  const site = siteOf(host);
  return SPOILER_ACCOUNTS.filter((a) => !(site && a.keys.some((k) => keySite(k) === site && allowed.has(k)))).flatMap((a) => a.words);
}

const keySite = (key: string) => key.split('/')[0]!;

/** The accounts never to hide, as keys. A built-in account allowed on a site is allowed by all its pages there (handle and channel id). */
function allowedAccounts(s: { allowAccounts?: string[] }): Set<string> {
  const allowed = new Set((s.allowAccounts ?? []).map((v) => parseAccount(v)).filter((k): k is string => !!k));
  for (const a of SPOILER_ACCOUNTS) {
    const sites = new Set(a.keys.filter((k) => allowed.has(k)).map(keySite));
    for (const k of a.keys) if (sites.has(keySite(k))) allowed.add(k);
  }
  return allowed;
}

/**
 * Links that can be an account's page, as Chrome menu patterns: the right-click "Never hide" item for accounts shows only on
 * these. Loose on purpose (x.com/home matches); the click itself checks the link with `accountKey`.
 */
export const ACCOUNT_LINK_PATTERNS: readonly string[] = [
  '*://*.youtube.com/@*', '*://*.youtube.com/channel/*',
  '*://*.x.com/*', '*://*.twitter.com/*',
  '*://*.reddit.com/user/*', '*://*.reddit.com/u/*',
  '*://*.tiktok.com/@*', '*://*.instagram.com/*', '*://*.twitch.tv/*', '*://*.kick.com/*',
];

/** Quick check before parsing: only links to these sites can be account pages. */
export const ACCOUNT_HOST = /\b(youtube\.com|twitter\.com|x\.com|reddit\.com|tiktok\.com|instagram\.com|twitch\.tv|kick\.com)(:\d+)?\//i;
