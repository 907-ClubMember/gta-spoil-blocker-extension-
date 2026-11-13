import type { ListMeta } from './store';

/** The popup says the list is stale after this long without a good check. */
export const STALE_MS = 24 * 3600_000;

export type StaleNotice = { kind: 'builtin' } | { kind: 'old'; since: number | null };

/**
 * Whether the popup should say the spoiler list is out of date: it has never been checked, or the last check that got a usable
 * reply is more than a day old (a failed check does not count: checkedAt moves only on a good reply). A fresh good check that
 * found nothing newer than the built-in list means the built-in list is the published one: nothing to say.
 */
export function staleNotice(meta: ListMeta, savedInUse: boolean, now: number): StaleNotice | null {
  if (!meta.checkedAt) return savedInUse ? { kind: 'old', since: null } : { kind: 'builtin' };
  return now - meta.checkedAt > STALE_MS ? { kind: 'old', since: meta.checkedAt } : null;
}
