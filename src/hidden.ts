import { KIND_GROUPS, type KindGroup } from './types';

/** What a hide counts under: a kind group, or a hide that is not a list name. Never any matched word. */
export type HideKey = KindGroup | 'words' | 'media' | 'custom' | 'accounts';
export type HiddenTally = Partial<Record<HideKey, number>>;

export const HIDE_KEYS: readonly HideKey[] = [...KIND_GROUPS, 'words', 'media', 'custom', 'accounts'];

/** Which keys one hidden item counts under. */
export function keysFor(why: string, groups: readonly (KindGroup | 'custom')[] | undefined): HideKey[] {
  if (why === 'spoiler-word') return ['words'];
  if (why === 'media' || why === 'near-game') return ['media'];
  if (why === 'account') return ['accounts'];
  return [...new Set(groups ?? [])];
}

export function addKeys(tally: HiddenTally, keys: readonly HideKey[]): void {
  for (const k of keys) tally[k] = (tally[k] ?? 0) + 1;
}

/** Adds the tallies of several frames. Ignores anything that is not a known key with a positive whole number. */
export function mergeTallies(list: Iterable<HiddenTally | undefined>): HiddenTally {
  const out: HiddenTally = {};
  for (const t of list) {
    if (!t) continue;
    for (const k of HIDE_KEYS) {
      const n = t[k];
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[k] = (out[k] ?? 0) + Math.floor(n);
    }
  }
  return out;
}

/** Keeps only known keys with positive counts, so a message from a page cannot put anything else on screen. */
export function cleanTally(raw: unknown): HiddenTally {
  return typeof raw === 'object' && raw ? mergeTallies([raw as HiddenTally]) : {};
}

/** "Missions 3 · People 2", biggest first; empty groups left out. */
export function describeTally(t: HiddenTally, names: Record<HideKey, string>): string {
  return HIDE_KEYS.filter((k) => (t[k] ?? 0) > 0)
    .sort((a, b) => (t[b] ?? 0) - (t[a] ?? 0) || HIDE_KEYS.indexOf(a) - HIDE_KEYS.indexOf(b))
    .map((k) => `${names[k]} ${t[k]}`)
    .join(' · ');
}
