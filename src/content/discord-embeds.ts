import { isSearchStoreLink, unwrap } from '../adapters/official';

/**
 * Discord's link previews (embeds), forwarded messages and attachments. Class names end in a suffix that changes per release, hence
 * the stems. An embed is an <article class="embedWrapper_… embedFull_…">; everything a message carries below its words sits in
 * #message-accessories-<id>.
 */
export const EMBED = 'article[class*="embed"], [class*="embedWrapper"], [class*="forwardBlock"], [class*="messageSnapshot"]';
export const ACCESSORIES = `[id^="message-accessories-"], ${EMBED}, [class*="messageAttachment"], [class*="mosaicItem"], [class*="visualMediaItem"]`;

/** The outermost embed blocks inside a message. */
export function embedsIn(msg: Element): Element[] {
  return [...msg.querySelectorAll(EMBED)].filter((e) => !e.parentElement?.closest(EMBED) || !msg.contains(e.parentElement.closest(EMBED)));
}

export type Source = 'x' | 'youtube' | 'reddit' | 'bluesky' | 'instagram' | 'tiktok' | 'other';

const SOURCES: [Source, RegExp][] = [
  ['x', /(?:^|\.)(?:fixupx|fxtwitter|vxtwitter|fixvx|twitter|x)\.com$/],
  ['youtube', /(?:^|\.)(?:youtube\.com|youtu\.be)$/],
  ['reddit', /(?:^|\.)(?:reddit\.com|redd\.it|rxddit\.com)$/],
  ['bluesky', /(?:^|\.)(?:bsky\.app|bsky\.social|fxbsky\.app|bskyx\.app)$/],
  ['instagram', /(?:^|\.)(?:instagram\.com|ddinstagram\.com)$/],
  ['tiktok', /(?:^|\.)tiktok\.com$/],
];

/** The canonical host of a source, for the site rule (adapterFor). */
export const SOURCE_HOST: Record<Source, string> = { x: 'x.com', youtube: 'www.youtube.com', reddit: 'www.reddit.com', bluesky: 'bsky.app', instagram: 'www.instagram.com', tiktok: 'www.tiktok.com', other: '' };

const hrefs = (el: Element) => [...el.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '');

export const hostOf = (href: string) => {
  try { return unwrap(new URL(href, 'https://h.invalid/')).hostname.toLowerCase(); } catch { return ''; }
};

/** Which site an embed shows, from its own links (the title link first, then the provider and author links). */
export function embedSource(embed: Element): Source {
  const order = ['[class*="embedTitle"] a[href]', '[class*="embedProvider"] a[href]', '[class*="embedAuthor"] a[href]', 'a[href]'];
  for (const sel of order) {
    for (const a of embed.querySelectorAll(sel)) {
      const h = hostOf(a.getAttribute('href') ?? '');
      const hit = SOURCES.find(([, re]) => re.test(h));
      if (hit) return hit[0];
    }
  }
  return 'other';
}

/** A link preview proper (never a forwarded message, whose uploads are people's own). */
export const LINK_PREVIEW = 'article[class*="embed"]';

const sameUrl = (a: string) => {
  try { const u = unwrap(new URL(a, 'https://h.invalid/')); return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`; } catch { return a; }
};

/**
 * A link preview Discord made from a link in the message (a real unfurl) whose links all go to an official publisher or store page (exact
 * hosts, as in search results). Bots and webhooks write their own embeds with any title link: one whose address is not also a link in the
 * message's own words is never official.
 */
export function isOfficialEmbed(embed: Element, msg: Element): boolean {
  if (!embed.matches(LINK_PREVIEW)) return false;
  const links = hrefs(embed).filter((h) => /^https?:/i.test(h));
  const main = embed.querySelector('[class*="embedTitle"] a[href]')?.getAttribute('href') ?? links[0];
  // The embed's own address is a store or game page; its other links (provider, author) stay on that same host.
  if (!main || !isSearchStoreLink(main) || !links.every((h) => hostOf(h) === hostOf(main))) return false;
  const want = sameUrl(main);
  return [...msg.querySelectorAll('a[href]')].some((a) => !a.closest(LINK_PREVIEW) && sameUrl(a.getAttribute('href') ?? '') === want);
}

/** A cheap hash of a text (FNV-1a), to tell a changed text from an unchanged one. */
export function textHash(t: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The embed's whole text, far past a message's reading cap: a long preview is read to its end. */
export function embedText(embed: Element, cap = 20000): string {
  let out = '';
  const walker = embed.ownerDocument.createTreeWalker(embed, 4 /* SHOW_TEXT */);
  for (let n = walker.nextNode(); n && out.length < cap; n = walker.nextNode()) {
    const p = n.parentElement;
    if (p && !p.closest('.gsb-bar, style, script')) out += ` ${n.nodeValue ?? ''}`;
  }
  return out;
}

/** The author line of an embed (a display name and handle on X, a channel on YouTube). */
export const EMBED_AUTHOR = '[class*="embedAuthor"]';
