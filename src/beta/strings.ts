// Beta build only (see src/beta-flag.ts). These words are kept out of extension-text.json on purpose: they never ship in the store zip.
export const BETA_BADGE_TEXT = 'BETA';
export const BETA_BADGE_COLOR = '#7c3aed';
export const BETA_MENU_ID = 'gsb-beta-looks-wrong';
export const BETA_MENU_TITLE = 'This looks wrong';
/** Message from the background to the content script of the frame that was clicked. */
export const SNAPSHOT_MSG = 'gsb-beta-snapshot';
/** The shortcut (manifest `commands`, beta build only): its name, suggested key and the text chrome://extensions/shortcuts shows. */
export const BETA_COMMAND = 'gsb-beta-looks-wrong';
export const BETA_SHORTCUT = 'Alt+Shift+R';
/** Pick mode (popup button and shortcut): the worker starts it in every frame and ends it; a frame says when it picked or was cancelled. */
export const PICK_START_MSG = 'gsb-beta-pick-start';
export const PICK_END_MSG = 'gsb-beta-pick-end';
export const PICK_DONE_MSG = 'gsb-beta-pick-done';
/** Message from the popup button to the background. */
export const POPUP_PICK_MSG = 'gsb-beta-popup-pick';
/** The short line shown at the top of the page while picking (our own element, removed before the picture is taken). */
export const PICK_HINT = 'Click the part that looks wrong. Esc to cancel, Enter for the whole page.';
export const PICK_HINT_TAG = 'gsb-beta-hint';
/** Message from the report page to the background. */
export const GET_REPORT_MSG = 'gsb-beta-get-report';

export const REPORT_KINDS = ['covered-wrong', 'missed', 'label-click'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const KIND_LABEL: Record<ReportKind, string> = {
  'covered-wrong': 'Covered, but should not be',
  missed: 'Not covered, but should be',
  'label-click': 'Label or click problem',
};
export const SAVED_TEXT = 'Saved to Downloads';
export const PNG_WARNING =
  'The screenshot can hold spoilers and private content. It stays on this computer, in Downloads/gsb-reports. Open the .json only (structure, no page text); do not open or describe the .png unless the owner asks.';

/** The reporter's own words on the report page (optional). Saved as `note` in the JSON only, never in a file name. */
export const NOTE_LABEL = "What's wrong? (optional, in your own words)";
export const NOTE_HINT = 'No need to quote the spoiler: say what the label or cover did.';
export const NOTE_MAX = 2000;
/** For a label or click problem: what happened (optional). Saved as `clickProblem`. */
export const CLICK_PROBLEMS = ['no-bar-to-press', 'press-did-nothing', 'press-opened-page', 'label-confusing', 'other'] as const;
export type ClickProblem = (typeof CLICK_PROBLEMS)[number];
export const CLICK_PROBLEM_LEGEND = 'For a label or click problem, what happened? (optional)';
export const CLICK_PROBLEM_LABEL: Record<ClickProblem, string> = {
  'no-bar-to-press': 'There was no bar to press',
  'press-did-nothing': 'Pressing the bar did nothing',
  'press-opened-page': 'Pressing the bar opened the page or post',
  'label-confusing': 'The label is confusing',
  other: 'Something else',
};
