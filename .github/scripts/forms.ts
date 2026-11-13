// The public report forms (.github/ISSUE_TEMPLATE/*.yml), as data. A test keeps this file and the templates in step.
// A form's text is read by code only: dropdown values are checked against these lists, and free text is thrown away after it is scanned.

export type FormKind = 'missed-spoiler' | 'wrong-hide' | 'broken-page';

/** Each form's fixed title. GitHub may not apply a template's label if the label does not exist yet, so the title also names the form. */
export const FORM_TITLES: Record<FormKind, string> = { 'missed-spoiler': 'Report: missed spoiler', 'wrong-hide': 'Report: wrong hide', 'broken-page': 'Report: broken page' };

export const SITES = ['Reddit', 'YouTube', 'X', 'Facebook', 'Instagram', 'TikTok', 'Twitch', 'Kick', 'Discord', 'Steam', 'Google', 'Bluesky', 'Other'];

export const FREE_TEXT_LABEL = 'Describe the layout, not the words (optional)';
export const TICKS = ["I checked the popup's Why panel", 'My list is up to date', 'I typed no names from the game'];

const COMMON = ['Site', 'Extension version', 'List version', 'Page link', 'Before you send'];

export interface FormDef { labels: string[]; sites: string[]; freeText: string | null }

export const FORMS: Record<FormKind, FormDef> = {
  // No free text at all: the word a person missed is exactly what must never be typed in public.
  'missed-spoiler': { labels: COMMON, sites: SITES, freeText: null },
  'wrong-hide': { labels: [...COMMON, FREE_TEXT_LABEL], sites: SITES, freeText: FREE_TEXT_LABEL },
  'broken-page': { labels: [...COMMON, FREE_TEXT_LABEL], sites: SITES, freeText: FREE_TEXT_LABEL },
};

/** Every heading a form can contain, plus the old form's: these are not the writer's words. */
export const KNOWN_HEADINGS = new Set<string>([
  ...Object.values(FORMS).flatMap((f) => f.labels),
  'What happened?', 'Link to the page', 'Anything else', 'Strictness',
]);
