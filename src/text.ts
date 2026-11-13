// Every word the extension shows lives in extension-text.json at the top of the repo, so it can be changed without touching
// code. This file only hands it out and fills in the {blanks}.
import words from '../extension-text.json' with { type: 'json' };

const fill = (text: string, values: Record<string, string | number>): string => text.replace(/\{(\w+)\}/g, (all, k: string) => String(values[k] ?? all));

export const STRICTNESS_TEXT = words.strictness;
export const HIDE_MODE_TEXT = words.hideMode;
export const PRESET_TEXT = words.presets;
export const BLUR_TEXT = words.blur;
export const REVEAL_TEXT = words.reveal;
export const CATEGORY_MODE_TEXT = words.categoryModes;
export const PROTECT_TEXT = words.protect;
export const KIND_MODE_TEXT = words.kindModes;
export const KIND_TEXT = words.kinds;
export const KIND_GROUP_TEXT = words.kindGroups;
/** Names for the popup's "what was hidden here" line: the kind groups plus hides that are not list names. */
export const HIDDEN_GROUP_TEXT = { ...words.kindGroups, ...words.hiddenGroups };
export const RARE_TEXT = words.rare;
export const ORDINARY_TEXT = words.ordinary;
export const PART_TEXT = words.parts;
export const REPLIES_TEXT = words.replies;
export const MEDIA_NEAR_TEXT = words.mediaNear;
export const REACTION_GIF_TEXT = words.reactionGifs;
export const REPLY_GIF_TEXT = words.replyGifs;
export const REPLY_PHOTO_TEXT = words.replyPhotos;
export const CATEGORY_TEXT = words.categories;
export const BLACKOUT_TEXT = words.blackout;
export const UPDATE_TEXT = words.updateSchedule;
export const EXAMPLE_TEXT = words.examples;
/** What changed, per version (key v1_2_3): shown once in the popup after an update to that version. */
export const RELEASE_NOTES = words.releaseNotes as unknown as Record<string, readonly string[] | undefined>;

type Examples = readonly (readonly [string, string, string])[];

export const TEXT = {
  ...words.text,
  welcome: words.welcome,
  allowSites: { ...words.text.allowSites, examples: words.text.allowSites.examples as unknown as Examples },
  blockSites: { ...words.text.blockSites, examples: words.text.blockSites.examples as unknown as Examples },
  siteCoveredBy: (label: string) => fill(words.text.siteCoveredBy, { label }),
  hidden: (n: number) => fill(n === 0 ? words.text.hidden.none : n === 1 ? words.text.hidden.one : words.text.hidden.many, { count: n }),
  safeWhy: (kind: 'site' | 'prefix' | 'page', label: string) => fill(words.text.safeWhy[kind], { label }),
  strictHere: (label: string) => fill(words.text.strictHere, { label }),
  pausedUntil: (when: string) => fill(words.text.pausedUntil, { when }),
  listStaleSince: (date: string) => fill(words.text.listStale.since, { date }),
  whatsNewTitle: (version: string) => fill(words.text.whatsNew.title, { version }),
  updateLine: (version: string) => fill(words.text.updateAvailable.line, { version }),
  offOnSite: (site: string) => fill(words.text.offOnSite, { site }),
  updateFailed: (when: string, why: keyof typeof words.text.updates.failedWhy) => fill(words.text.updates.failed, { when, why: words.text.updates.failedWhy[why] }),
  updated: (version: number, added: number) => {
    const r = words.text.updates.result;
    return fill(added === 0 ? r.updated : added === 1 ? r.updatedOne : r.updatedMany, { version, added });
  },
  upToDate: (version: number) => fill(words.text.updates.result.current, { version }),
  updateWait: () => words.text.updates.result.wait,
  updateError: (why: keyof typeof words.text.updates.failedWhy) => fill(words.text.updates.result.error, { why: words.text.updates.failedWhy[why] }),
};
