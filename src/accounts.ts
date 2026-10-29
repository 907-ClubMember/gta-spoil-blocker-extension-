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

// Read 2026-10-28 from the channel's own page (read-only): its id, its handle, and the one other account its
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

/** Every account key to hide, from the built-in list (when it is on) and the person's own additions. */
export function accountKeys(s: { spoilerAccounts: boolean; blockedAccounts: string[] }): Set<string> {
  const keys = new Set<string>(s.spoilerAccounts ? SPOILER_ACCOUNTS.flatMap((a) => a.keys) : []);
  for (const v of s.blockedAccounts) {
    const k = parseAccount(v);
    if (k) keys.add(k);
  }
  return keys;
}

/** Words that name a built-in account, hidden like one of the person's own words while the list is on. */
export function accountWords(s: { spoilerAccounts: boolean }): string[] {
  return s.spoilerAccounts ? SPOILER_ACCOUNTS.flatMap((a) => a.words) : [];
}

/** Quick check before parsing: only links to these sites can be account pages. */
export const ACCOUNT_HOST = /\b(youtube\.com|twitter\.com|x\.com|reddit\.com|tiktok\.com|instagram\.com|twitch\.tv|kick\.com)(:\d+)?\//i;
