// Beta build only (see src/beta-flag.ts). The content-script side of "This looks wrong": it remembers where the last right-click
// was and, when the worker asks, answers with a structure-only snapshot (src/content/report-snapshot.ts). Nothing leaves the page
// except that snapshot, to the extension's own worker.
// Pages that replace the right-click menu (Discord, Google Docs) get a pick instead, started by the popup button or the shortcut
// (src/beta/pick.ts): the next left click picks the spot and is never passed to the page.
import { adapterFor } from '../adapters';
import { buildSnapshot } from '../content/report-snapshot';
import { PICK_EVENTS, PICK_IDLE, PICK_MS, pickStep, type PickInput } from './pick';
import { PICK_DONE_MSG, PICK_END_MSG, PICK_HINT, PICK_HINT_TAG, PICK_START_MSG, SNAPSHOT_MSG } from './strings';

/** Two frames, so the page is painted without the hint before the worker takes the picture (a timer too, for a hidden tab). */
const afterPaint = () => new Promise<void>((ok) => {
  requestAnimationFrame(() => requestAnimationFrame(() => ok()));
  setTimeout(ok, 250);
});

/** Called before guardBars, so a picking click on one of our bars is taken here first and does not reveal it. */
export function watchContextMenu(isTop: boolean): void {
  let click: { x: number; y: number } | null = null;
  let pick = PICK_IDLE;
  let hint: HTMLElement | null = null;
  const showHint = () => {
    // Our own element: no page text, never hit by a click (pointer-events none), not in the snapshot, gone before the picture.
    hint?.remove();
    hint = document.createElement(PICK_HINT_TAG);
    hint.style.cssText = 'all:initial;position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none';
    const root = hint.attachShadow({ mode: 'closed' });
    const box = document.createElement('div');
    box.textContent = PICK_HINT;
    box.style.cssText = 'font:13px/1.4 system-ui,sans-serif;color:#fff;background:#7c3aed;padding:6px 12px;border-radius:6px;box-shadow:0 2px 8px #0005;user-select:none;white-space:nowrap';
    root.append(box);
    document.documentElement.append(hint);
  };
  const hideHint = () => { hint?.remove(); hint = null; };
  let timer = 0;
  const done = (how: 'pick' | 'whole' | 'cancel') => {
    hideHint();
    clearTimeout(timer);
    try { void (chrome.runtime.sendMessage({ type: PICK_DONE_MSG, how }) as Promise<unknown>).catch(() => {}); } catch { /* extension reloaded */ }
  };
  // A pick that nobody ends gives up by itself (the worker is told, so the other frames stop too): after PICK_MS, or when the page goes.
  const step = (i: PickInput) => {
    const r = pickStep(pick, i);
    pick = r.state;
    if (r.action === 'show') showHint();
    if (r.action === 'show' || r.action === 'arm') { clearTimeout(timer); timer = window.setTimeout(() => step({ type: 'expire' }), PICK_MS + 100); }
    if (r.action === 'expire') done('cancel');
    return r.action;
  };
  window.addEventListener('pagehide', () => step({ type: 'expire' }));
  // On the window, in the capture phase, from document_start: ahead of the page's own listeners.
  for (const type of PICK_EVENTS) {
    window.addEventListener(type, (ev) => {
      const e = ev as MouseEvent & KeyboardEvent;
      const action = step({ type, trusted: e.isTrusted, top: isTop, now: Date.now(), button: e.button, detail: e.detail, key: e.key, repeat: e.repeat, composing: e.isComposing });
      if (action === 'none' || action === 'expire') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (action === 'pick') { click = { x: e.clientX, y: e.clientY }; done('pick'); }
      else if (action === 'whole') { click = null; done('whole'); }
      else if (action === 'cancel') done('cancel');
    }, true);
  }
  document.addEventListener('contextmenu', (e) => { click = { x: e.clientX, y: e.clientY }; }, true);
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === SNAPSHOT_MSG) {
      reply({ snapshot: buildSnapshot({ doc: document, click, adapter: adapterFor(location.hostname, location.pathname)?.name ?? null, href: location.href, isTop }) });
      return false;
    }
    if (msg?.type === PICK_START_MSG) {
      const action = step({ type: 'start', top: isTop, now: Date.now() });
      if (action === 'whole') { click = null; done('whole'); }
      // Only the top frame answers (the worker waits for one answer).
      if (isTop) reply({ state: action === 'whole' ? 'whole' : 'picking' });
      return false;
    }
    if (msg?.type === PICK_END_MSG) {
      pick = pickStep(pick, { type: 'end' }).state;
      clearTimeout(timer);
      if (msg.whole === true) click = null;
      if (!isTop) return false;
      hideHint();
      void afterPaint().then(() => reply({ ended: true }));
      return true;
    }
    return false;
  });
}
