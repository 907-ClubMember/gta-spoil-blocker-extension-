import builtin from '../../lists/dist/spoilers.json';
import { ListError, collapses, decodeList } from './index';
import { TEXT } from '../text';
import type { SpoilerList } from '../types';

export const LIST_URL =
  'https://raw.githubusercontent.com/907-ClubMember/gta-spoil-blocker-extension-/main/lists/dist/spoilers.json';

export interface ListMeta {
  etag?: string;
  checkedAt?: number;
  updatedAt?: number;
  lastManualAt?: number;
  /** Last check that did not work, and why. checkedAt only moves when the server answered with a usable reply. */
  failedAt?: number;
  failure?: 'network' | 'invalid';
  /** The last collapsed, unmarked list refused as broken (version, size), for the options page and the log (label audit B5). */
  refused?: { v: number; n: number };
}

/** The list that ships inside the extension. Always available, works offline. */
export function builtinList(): SpoilerList {
  return decodeList(JSON.stringify(builtin), 0);
}

/** The saved list counts only when it is newer than the built-in copy and holds a usable name, else the built-in copy is used. */
export function chooseList(saved: SpoilerList | undefined, base: SpoilerList): { list: SpoilerList; savedInUse: boolean } {
  return saved !== undefined && Array.isArray(saved.terms) && saved.terms.some(usableTerm) && saved.v > base.v ? { list: saved, savedInUse: true } : { list: base, savedInUse: false };
}

/** Downloaded list if there is a newer one than the built-in copy, else the built-in copy. */
export async function activeList(): Promise<SpoilerList> {
  return chooseList(await savedList(), builtinList()).list;
}

/** An entry the extension can read: an object with a name, a category and a strength. */
function usableTerm(t: unknown): t is SpoilerList['terms'][number] {
  const e = t as { t?: unknown; c?: unknown; s?: unknown } | null;
  return !!e && typeof e === 'object' && typeof e.t === 'string' && e.t !== '' && typeof e.c === 'string' && (e.s === 'strong' || e.s === 'weak' || e.s === 'context');
}

/** The downloaded list kept in storage, if there is a usable one. */
export async function savedList(): Promise<SpoilerList | undefined> {
  try {
    const saved = (await chrome.storage.local.get('list')).list as SpoilerList | undefined;
    // Only well-formed entries are used: one broken entry (storage damaged) would otherwise stop the page from being read at all.
    // A saved list with no usable name (empty, or only junk) must not outrank the built-in one: with a high version nothing newer
    // could ever replace it, and hiding would stay off for good.
    const terms = saved && Array.isArray(saved.terms) ? saved.terms.filter(usableTerm) : [];
    if (terms.length) return { ...saved!, terms };
  } catch {
    /* none */
  }
  return undefined;
}

export async function loadMeta(): Promise<ListMeta> {
  try {
    return ((await chrome.storage.local.get('listMeta')).listMeta as ListMeta) ?? {};
  } catch {
    return {};
  }
}

export type UpdateResult =
  | { status: 'updated'; version: number; added: number }
  | { status: 'current'; version: number }
  | { status: 'wait' }
  | { status: 'error'; reason: string };

export const MANUAL_COOLDOWN_MS = 60_000;

/**
 * Fetch the published list. Keeps the last good list on any failure.
 * Results never include terms, only counts.
 */
export async function updateList(manual: boolean, now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<UpdateResult> {
  const meta = await loadMeta();
  if (manual && meta.lastManualAt && now - meta.lastManualAt < MANUAL_COOLDOWN_MS) return { status: 'wait' };

  // Same choice as activeList(). The ETag belongs to the saved list: while the built-in one is used, a 304 would keep it
  // forever, so ask without one.
  const { list: current, savedInUse } = chooseList(await savedList(), builtinList());
  const next: ListMeta = { ...meta, ...(manual ? { lastManualAt: now } : {}) };
  if (!savedInUse) delete next.etag;
  const checked = (): ListMeta => ({ ...next, checkedAt: now, failedAt: undefined, failure: undefined });

  try {
    const headers: Record<string, string> = {};
    if (next.etag) headers['If-None-Match'] = next.etag;
    const res = await fetchImpl(LIST_URL, { headers, cache: 'no-cache' });
    if (res.status === 304) {
      await chrome.storage.local.set({ listMeta: checked() });
      return { status: 'current', version: current.v };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text();
    try {
      const list = decodeList(text, current.v);
      // An empty or collapsed list would quietly turn hiding off: keep the old one. An empty list never counts. A collapsed one counts
      // only when it is marked as deliberately smaller (a rollback, SpoilerList.shrink); unmarked it is refused every time, and noted.
      // Once a marked list is in use, the lists after it are measured against it, so they no longer look collapsed (label audit B5).
      if (list.terms.length === 0) throw new ListError('list too small');
      if (collapses(current.terms.length, list.terms.length) && !list.shrink) {
        next.refused = { v: list.v, n: list.terms.length };
        throw new ListError('list too small');
      }
      delete next.refused;
      next.etag = res.headers.get('etag') ?? undefined;
      next.updatedAt = now;
      await chrome.storage.local.set({ list, listMeta: checked() });
      return { status: 'updated', version: list.v, added: Math.max(0, list.terms.length - current.terms.length) };
    } catch (e) {
      if (e instanceof ListError && e.message === 'not newer') {
        if (savedInUse) next.etag = res.headers.get('etag') ?? undefined;
        await chrome.storage.local.set({ listMeta: checked() });
        return { status: 'current', version: current.v };
      }
      throw e;
    }
  } catch (e) {
    const failure = e instanceof ListError ? 'invalid' : 'network';
    await chrome.storage.local.set({ listMeta: { ...next, failedAt: now, failure } }).catch(() => {});
    return { status: 'error', reason: TEXT.updateError(failure) };
  }
}

export function describeResult(r: UpdateResult): string {
  switch (r.status) {
    case 'updated':
      return TEXT.updated(r.version, r.added);
    case 'current':
      return TEXT.upToDate(r.version);
    case 'wait':
      return TEXT.updateWait();
    case 'error':
      return r.reason;
  }
}
