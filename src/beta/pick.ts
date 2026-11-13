// Beta build only. The "pick" that the popup button and the shortcut start, for pages that replace the right-click menu with their
// own: the next left click picks a spot and is never passed to the page; Esc cancels; Enter, or a second press in the top frame,
// reports the whole visible page. Pure, so it unit-tests without a browser (src/beta/content.ts feeds it the real events).

/** key: the Esc or Enter that ended the pick, whose repeat, keypress and keyup are still swallowed. until: when the pick gives up. */
export type PickState = { picking: boolean; key: string | null; until: number };
export const PICK_IDLE: PickState = { picking: false, key: null, until: 0 };
/** A pick nobody finishes (the hint hidden under a full-screen video, the extension reloaded) ends by itself after this long. */
export const PICK_MS = 60_000;
export type PickInput =
  | { type: 'start'; top: boolean; now: number }
  | { type: 'end' }
  | { type: 'expire' }
  | { type: string; trusted: boolean; top: boolean; now: number; button?: number; detail?: number; key?: string; repeat?: boolean; composing?: boolean };
/**
 * expire: the pick gave up (timer, page hidden, or an event after PICK_MS): no report, and the event that found it out is the page's.
 * show: start, with the hint (top frame). arm: start in a sub-frame (no hint). swallow: the page does not get this event.
 * pick: the spot is picked. whole: the whole page. cancel: no report. All of pick, whole and cancel are swallowed too.
 */
export type PickAction = 'none' | 'show' | 'arm' | 'swallow' | 'pick' | 'whole' | 'cancel' | 'expire';

/** Window events the content script listens to (capture phase, from document_start). */
export const PICK_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'keydown', 'keypress', 'keyup'] as const;
// The parts of a click (any button) that come before or around it: the page must not react to a press it never sees the end of.
const GESTURE = new Set(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'auxclick', 'contextmenu']);

export function pickStep(s: PickState, i: PickInput): { state: PickState; action: PickAction } {
  const off = (key: string | null = null): PickState => ({ picking: false, key, until: 0 });
  if (i.type === 'start') {
    const now = (i as { now: number }).now;
    if (!s.picking) return { state: { picking: true, key: null, until: now + PICK_MS }, action: (i as { top: boolean }).top ? 'show' : 'arm' };
    // Pressed again: the top frame reports the whole page; a sub-frame waits for the worker to end the pick.
    return (i as { top: boolean }).top ? { state: off(), action: 'whole' } : { state: s, action: 'none' };
  }
  if (i.type === 'end') return { state: off(s.key), action: 'none' };
  if (i.type === 'expire') return s.picking ? { state: off(), action: 'expire' } : { state: s, action: 'none' };
  const e = i as Extract<PickInput, { trusted: boolean }>;
  // Events made by the page's own script are the page's business.
  if (!e.trusted) return { state: s, action: 'none' };
  if (s.key !== null && !s.picking) {
    // The rest of the Esc or Enter that ended the pick: its repeats, keypress and keyup. Any other key press means it is over.
    if (e.key === s.key && (e.type === 'keypress' || e.type === 'keyup' || (e.type === 'keydown' && e.repeat))) return { state: e.type === 'keyup' ? off() : s, action: 'swallow' };
    if (e.type === 'keydown') return { state: off(), action: 'none' };
  }
  if (!s.picking) return { state: s, action: 'none' };
  if (e.now > s.until) return { state: off(), action: 'expire' };
  if (e.type === 'keydown') {
    if (e.composing) return { state: s, action: 'none' };
    if (e.key === 'Escape') return { state: off('Escape'), action: 'cancel' };
    if (e.key === 'Enter') return { state: off('Enter'), action: 'whole' };
    return { state: s, action: 'none' };
  }
  // Only a real left click picks; a click made by a key (detail 0) or another button is swallowed and the pick goes on.
  if (e.type === 'click') return e.button === 0 && (e.detail ?? 0) > 0 ? { state: off(), action: 'pick' } : { state: s, action: 'swallow' };
  if (GESTURE.has(e.type)) return { state: s, action: 'swallow' };
  return { state: s, action: 'none' };
}
