// Right-click "Never hide this": a selected word or phrase goes to the words never to hide, a link to an account's page goes
// to the accounts never to hide. Chrome hands the background the selection and the link with the click; nothing else is read.
import { ACCOUNT_LINK_PATTERNS, accountKey } from './accounts';
import { allowDropsGameName } from './matcher';
import { MAX_ALLOW, type Settings } from './settings';
import { TEXT } from './text';
import type { SpoilerList, Term } from './types';

export const NEVER_HIDE_WORD = 'never-hide-selection';
export const NEVER_HIDE_ACCOUNT = 'never-hide-account';

/** The two menu items: the word one on a selection, the account one only on links that can be an account's page. */
export function neverHideMenus(): { id: string; title: string; contexts: ['selection'] | ['link']; targetUrlPatterns?: string[] }[] {
  return [
    { id: NEVER_HIDE_WORD, title: TEXT.neverHideMenu.word, contexts: ['selection'] },
    { id: NEVER_HIDE_ACCOUNT, title: TEXT.neverHideMenu.account, contexts: ['link'], targetUrlPatterns: [...ACCOUNT_LINK_PATTERNS] },
  ];
}

type MenuClick = { menuItemId: string | number; selectionText?: string; linkUrl?: string };

/** Where the background keeps the last refused word click, for the options page's notice. Never the word itself. */
export const NEVER_HIDE_REFUSED = 'neverHideRefused';

const selectedWord = (info: MenuClick) => (info.selectionText ?? '').replace(/\s+/g, ' ').trim();

/** The word item on the game's own name: refused, since never hiding it would stop everything beside it from hiding. */
export function neverHideRefused(info: MenuClick, terms: readonly Term[]): boolean {
  return info.menuItemId === NEVER_HIDE_WORD && allowDropsGameName(selectedWord(info), terms);
}

/**
 * What a click on one of the items changes, or null when it changes nothing (another item, nothing usable, already listed,
 * the list is full, the game's own name in `terms`). Words are tidied as the options page does; a selection longer than a list
 * entry is not cut down.
 */
export function neverHideChange(
  s: Pick<Settings, 'allowWords' | 'allowAccounts'>,
  info: MenuClick,
  terms: readonly Term[] = [],
): Partial<Pick<Settings, 'allowWords' | 'allowAccounts'>> | null {
  if (info.menuItemId === NEVER_HIDE_WORD) {
    const word = selectedWord(info);
    if (!word || word.length > 80 || s.allowWords.length >= MAX_ALLOW || allowDropsGameName(word, terms)) return null;
    if (s.allowWords.some((w) => w.toLowerCase() === word.toLowerCase())) return null;
    return { allowWords: [...s.allowWords, word] };
  }
  if (info.menuItemId === NEVER_HIDE_ACCOUNT) {
    const key = info.linkUrl ? accountKey(info.linkUrl) : null;
    if (!key || s.allowAccounts.includes(key) || s.allowAccounts.length >= MAX_ALLOW) return null;
    return { allowAccounts: [...s.allowAccounts, key] };
  }
  return null;
}

/**
 * The list names a word click is checked against: the list in use, or the built-in one when that cannot be read (the game's
 * name is on both). None for the account item.
 */
export async function clickTerms(info: MenuClick, active: () => Promise<SpoilerList>, builtin: () => SpoilerList): Promise<readonly Term[]> {
  if (info.menuItemId !== NEVER_HIDE_WORD) return [];
  try {
    return (await active()).terms;
  } catch {
    return builtin().terms;
  }
}

/** What a click does: refused (the game's name), what to save, or nothing. */
export function neverHideClick(
  info: MenuClick,
  terms: readonly Term[],
  s: Pick<Settings, 'allowWords' | 'allowAccounts'>,
): { refused: true } | { save: Partial<Pick<Settings, 'allowWords' | 'allowAccounts'>> } | null {
  if (neverHideRefused(info, terms)) return { refused: true };
  const save = neverHideChange(s, info, terms);
  return save ? { save } : null;
}

/** Runs async jobs one after another, so two quick clicks never read the same settings and lose one write. */
export function serialQueue(): <T>(job: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return (job) => {
    const next = last.then(job, job);
    last = next.catch(() => {});
    return next;
  };
}
