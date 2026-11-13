// Public issue intake: plain functions, no model. A form is turned into a record of fixed values; free text is scanned and then
// thrown away. Every decision keeps the report (nothing is deleted or closed): a held issue or comment goes to the private
// quarantine repo, where the tower turns held issues into records. Results never contain a word of the input.
import { FORMS, FORM_TITLES, FREE_TEXT_LABEL, TICKS, type FormKind } from './forms';
import { namesSpoiler } from './names';
import type { Term } from '../../src/types';

export { FORMS };

/** The neutral note a reporter sees when a report is held. It says nothing about why. */
export const NOTICE_RECEIVED = 'Received. It is being checked automatically and will be handled from there.';

/** Accounts younger than this many days, and anyone on a first report, have their free text held. */
export const YOUNG_DAYS = 7;

export interface Author { ageDays: number; priorIssues: number; priorComments: number; association: string }
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
export const isTrusted = (association: string): boolean => TRUSTED.has(association);

// ---- links ----

const HOSTS = new Set(['reddit.com', 'youtube.com', 'youtu.be', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'tiktok.com',
  'twitch.tv', 'kick.com', 'discord.com', 'store.steampowered.com', 'steamcommunity.com', 'google.com', 'bsky.app']);

/** An https link on a supported site, reduced to the host and an id. Anything else is null. */
export function canonicalLink(raw: string): { host: string; id: string } | null {
  let u: URL;
  if (/\s/.test(raw.trim())) return null; // a link is one token: spaces and lines would be words
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (/^[\d.]+$/.test(u.hostname) || u.hostname.includes(':') || u.hostname.startsWith('[') || u.hostname === 'localhost') return null;
  const host = u.hostname.replace(/^(www|m|old|np|mobile)\./, '');
  if (!HOSTS.has(host)) return null;
  const path = u.pathname;
  const id = (host === 'reddit.com' && path.match(/\/comments\/([a-z0-9]{1,12})/i)?.[1])
    || (host === 'youtube.com' && u.searchParams.get('v')?.match(/^[\w-]{6,20}$/)?.[0])
    || (host === 'youtu.be' && path.match(/^\/([\w-]{6,20})/)?.[1])
    || ((host === 'x.com' || host === 'twitter.com') && path.match(/\/status\/(\d{1,25})/)?.[1])
    || '';
  return { host, id };
}

