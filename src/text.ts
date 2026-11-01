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
export const CATEGORY_TEXT = words.categories;
export const BLACKOUT_TEXT = words.blackout;
export const UPDATE_TEXT = words.updateSchedule;

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
  offOnSite: (site: string) => fill(words.text.offOnSite, { site }),
};
