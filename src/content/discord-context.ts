/**
 * A Discord channel's own words: the server, channel, topic and the category the open channel sits under. Read by structure and ARIA with
 * fallbacks, and from the tab title in both shapes ("Discord | #channel | Server", "#channel | Server - Discord"). The live markup was
 * read from a screenshot only: no single place is trusted alone, each one found adds its words.
 */
export interface ChatPlace {
  server: string[];
  /** Channel, topic and category words. */
  channel: string[];
}

const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function first(doc: Document, sels: string[]): Element | null {
  for (const s of sels) {
    try {
      const el = doc.querySelector(s);
      if (el && txt(el)) return el;
    } catch { /* a selector the browser does not know */ }
  }
  return null;
}

/** The open channel's id from /channels/<server>/<channel>. */
export function channelIdOf(path: string): string | null {
  return /^\/channels\/[^/]+\/(\d+)/.exec(path)?.[1] ?? null;
}

/** The category header above the open channel in the sidebar list (a collapsible row with aria-expanded), or its group's label. */
function categoryOf(doc: Document, path: string): string {
  const id = channelIdOf(path);
  let ch: Element | null = null;
  try {
    ch = (id && doc.querySelector(`[data-list-item-id="channels___${id}"]`))
      || doc.querySelector('[data-list-item-id^="channels___"][aria-selected="true"], [data-list-item-id^="channels___"][aria-current="page"], a[aria-current="page"][data-list-item-id^="channels___"]')
      || doc.querySelector('[data-list-item-id^="channels___"][class*="selected"], [class*="modeSelected"] [data-list-item-id^="channels___"]');
  } catch { ch = null; }
  if (!ch) return '';
  const group = ch.closest('[role="group"][aria-label]');
  if (group) return group.getAttribute('aria-label') ?? '';
  // Discord's channel list is flat: the category is the nearest row before the channel's that opens and closes (aria-expanded).
  let row: Element | null = ch.closest('li') ?? ch;
  while (row && row.parentElement && !row.previousElementSibling) row = row.parentElement;
  for (let r = row?.previousElementSibling ?? null, n = 0; r && n < 200; r = r.previousElementSibling, n++) {
    const head = r.matches('[aria-expanded]') ? r : r.querySelector('[aria-expanded]');
    if (head) return txt(head);
  }
  return '';
}

/** Server and channel from the tab title, in either shape. */
export function titleParts(title: string): { server: string; channel: string } | null {
  const t = title.replace(/^\(\d+\)\s*/, '').trim();
  let m = /^Discord \| #?([^|]+?) \| (.+)$/.exec(t);
  if (m) return { channel: m[1]!, server: m[2]! };
  m = /^#?([^|]+?) \| (.+?) - Discord$/.exec(t);
  if (m) return { channel: m[1]!, server: m[2]! };
  return null;
}

export function readChatPlace(doc: Document, path: string): ChatPlace {
  const server: string[] = [];
  const channel: string[] = [];
  // The sidebar's server header (its nav says "<server> (server)"), the top title bar, and the header's own heading.
  const nav = doc.querySelector('nav[aria-label$="(server)"]');
  if (nav) server.push((nav.getAttribute('aria-label') ?? '').replace(/\s*\(server\)\s*$/, ''));
  const head = first(doc, ['nav[aria-label$="(server)"] header h2', 'nav header h2', '[class*="guildHeader"] h2', '[class*="sidebar"] header [class*="name"]', '[class*="titleBar"] [class*="title"]', '[data-gsb-server]']);
  if (head) server.push(txt(head));
  // The channel header: its name and its topic.
  const ch = first(doc, ['section[aria-label="Channel header"] h1', 'section[aria-label="Channel header"] h2', 'section[aria-label="Channel header"] h3', '[class*="chatHeader"] h1', '[class*="chatHeader"] h2', '[class*="chatHeader"] h3', '[class*="channelHeader"] h1', '[class*="channelHeader"] h2', '[class*="channelHeader"] h3', 'main header h1', 'main header h2', 'main header h3']);
  if (ch) channel.push(txt(ch));
  const topic = first(doc, ['section[aria-label="Channel header"] [class*="topic"]', '[class*="chatHeader"] [class*="topic"]', '[class*="channelHeader"] [class*="topic"]', 'main header [class*="topic"]']);
  if (topic) channel.push(txt(topic));
  const cat = categoryOf(doc, path);
  if (cat) channel.push(cat);
  const t = titleParts(doc.title ?? '');
  if (t) { server.push(t.server); channel.push(t.channel); }
  return { server: server.filter(Boolean), channel: channel.filter(Boolean) };
}

/** Channel names are written as tokens ("zzg-9-chat"): read as words. */
export const asWords = (s: string) => s.replace(/[-_#·|]+/g, ' ').replace(/(\p{L})(\p{N})/gu, '$1 $2');

/** "GTA", "GTA6", "GTA 6", "GTA-6", "GTAVI" in a server name. */
export const GTA = /\bgta(?:\s*-?\s*(?:6|vi))?\b/i;

/** Is this a game place: the server names the game (plain "GTA" counts there), or the channel, topic or category does. */
export function isGamePlace(p: ChatPlace, names: (text: string) => boolean): boolean {
  if (p.server.some((s) => GTA.test(s) || names(asWords(s)))) return true;
  return p.channel.some((c) => names(asWords(c)));
}