/** The link's own words (a slug can carry a title), for the name scan. */
function linkWords(raw: string): string {
  try { const u = new URL(raw.trim()); return decodeURIComponent(u.pathname + ' ' + u.search + ' ' + u.hash).replace(/[_\-/+.=&?#]/g, ' '); } catch { return raw; }
}

/**
 * How many characters of a link are not the host and the id? A slug, a query or a fragment is text a writer can choose, so it
 * counts as free text (held for new accounts, first reports and strict mode).
 */
export function linkTail(raw: string): number {
  try {
    const u = new URL(raw.trim());
    const full = u.pathname + u.search + u.hash;
    const host = u.hostname.replace(/^(www|m|old|np|mobile)\./, '');
    // Only a known id shape counts as the id; on any other host the whole path is chosen text.
    const core = (host === 'reddit.com' ? full.match(/^\/r\/\w{1,21}\/comments\/[a-z0-9]{1,12}/i)?.[0] : undefined)
      ?? (host === 'youtube.com' ? full.match(/^\/watch\?v=[\w-]{6,20}/)?.[0] : undefined)
      ?? (host === 'youtu.be' ? full.match(/^\/[\w-]{6,20}(?=\/?$)/)?.[0] : undefined)
      ?? (host === 'x.com' || host === 'twitter.com' ? full.match(/^\/\w{1,15}\/status\/\d{1,25}/)?.[0] : undefined);
    const rest = core ? full.slice(core.length) : full;
    return rest === '/' || rest === '' ? 0 : rest.length;
  } catch { return raw.length; }
}

// ---- parsing ----

export interface Record_ { kind: FormKind; site: string; extVersion: string; listVersion: string; link: { host: string; id: string }; freeTextLength: number }
export type Parsed = { ok: true; record: Record_; freeText: string; linkExtra: number } | { ok: false };

const VERSION = /^\d{1,6}(\.\d{1,6}){0,2}$/;
const NO_RESPONSE = '_No response_';

/** Reads an issue made from one of the forms. `freeText` is for scanning only and is never stored. */
export function parseIssue(body: string, labels: string[], title = ''): Parsed {
  let kinds = labels.filter((l) => l.startsWith('form:')).map((l) => l.slice(5)) as FormKind[];
  // No label (it may not exist yet): the form's own title says which form it was.
  if (kinds.length === 0) kinds = (Object.keys(FORM_TITLES) as FormKind[]).filter((k) => FORM_TITLES[k] === title.trim());
  const kind = kinds[0];
  if (kinds.length !== 1 || !kind || !(kind in FORMS)) return { ok: false };
  const def = FORMS[kind];
  const sections = new Map<string, string>();
  const parts = body.split(/^### (.+)$/m); // [before, label, text, label, text, ...]
  if ((parts[0] ?? '').trim()) return { ok: false };
  for (let i = 1; i < parts.length; i += 2) {
    const label = (parts[i] ?? '').trim();
    if (sections.has(label) || !def.labels.includes(label)) return { ok: false };
    sections.set(label, (parts[i + 1] ?? '').trim());
  }
  if (sections.size !== def.labels.length) return { ok: false };
  const v = (l: string) => sections.get(l) ?? '';
  const site = v('Site');
  if (!def.sites.includes(site) || !VERSION.test(v('Extension version')) || !VERSION.test(v('List version'))) return { ok: false };
  const link = canonicalLink(v('Page link'));
  if (!link) return { ok: false };
  const ticks = v('Before you send');
  // Exactly the three lines, nothing after them: words on a tick line would be free text with no scan of its own.
  const tickLines = ticks.split('\n').map((l) => l.trim().replace(/^- \[X\]/, '- [x]')).filter(Boolean); // GitHub may write the tick as x or X
  if (tickLines.length !== TICKS.length || !TICKS.every((t) => tickLines.includes(`- [x] ${t}`))) return { ok: false };
  const raw = def.freeText ? v(FREE_TEXT_LABEL) : '';
  const freeText = raw === NO_RESPONSE ? '' : raw;
  return { ok: true, freeText, linkExtra: linkTail(v('Page link')), record: { kind, site, extVersion: v('Extension version'), listVersion: v('List version'), link, freeTextLength: freeText.length } };
}

// ---- decisions ----

export interface Decision { action: 'clean' | 'quarantine'; reason: 'none' | 'name' | 'unparsed' | 'free-text-held'; note?: string; record?: Record_ }
export interface CommentDecision { action: 'clean' | 'quarantine-comment'; reason: 'none' | 'name' | 'held'; note?: string }

export interface IssueInput { title: string; body: string; labels: string[]; author: Author; terms: Term[]; strict: boolean }

const held = (reason: Decision['reason'], record?: Record_): Decision => ({ action: 'quarantine', reason, note: NOTICE_RECEIVED, record });

export function decideIssue(i: IssueInput): Decision {
  if (TRUSTED.has(i.author.association)) return { action: 'clean', reason: 'none' };
  const p = parseIssue(i.body, i.labels, i.title);
  // The link's own words count too: a slug can carry a title.
  const linkText = linkWords(i.body.match(/^### Page link\s+(\S+)/m)?.[1] ?? '');
  if (namesSpoiler([i.title, i.body, linkText], i.terms)) return held('name');
  if (!p.ok) return held('unparsed');
  // The title is free text too unless it is the form's own.
  const freeLength = p.record.freeTextLength + p.linkExtra + (i.title.trim() === FORM_TITLES[p.record.kind] ? 0 : i.title.length);
  if (freeLength > 0 && (i.strict || i.author.ageDays < YOUNG_DAYS || i.author.priorIssues === 0)) return held('free-text-held', p.record);
  return { action: 'clean', reason: 'none', record: p.record };
}

export interface CommentInput { body: string; author: Author; terms: Term[]; strict: boolean }

export function decideComment(c: CommentInput): CommentDecision {
  if (TRUSTED.has(c.author.association) || !c.body.trim()) return { action: 'clean', reason: 'none' };
  if (namesSpoiler([c.body], c.terms)) return { action: 'quarantine-comment', reason: 'name', note: NOTICE_RECEIVED };
  const first = c.author.priorComments === 0 && c.author.priorIssues === 0;
  if (c.strict || c.author.ageDays < YOUNG_DAYS || first) return { action: 'quarantine-comment', reason: 'held', note: NOTICE_RECEIVED };
  return { action: 'clean', reason: 'none' };
}

// ---- caps ----

export interface Counts { authorIssues24h: number; authorComments24h: number; allIssues24h: number; allComments24h: number }

/** 'paused': the whole intake is flooded (the weekly counts line says so). 'author-limit': one account is over its share. */
export function overCap(c: Counts): 'ok' | 'author-limit' | 'paused' {
  // GitHub returns at most 100 comments a page, so 100 is as far as the count can see.
  if (c.allIssues24h > 20 || c.allComments24h >= 100) return 'paused';
  if (c.authorIssues24h >= 3 || c.authorComments24h > 5) return 'author-limit';
  return 'ok';
}
