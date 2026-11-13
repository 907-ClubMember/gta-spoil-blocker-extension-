// Reaction GIFs from a library (giphy, tenor incl. Bluesky's t.gifs.bsky.app, klipy): find their addresses and read a label from them. Pure functions, no state.

function safe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const FILLER = new Set(['gif', 'gifs', 'giphy', 'tenor', 'klipy', 'image', 'embedded', 'video', 'animated', 'media', 'reaction', 'sticker', 'stickers', 'preview', 'downsized', 'original', 'still']);

/** The addresses in a srcset, read as the browser does: an address runs to the next space, so a comma inside it is part of it. */
function srcsetUrls(v: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < v.length) {
    while (i < v.length && /[\s,]/.test(v[i]!)) i++;
    let j = i;
    while (j < v.length && !/\s/.test(v[j]!)) j++;
    let url = v.slice(i, j);
    i = j;
    if (/,$/.test(url)) url = url.replace(/,+$/, '');
    else {
      // Descriptors ("2x", "300w") up to the next comma outside brackets.
      let depth = 0;
      for (; i < v.length; i++) {
        const c = v[i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === ',' && depth <= 0) break;
      }
    }
    if (url) out.push(url);
  }
  return out;
}

function attrUrls(e: Element, out: string[], current = true): void {
  for (const a of ['src', 'data-src', 'poster']) {
    const v = e.getAttribute(a);
    if (v) out.push(v);
  }
  for (const a of ['srcset', 'data-srcset']) {
    const v = e.getAttribute(a);
    if (v) out.push(...srcsetUrls(v));
  }
  const cur = current ? (e as HTMLImageElement).currentSrc : '';
  if (cur) out.push(cur);
}

function cssUrls(css: string | null | undefined, out: string[]): void {
  if (!css) return;
  for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) {
    const u = m[1] ?? m[2] ?? m[3];
    if (u) out.push(u);
  }
}

/** The addresses the media itself is loaded from: src, srcset, poster, its sources and background, not the link around it. */
function mediaUrls(el: Element, withStyle = true, current = true): string[] {
  const raw: string[] = [];
  attrUrls(el, raw, current);
  for (const s of el.querySelectorAll('source')) attrUrls(s, raw, current);
  const pic = el.closest('picture');
  if (pic) for (const s of pic.querySelectorAll('source')) attrUrls(s, raw, current);
  cssUrls(el.getAttribute('style'), raw);
  // Reading the laid-out style forces the page to recalculate styles: callers that only need the addresses in the markup skip it.
  if (withStyle) try {
    cssUrls(el.ownerDocument.defaultView?.getComputedStyle(el).backgroundImage, raw);
  } catch {
    // no computed style here
  }
  return raw;
}

