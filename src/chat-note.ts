import { ADAPTERS, adapterFor } from './adapters';
import { TEXT } from './text';

/** The chat's name as shown: "Discord", "Twitch chat", "YouTube live chat". */
function chatName(name: string): string {
  return name === 'Discord' || /chat/i.test(name) ? name : `${name} chat`;
}

/** The popup's line for a fast chat (each message checked strictly, no hiding after a mention); '' anywhere else. */
export function chatNote(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return '';
  }
  if (!/^https?:$/.test(u.protocol)) return '';
  const site = adapterFor(u.hostname.replace(/^www\./, ''), u.pathname);
  return site?.chatLines ? TEXT.chatStrict(chatName(site.name)) : '';
}

/** The Current settings panel's line: every chat it applies to. */
export function chatNoteAll(): string {
  const names = ADAPTERS.filter((a) => a.chatLines).map((a) => a.name);
  return TEXT.chatStrictAll(names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '');
}
