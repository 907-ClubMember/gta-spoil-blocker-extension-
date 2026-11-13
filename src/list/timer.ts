import { UPDATE_MINUTES, loadSettings } from '../settings';
import { savedList, updateList } from './store';

export const ALARM = 'list-update';

/** The update timer, set from the "update every" setting. None under "Only when I press". Says whether it is set. */
export async function scheduleAlarm(): Promise<boolean> {
  const s = await loadSettings();
  const minutes = UPDATE_MINUTES[s.updateEvery];
  await chrome.alarms.clear(ALARM);
  if (minutes) await chrome.alarms.create(ALARM, { periodInMinutes: minutes, delayInMinutes: 1 });
  return !!minutes;
}

/**
 * At install and browser start: set the timer, and download the list at once while none is saved yet. Never under
 * "Only when I press". A failed download keeps the built-in list, and the timer tries again a minute later.
 */
export async function startUpdates(): Promise<void> {
  if (!(await scheduleAlarm())) return;
  if (!(await savedList())) await updateList(false);
}
