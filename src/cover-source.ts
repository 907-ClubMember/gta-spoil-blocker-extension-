// Where a cover came from: the setting that made it, when the default settings would not have (Strict, the person's own words, a site's
// own setting...), or a built-in spoiler account. The label ends with " · <tag>" for it (a built-in account, on by default, has no tag),
// the tip says it in a sentence, and "Change this" goes to that setting. Codes and words only, never the matched word. Its words are the
// coverSource block of extension-text.json.
import words from '../extension-text.json' with { type: 'json' };
import type { MatchResult } from './matcher';
import type { SettingAnchor, Why } from './reason-settings';
import type { Pictures, StrictnessSource } from './settings';

const WORDS = words.coverSource;

/** Every source a cover can have (the data-gsb-source value). */
export const SOURCES = ['strict', 'site-strict', 'site-list', 'site-pictures', 'own-words', 'own-accounts', 'builtin-account', 'blackout'] as const;
export type Source = (typeof SOURCES)[number];

/** What the scanner is told about the settings at this address (content.ts). */
export interface SourceContext {
  /** Where the level comes from (settings.ts strictnessSource). */
  strictness: StrictnessSource;
  /** The accounts the person added (src/accounts.ts keys). */
  ownAccounts?: ReadonlySet<string>;
  /** The picture settings without the site's or group's own values: the scanner asks whether these alone would have made a picture cover. */
  globalPictures?: Pictures;
}

/** A match as the scanner hands it to a cover: `sitePictures` when a site's picture choice made a picture cover the global one would not. */
export type CoverResult = MatchResult & { sitePictures?: boolean };

/** The end of the label. Built-in accounts are on by default: no tag, the tip still names them. */
export const SOURCE_TAG: Record<Source, string> = {
  strict: WORDS.tag.strict,
  'site-strict': WORDS.tag.site,
  'site-list': WORDS.tag.site,
  'site-pictures': WORDS.tag.site,
  'own-words': WORDS.tag.ownWords,
  'own-accounts': WORDS.tag.ownAccounts,
  'builtin-account': '',
  blackout: WORDS.tag.blackout,
};

/** The tip's sentence. */
export const SOURCE_SENTENCE: Record<Source, string> = {
  strict: WORDS.sentence.strict,
  'site-strict': WORDS.sentence.siteStrict,
  'site-list': WORDS.sentence.siteList,
  'site-pictures': WORDS.sentence.sitePictures,
  'own-words': WORDS.sentence.ownWords,
  'own-accounts': WORDS.sentence.ownAccounts,
  'builtin-account': WORDS.sentence.builtinAccount,
  blackout: WORDS.sentence.blackout,
};

/**
 * Where "Change this" goes for each source; null: the reason's own setting (reason-settings.ts REASON_ANCHOR). The site's own settings
 * and the Strict list have no card to jump to, and the blackout sits on Basics next to how much to protect.
 */
export const SOURCE_ANCHOR: Record<Source, SettingAnchor | null> = {
  strict: 'protect',
  'site-strict': null,
  'site-list': null,
  'site-pictures': 'pictures',
  'own-words': 'words',
  'own-accounts': 'accounts',
  'builtin-account': 'accounts',
  blackout: 'protect',
};

/**
 * The source of a cover, or null when the default settings make it anyway. The most specific wins: a site's own setting, then the
 * person's own words and accounts, then a level above the default, then the built-in lists. `account`: the account key a cover for
 * a spoiler account was made for.
 */
export function pickSource(why: Why, res: CoverResult, ctx: SourceContext, account?: string | null): Source | null {
  if (res.sitePictures) return 'site-pictures';
  if (why === 'account') return account && ctx.ownAccounts?.has(account) ? 'own-accounts' : 'builtin-account';
  if (res.byStrict) {
    if (ctx.strictness === 'site' || ctx.strictness === 'group') return 'site-strict';
    if (ctx.strictness === 'list') return 'site-list';
    if (ctx.strictness === 'global') return 'strict';
  }
  // A custom word hides alone; it counts as the cause only when no list name would cover the text anyway.
  if (why === 'alone' && res.custom && !res.categories.length) {
    const from = res.customFrom ?? ['own'];
    if (from.includes('own')) return 'own-words';
    if (from.includes('account')) return 'builtin-account';
    if (from.includes('blackout')) return 'blackout';
  }
  return null;
}