/** All web addresses tied to an element (the media's and the link around it), decoded so that wrapped addresses can be read. */
export function libraryUrls(el: Element, withStyle = true, current = true): string[] {
  const raw = mediaUrls(el, withStyle, current);
  const href = el.closest('a')?.getAttribute('href');
  if (href) raw.push(href);
  const out: string[] = [];
  for (const u of raw) {
    const d = safe(u);
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

interface Addr {
  host: string;
  path: string;
}

const isGiphy = (h: string) => h === 'giphy.com' || h.endsWith('.giphy.com');
const isTenor = (h: string) => h === 'tenor.com' || h.endsWith('.tenor.com');
// Klipy: Discord's GIF picker (in place of Tenor), page links klipy.com/gifs/<slug>, media on its subdomains (static.klipy.com).
const isKlipy = (h: string) => h === 'klipy.com' || h.endsWith('.klipy.com');
const isLib = (h: string) => isGiphy(h) || isTenor(h) || isKlipy(h);
// Bluesky's picker (Tenor) serves the GIF from its own host with Tenor's path (B-043): read as media.tenor.com, but only as the
// media's own https address on exactly this host, never as a proxy target. Other bsky.app hosts (cdn.bsky.app) are uploads.
// t.gifs.bsky.app is believed to proxy Tenor only, no user uploads: UNVERIFIED, needs a read of a real Bluesky GIF.
const BSKY_TENOR = 't.gifs.bsky.app';
/*
 * GIF pickers per site (what the picker inserts; uploads stay ordinary pictures: Imgur, Discord attachments, X uploads, i.redd.it,
 * preview.redd.it, cdn.bsky.app, scontent fbcdn):
 * - Discord: Klipy (earlier Tenor), through images-ext-*.discordapp.net/external/. X: its own tweet_video (the `gifs` selector).
 * - Reddit: Giphy, as external-preview.redd.it inside a giphy.com link. Facebook: Giphy, direct or through external*.fbcdn.net ?url=.
 * - Threads: Giphy. Bluesky: Tenor via t.gifs.bsky.app. Instagram: Giphy (UNVERIFIED: whether the comment GIF is re-hosted on its CDN).
 * - Twitch, Kick: no GIF picker in chat (7TV/BTTV/FFZ are emotes). Steam, YouTube: no GIF picker known (UNVERIFIED), none added.
 * - Real Bluesky may set a poster on cdn.bsky.app: the every-address rule then keeps the GIF covered (fail-safe). B-043 needs a
 *   live structure read before it counts as done.
 */
// Image proxies whose target is read. Discord: /external/<hash>/[%3F<target query>/]https/<host>/<path> only (its attachments
// carry a url= that is not the picture). Facebook: ?url= on its external* hosts (emg1, safe_image), not on scontent uploads.
const isDiscordProxy = (h: string) => /^images-ext-\d+\.discordapp\.net$/.test(h) || h === 'media.discordapp.net';
const isFbProxy = (h: string) => /^external(?:-[a-z0-9]+)?\.(?:[a-z0-9-]+\.)*fbcdn\.net$/.test(h);

/**
 * The library address an address really loads from: its own host (parsed, so a user part like klipy.com@other is not the host),
 * or the target of a known image proxy, read once and with no page to resolve against. A library address anywhere else (another
 * site's query or path) does not count.
 */
function libAddr(u: string, base?: string, proxied = false): Addr | null {
  let url: URL;
  try { url = base === undefined ? new URL(u) : new URL(u, base); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (isLib(host)) return { host, path: safe(url.pathname) };
  if (proxied) return null;
  if (host === BSKY_TENOR) return url.protocol === 'https:' ? { host: 'media.tenor.com', path: safe(url.pathname) } : null;
  if (isDiscordProxy(host)) {
    // The target is the first http(s) part after the hash parts (one or more: /external/<h8>/<h43>/https/... as read live, or a
    // %3F query part): a library address further down its own path is not the target. A library path never holds another
    // http(s) part: one after the target makes the address unclear, so it is not read at all.
    const m = /^\/external\/(?:(?!https?\/)[^/]+\/)+?(https?)\/(.+)$/i.exec(url.pathname);
    return m && !/\/https?\//i.test(`/${m[2]}`) ? libAddr(`${m[1]}://${m[2]}`, undefined, true) : null;
  }
  const target = isFbProxy(host) ? url.searchParams.get('url') : null;
  return target ? libAddr(target, undefined, true) : null;
}

// A still picture on a library host (a preview frame) is a picture: with no slug, only an animated file or a video counts.
const ANIMATED = /\.(?:gif|gifv|webp|mp4|webm)$/i;

// Reddit shows a Giphy GIF from its picker as its own preview of the GIF's page, inside a link to that page: there (on Reddit
// only, any other site can put that preview in a link) the link names the library address. Animated is read from the preview's file.
const isRedditPreview = (h: string) => h === 'external-preview.redd.it';
const isReddit = (h: string) => h === 'reddit.com' || h.endsWith('.reddit.com');

type MediaAddr = Addr & { anim?: boolean };

/**
 * Library addresses of the media itself (anim: the media's own file is animated, when that is not the library address), or
 * null when any of its addresses is not one: a decoy src, poster, source or background, a data: or blob: placeholder.
 */
function mediaLibAddrs(el: Element, withStyle = true): MediaAddr[] | null {
  const base = el.ownerDocument.baseURI;
  // The page's own address, not its <base> (a page can name any site there).
  const page = (el.ownerDocument.location?.hostname ?? '').toLowerCase();
  const out: MediaAddr[] = [];
  const href = el.closest('a')?.getAttribute('href');
  for (const u of mediaUrls(el, withStyle)) {
    const a = libAddr(u, base);
    if (a) { out.push(a); continue; }
    let own: URL;
    try { own = new URL(u, base); } catch { return null; }
    const linked = href && isReddit(page) && isRedditPreview(own.hostname.toLowerCase()) ? libAddr(href, base, true) : null;
    if (!linked) return null;
    out.push({ ...linked, anim: ANIMATED.test(own.pathname) });
  }
  return out;
}

/**
 * A reaction GIF from a library: the site's own picker (siteSel), or media whose every address is Giphy, Tenor or Klipy (directly
 * or through Discord's or Facebook's image proxy) and that has a slug, is a video, or is an animated file. The link around it
 * decides nothing, except around Reddit's own preview picture on Reddit.
 */
export function isLibraryGif(el: Element, siteSel?: string, withStyle = true): boolean {
  if (siteSel) {
    try {
      // A site's own GIF (X's tweet_video) has no library address to vouch for it: it counts only with a label of its own (alt,
      // title, aria-label, caption) once filler like X's "Embedded video" or "GIF" is dropped. With none it is a video like any
      // other. Accepted risk: someone who writes an innocent label on a spoiler GIF on purpose gets it shown.
      if (el.closest(siteSel)) return libraryLabel(el) !== '';
    } catch {
      // bad selector
    }
  }
  const video = el.tagName === 'VIDEO';
  const addrs = mediaLibAddrs(el, withStyle);
  return !!addrs && addrs.some((a) => video || (a.anim ?? ANIMATED.test(a.path)) || slugsOf(a).length > 0);
}

/**
 * The library GIF a placeholder picture stands in for: a picture whose only address is a data: one, in the same box as the GIF
 * (Discord's hidden loading picture next to the video, read live): on Discord only, with Discord's placeholder class, and the
 * GIF the only other media in its box. null for anything else.
 */
export function placeholderFor(el: Element): Element | null {
  if (el.tagName !== 'IMG' || !onDiscord(el) || !el.matches('[class*="imagePlaceholder"]')) return null;
  const urls = mediaUrls(el, true, false);
  if (!urls.length || !urls.every((u) => /^data:/i.test(u.trim()))) return null;
  const others = [...(el.parentElement?.querySelectorAll('img, video') ?? [])].filter((m) => m !== el);
  return others.length === 1 && isLibraryGif(others[0]!, undefined, false) ? others[0]! : null;
}

function idLike(p: string): boolean {
  return /^[a-z0-9]+$/i.test(p) && p.length >= 8 && (/\d/.test(p) || (/[a-z]/.test(p) && /[A-Z]/.test(p)));
}

function segs(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function slugsOf(a: Addr): string[] {
  const s = segs(a.path);
  if (isGiphy(a.host) || a.host === 'klipy.com' || a.host === 'www.klipy.com') {
    const i = s.findIndex((x) => /^(gifs|stickers|clips)$/i.test(x));
    if (i < 0 || i === s.length - 1) return [];
    const parts = s[s.length - 1]!.replace(/\.\w+$/, '').split('-');
    if (idLike(parts[parts.length - 1]!)) parts.pop();
    return [parts.join('-')];
  }
  if (a.host === 'media.tenor.com') {
    const f = (s[s.length - 1] ?? '').replace(/\.\w+$/, '');
    return s.length > 1 && /[-_+]/.test(f) ? [f] : [];
  }
  if (isTenor(a.host)) {
    const i = s.indexOf('view');
    if (i < 0 || i === s.length - 1) return [];
    return [s[i + 1]!.replace(/-gif-\d+$/i, '').replace(/^\d+$/, '')];
  }
  return [];
}

function clean(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/\S+\.(?:gif|gifv|webp|mp4|webm|png|jpe?g)\b/g, ' ')
    .replace(/[-_+]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w) && !/^\d+w$/.test(w));
  return words.join(' ');
}

function ownCaption(el: Element): string {
  const fig = el.closest('figure');
  const cap = fig?.querySelector('figcaption');
  if (!fig || !cap) return '';
  if (fig.querySelectorAll('img, video').length > 1) return '';
  const rest = (fig.textContent ?? '').replace(cap.textContent ?? '', '').replace(/\s+/g, '');
  return rest ? '' : (cap.textContent ?? '');
}

/** Words that describe the GIF: alt/title text, caption, and the slug of its library address. '' when nothing real is left. */
export function libraryLabel(el: Element): string {
  const raw: string[] = [];
  const link = el.closest('a');
  for (const e of [el, link]) {
    if (!e) continue;
    for (const a of ['alt', 'title', 'aria-label']) {
      const v = e.getAttribute(a);
      if (v) raw.push(v);
    }
  }
  raw.push(ownCaption(el));
  // Slugs only from library media; then the link around it may add its slug (a GIF with no alt links to klipy.com/gifs/<slug>).
  const lib = isLibraryGif(el);
  if (lib) {
    for (const a of mediaLibAddrs(el) ?? []) raw.push(...slugsOf(a));
    const href = link?.getAttribute('href');
    const a = href ? libAddr(href, el.ownerDocument.baseURI) : null;
    if (a) raw.push(...slugsOf(a));
  }
  // On Discord the message's own Klipy/Tenor/Giphy link adds its slug: more words can only make a clean label name the game.
  return joinClean(lib ? [...raw, ...discordMessageSlugs(el)] : raw);
}

function joinClean(raw: string[]): string {
  const out: string[] = [];
  for (const r of raw) {
    const c = clean(r);
    if (c && !out.includes(c)) out.push(c);
  }
  return out.join(' ');
}

// On Discord the picker sends the GIF's page link as the message and shows the media as an embed with no link around it and a
// generic aria-label (read live): the slug of that page link names it. The message's own links only (not its reply preview, not
// another message), directly on a library host.
const DISCORD_MESSAGE = 'li[id^="chat-messages-"], [class*="messageListItem"]';

function onDiscord(el: Element): boolean {
  const page = (el.ownerDocument.location?.hostname ?? '').toLowerCase();
  return page === 'discord.com' || page.endsWith('.discord.com');
}

/** The Discord message an element is in; null off Discord or outside a message. */
export function discordMessageOf(el: Element): Element | null {
  return onDiscord(el) ? el.closest(DISCORD_MESSAGE) : null;
}

function discordMessageSlugs(el: Element): string[] {
  const msg = discordMessageOf(el);
  if (!msg) return [];
  const out: string[] = [];
  for (const a of msg.querySelectorAll('a[href]')) {
    if (a.closest(DISCORD_MESSAGE) !== msg || a.closest('[class*="repliedMessage"]')) continue;
    const addr = libAddr(a.getAttribute('href')!, el.ownerDocument.baseURI, true);
    if (addr) out.push(...slugsOf(addr));
  }
  return out;
}
