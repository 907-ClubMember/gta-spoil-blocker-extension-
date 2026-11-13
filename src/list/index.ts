import { parseVersion } from '../versions';
import { CATEGORIES, isKind, type SpoilerList, type Term } from '../types';

/** Published file shape: payload is base64 of UTF-8 JSON. Scrambling against casual reading, not secrecy. */
export interface PublishedList {
  v: number;
  d: string;
  /** Release day (YYYY-MM-DD), optional; an extension that does not know it ignores it. */
  r?: string;
  /** 1 = deliberately much smaller than the list before (a rollback), optional; an extension that does not know it ignores it. */
  s?: 1;
  /** The newest version of the extension (a plain x.y.z), optional; the popup tells people on an older build. */
  n?: string;
}

export const MAX_LIST_BYTES = 2_000_000;
/** The same limits the list builder uses (maxLen, minLen, longest mission title in words). */
export const MAX_TERM_LENGTH = 60;
export const MIN_TERM_LENGTH = 4;
/** Plain markers (strength 'context'), such as the three-letter game name, may be shorter. */
export const MIN_MARKER_LENGTH = 3;
export const MAX_TERM_WORDS = 10;
/** Far above any real list. Beyond this the whole list is treated as suspicious and the stored one is kept. */
export const MAX_TERMS = 20_000;

/** Hourly publishing takes over ten years to move this far; only a mistake or an attack does it in one step. */
export const MAX_VERSION_JUMP = 100_000;

/** Below this many names a list is too small for the shrink check to mean anything. */
export const MIN_LIST_FOR_SHRINK_CHECK = 100;
/**
 * A list of `next` names after one of `current` names has collapsed: under a quarter of a list worth checking. The extension
 * refuses such a list unless it is marked as deliberate (SpoilerList.shrink), and the job never publishes one unmarked.
 */
export const collapses = (current: number, next: number): boolean => current >= MIN_LIST_FOR_SHRINK_CHECK && next < current / 4;

/** Letters, marks, digits, single spaces and plain name punctuation. No control, zero-width, bidi or markup characters. */
const SAFE_TERM = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} '\u2019&.,:!?#-]*$/u;

/** Normalised (NFC) term text, or null when it fails hygiene and must be dropped. */
export function cleanTermText(text: string, marker = false): string | null {
  const t = text.normalize('NFC');
  if (t.length < (marker ? MIN_MARKER_LENGTH : MIN_TERM_LENGTH) || t.length > MAX_TERM_LENGTH) return null;
  if (!SAFE_TERM.test(t) || t.endsWith(' ') || t.includes('  ')) return null;
  if (t.split(' ').length > MAX_TERM_WORDS) return null;
  return t;
}

export class ListError extends Error {}

export function encodeList(list: SpoilerList): PublishedList {
  const json = JSON.stringify(list.terms);
  return { v: list.v, d: Buffer.from(json, 'utf8').toString('base64'), ...(list.release ? { r: list.release } : {}), ...(list.shrink ? { s: 1 as const } : {}), ...(parseVersion(list.latest) ? { n: list.latest } : {}) };
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Validate and decode a downloaded list. Throws ListError for anything structurally wrong (terms with unsafe text are dropped),
 * so the caller keeps the last good list. `storedVersion` blocks rollbacks.
 */
/** A real calendar day as YYYY-MM-DD: "2026-99-99" or "2026-02-31" would silently leave the launch-week blackout off. */
function isRealDate(r: unknown): r is string {
  if (typeof r !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r)) return false;
  const day = new Date(`${r}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === r;
}

export function decodeList(raw: string, storedVersion: number): SpoilerList {
  if (raw.length > MAX_LIST_BYTES) throw new ListError('list too large');

  let pub: unknown;
  try {
    pub = JSON.parse(raw);
  } catch {
    throw new ListError('not JSON');
  }
  if (!pub || typeof pub !== 'object') throw new ListError('bad shape');
  const { v, d } = pub as Record<string, unknown>;
  if (!Number.isSafeInteger(v) || (v as number) < 1 || typeof d !== 'string') throw new ListError('bad shape');
  if ((v as number) <= storedVersion) throw new ListError('not newer');
  // A wild version would make every later list look old, which turns one bad push into a permanent one.
  if ((v as number) > storedVersion + MAX_VERSION_JUMP) throw new ListError('version too far ahead');

  let terms: unknown;
  try {
    terms = JSON.parse(fromBase64(d));
  } catch {
    throw new ListError('bad payload');
  }
  if (!Array.isArray(terms)) throw new ListError('bad payload');

  if (terms.length > MAX_TERMS) throw new ListError('too many terms');

  const cats = new Set<string>(CATEGORIES);
  const clean: Term[] = [];
  for (const t of terms) {
    // A bad entry is dropped, not fatal: one odd entry, or a kind only newer versions know, must not block every other update.
    if (!t || typeof t !== 'object') continue;
    const { t: text, c, s, tr, k, l, o, r, f, p } = t as Record<string, unknown>;
    if (typeof text !== 'string') continue;
    if (typeof c !== 'string' || !cats.has(c)) continue;
    if (s !== 'strong' && s !== 'weak' && s !== 'context') continue;
    // Kind and raised level are optional: lists made before levels existed carry neither. One this version does not know is
    // ignored, not the whole name: the name stays on the list and its kind is guessed from its category and strength (kindOf).
    const safe = cleanTermText(text, s === 'context');
    if (safe === null) continue;
    const term: Term = { t: safe, c: c as Term['c'], s };
    if (tr === true) term.tr = true;
    if (o === true) term.o = true;
    // A marker is never a made-up person name (it would otherwise be turned into a weak name by the rare-name setting).
    if (r === true && s !== 'context') term.r = true;
    if (f === true && s !== 'context') term.f = true;
    // A marker is never a person: the game's own name must not be narrowed.
    if (p === true && s !== 'context') term.p = true;
    if (isKind(k)) term.k = k;
    if (l === 1 || l === 2 || l === 3) term.l = l;
    clean.push(term);
  }
  const r = (pub as Record<string, unknown>).r;
  const shrink = (pub as Record<string, unknown>).s === 1;
  const n = (pub as Record<string, unknown>).n;
  return { v: v as number, terms: clean, ...(isRealDate(r) ? { release: r } : {}), ...(shrink ? { shrink: true as const } : {}), ...(typeof n === 'string' && parseVersion(n) ? { latest: n } : {}) };
}

/** Counts per category, safe to show in the UI. */
export function countByCategory(terms: Term[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of terms) out[t.c] = (out[t.c] ?? 0) + 1;
  return out;
}
