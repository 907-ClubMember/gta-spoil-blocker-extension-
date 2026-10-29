import { CATEGORIES, isKind, type SpoilerList, type Term } from '../types';

/** Published file shape: payload is base64 of UTF-8 JSON. Scrambling against casual reading, not secrecy. */
export interface PublishedList {
  v: number;
  d: string;
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
  return { v: list.v, d: Buffer.from(json, 'utf8').toString('base64') };
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
  if (!Number.isInteger(v) || (v as number) < 1 || typeof d !== 'string') throw new ListError('bad shape');
  if ((v as number) <= storedVersion) throw new ListError('not newer');

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
    if (!t || typeof t !== 'object') throw new ListError('bad term');
    const { t: text, c, s, tr, k, l, o, r } = t as Record<string, unknown>;
    if (typeof text !== 'string') throw new ListError('bad term');
    if (typeof c !== 'string' || !cats.has(c)) throw new ListError('bad category');
    if (s !== 'strong' && s !== 'weak' && s !== 'context') throw new ListError('bad strength');
    // Kind and raised level are optional: lists made before levels existed carry neither.
    if (k !== undefined && !isKind(k)) throw new ListError('bad kind');
    if (l !== undefined && l !== 1 && l !== 2 && l !== 3) throw new ListError('bad level');
    // Bad text is dropped, not fatal: one odd entry must not block every other update.
    const safe = cleanTermText(text, s === 'context');
    if (safe === null) continue;
    const term: Term = { t: safe, c: c as Term['c'], s };
    if (tr === true) term.tr = true;
    if (o === true) term.o = true;
    if (r === true) term.r = true;
    if (k !== undefined) term.k = k;
    if (l !== undefined) term.l = l;
    clean.push(term);
  }
  return { v: v as number, terms: clean };
}

/** Counts per category, safe to show in the UI. */
export function countByCategory(terms: Term[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of terms) out[t.c] = (out[t.c] ?? 0) + 1;
  return out;
}
