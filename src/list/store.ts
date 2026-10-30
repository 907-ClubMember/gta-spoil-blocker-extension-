import builtin from '../../lists/dist/spoilers.json';
import { ListError, decodeList } from './index';
import type { SpoilerList } from '../types';

export const LIST_URL =
  'https://raw.githubusercontent.com/907-ClubMember/gta-spoil-blocker-extension-/main/lists/dist/spoilers.json';

export interface ListMeta {
  etag?: string;
  checkedAt?: number;
  updatedAt?: number;
  lastManualAt?: number;
}

/** The list that ships inside the extension. Always available, works offline. */
export function builtinList(): SpoilerList {
  return decodeList(JSON.stringify(builtin), 0);
}

/** Downloaded list if there is a newer one than the built-in copy, else the built-in copy. */
export async function activeList(): Promise<SpoilerList> {
  const base = builtinList();
  try {
    const got = await chrome.storage.local.get('list');
    const saved = got.list as SpoilerList | undefined;
    if (saved && Array.isArray(saved.terms) && saved.v > base.v) return saved;
  } catch {
    /* fall through to built-in */
  }
  return base;
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
const MIN_LIST_FOR_SHRINK_CHECK = 100;

/**
 * Fetch the published list. Keeps the last good list on any failure.
 * Results never include terms, only counts.
 */
export async function updateList(manual: boolean, now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<UpdateResult> {
  const meta = await loadMeta();
  if (manual && meta.lastManualAt && now - meta.lastManualAt < MANUAL_COOLDOWN_MS) return { status: 'wait' };

  const current = await activeList();
  const next: ListMeta = { ...meta, checkedAt: now, ...(manual ? { lastManualAt: now } : {}) };

  try {
    const headers: Record<string, string> = {};
    if (meta.etag) headers['If-None-Match'] = meta.etag;
    const res = await fetchImpl(LIST_URL, { headers, cache: 'no-cache' });
    if (res.status === 304) {
      await chrome.storage.local.set({ listMeta: next });
      return { status: 'current', version: current.v };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text();
    try {
      const list = decodeList(text, current.v);
      // An empty or collapsed list would quietly turn hiding off: keep the old one.
      if (list.terms.length === 0 || (current.terms.length >= MIN_LIST_FOR_SHRINK_CHECK && list.terms.length < current.terms.length / 4)) throw new ListError('list too small');
      next.etag = res.headers.get('etag') ?? undefined;
      next.updatedAt = now;
      await chrome.storage.local.set({ list, listMeta: next });
      return { status: 'updated', version: list.v, added: Math.max(0, list.terms.length - current.terms.length) };
    } catch (e) {
      if (e instanceof ListError && e.message === 'not newer') {
        next.etag = res.headers.get('etag') ?? undefined;
        await chrome.storage.local.set({ listMeta: next });
        return { status: 'current', version: current.v };
      }
      throw e;
    }
  } catch (e) {
    await chrome.storage.local.set({ listMeta: next }).catch(() => {});
    return { status: 'error', reason: e instanceof ListError ? 'The downloaded list was not valid, so the old one was kept.' : 'Could not reach the update server.' };
  }
}

export function describeResult(r: UpdateResult): string {
  switch (r.status) {
    case 'updated':
      return r.added > 0 ? `Updated to version ${r.version}: ${r.added} new ${r.added === 1 ? 'term' : 'terms'}.` : `Updated to version ${r.version}.`;
    case 'current':
      return `Already up to date (version ${r.version}).`;
    case 'wait':
      return 'You just checked. Please wait a minute before checking again.';
    case 'error':
      return r.reason;
  }
}
