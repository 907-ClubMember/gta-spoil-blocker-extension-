// Beta build only. The file names and the content of a "This looks wrong" report. Pure, so it unit-tests without a browser.
// Privacy: the JSON holds structure only (see src/content/report-snapshot.ts), plus the reporter's own note if they typed one.
// The screenshot is a separate .png with the same stem; it can hold spoilers and private content, stays on the owner's disk, and
// whoever reads a report opens the JSON only.
import type { Snapshot } from '../content/report-snapshot';
import { CLICK_PROBLEMS, NOTE_MAX, REPORT_KINDS, type ClickProblem, type ReportKind } from './strings';

export const REPORT_VERSION = 1;
export const REPORT_DIR = 'gsb-reports';

export const isKind = (k: unknown): k is ReportKind => typeof k === 'string' && (REPORT_KINDS as readonly string[]).includes(k);
const p2 = (n: number) => String(n).padStart(2, '0');
/** yyyymmdd-hhmmss in local time. */
export const stamp = (d: Date) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
/** The shared stem of the two files, without folder or extension. */
export const reportStem = (d: Date, kind: ReportKind) => `looks-wrong-${stamp(d)}-${kind}`;
export const reportPaths = (d: Date, kind: ReportKind) => ({
  json: `${REPORT_DIR}/${reportStem(d, kind)}.json`,
  png: `${REPORT_DIR}/${reportStem(d, kind)}.screenshot.png`,
});

export type Report = {
  schema: number;
  noPageText: true;
  kind: ReportKind;
  createdAt: string;
  extensionVersion: string;
  zoom: number | null;
  screenshotFile: string | null;
  snapshot: Snapshot | null;
  note?: string;
  noteIsReporterText?: true;
  clickProblem?: ClickProblem;
};

// Written as escapes on purpose (never as the characters themselves). C0 and C1 controls but tab and new line; the left-to-right,
// right-to-left and Arabic marks; embeddings, overrides and isolates; zero-width space, Mongolian vowel separator, byte order mark;
// line and paragraph separators; Unicode tag characters (they can spell a hidden message after visible text).
const INVISIBLE = /[\u{0000}-\u{0008}\u{000B}-\u{001F}\u{007F}-\u{009F}\u{061C}\u{180E}\u{200B}\u{200E}\u{200F}\u{2028}\u{2029}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{FEFF}\u{E0000}-\u{E007F}]/gu;
/**
 * The reporter's note as saved: line ends made \n, control, text-direction and invisible characters taken out (tab and new line
 * stay; so does the joiner inside an emoji), trimmed, at most NOTE_MAX characters (counted as characters: an emoji is never cut in half).
 */
export function cleanNote(s: unknown): string {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\r\n?/g, '\n').replace(INVISIBLE, '').trim();
  return [...t].slice(0, NOTE_MAX).join('').trim();
}
export const isClickProblem = (p: unknown): p is ClickProblem => typeof p === 'string' && (CLICK_PROBLEMS as readonly string[]).includes(p);

/**
 * note: what the reporter typed on the report page (their words, not the page's), saved here only, never in a file name; it comes with
 * noteIsReporterText. clickProblem: their choice, for a label or click report only.
 */
export function buildReport(a: { kind: ReportKind; when: Date; version: string; zoom: number | null; hasScreenshot: boolean; snapshot: Snapshot | null; note?: string; clickProblem?: ClickProblem }): Report {
  const note = cleanNote(a.note);
  return {
    schema: REPORT_VERSION,
    noPageText: true,
    kind: a.kind,
    createdAt: a.when.toISOString(),
    extensionVersion: a.version,
    zoom: a.zoom,
    // The file name only, next to the JSON.
    screenshotFile: a.hasScreenshot ? `${reportStem(a.when, a.kind)}.screenshot.png` : null,
    snapshot: a.snapshot,
    ...(note ? { note, noteIsReporterText: true as const } : {}),
    ...(a.kind === 'label-click' && isClickProblem(a.clickProblem) ? { clickProblem: a.clickProblem } : {}),
  };
}
