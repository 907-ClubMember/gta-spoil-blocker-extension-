import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from './settings';

/** A settings backup file: these marks, the version that wrote it, and the settings object. Never the spoiler list. */
export const BACKUP_APP = 'spoiler-blocker-settings';
export const BACKUP_FORMAT = 1;
/** A settings file is a few kilobytes; anything far bigger is not one. */
export const MAX_BACKUP_CHARS = 1_000_000;
/** No list anyone keeps is this long; one this long would slow every page down. */
export const MAX_LIST_ENTRIES = 5000;

/** The backup file's text. Only the settings (choices and lists) go in. */
export function makeBackup(s: Settings, version: string, now = new Date()): string {
  const settings = normalizeSettings(s);
  return `${JSON.stringify({ app: BACKUP_APP, format: BACKUP_FORMAT, version, saved: now.toISOString(), settings }, null, 2)}\n`;
}

/** The file name offered for a backup: spoiler-blocker-settings-YYYY-MM-DD.json. */
export function backupName(now = new Date()): string {
  return `${BACKUP_APP}-${now.toISOString().slice(0, 10)}.json`;
}

export type RestoreProblem = 'tooBig' | 'notJson' | 'notBackup' | 'newer' | 'empty';
/** `turnsOff`: the file switches hiding off (off, "finished the story", an end time already past): the confirm line says so. */
export type Restore = { ok: true; settings: Settings; changed: (keyof Settings)[]; turnsOff: boolean } | { ok: false; problem: RestoreProblem };

/**
 * A backup file read for restoring: checked to be one of ours, the settings in it put through the same checks as stored settings (unknown
 * keys and wrong values are dropped, as when settings are loaded), and the settings it would change. Nothing is applied here.
 */
export function readBackup(text: string, current: Settings): Restore {
  if (text.length > MAX_BACKUP_CHARS) return { ok: false, problem: 'tooBig' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'notJson' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, problem: 'notBackup' };
  const file = raw as { app?: unknown; format?: unknown; settings?: unknown };
  if (file.app !== BACKUP_APP || typeof file.format !== 'number') return { ok: false, problem: 'notBackup' };
  if (file.format > BACKUP_FORMAT) return { ok: false, problem: 'newer' };
  const inner = file.settings;
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return { ok: false, problem: 'notBackup' };
  // At least one setting it knows: an object of strangers restores nothing.
  if (!Object.keys(inner).some((k) => Object.hasOwn(DEFAULT_SETTINGS, k))) return { ok: false, problem: 'empty' };
  if (Object.values(inner).some((v) => Array.isArray(v) && v.length > MAX_LIST_ENTRIES)) return { ok: false, problem: 'tooBig' };
  const now = normalizeSettings(current);
  // A pause belongs to the moment it was set: never taken from a file (an old or shared file could pause hiding for years).
  const settings = { ...normalizeSettings(inner), pausedUntil: now.pausedUntil };
  const changed = (Object.keys(settings) as (keyof Settings)[]).filter((k) => JSON.stringify(settings[k]) !== JSON.stringify(now[k]));
  const today = new Date().toISOString().slice(0, 10);
  const turnsOff = (!settings.enabled && now.enabled) || (settings.storyFinished && !now.storyFinished) || (!!settings.endDate && !settings.timerOff && settings.endDate.slice(0, 10) <= today && settings.endDate !== now.endDate);
  return { ok: true, settings, changed, turnsOff };
}
