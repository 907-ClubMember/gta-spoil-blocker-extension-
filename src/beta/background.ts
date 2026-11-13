// Beta build only (see src/beta-flag.ts). The "This looks wrong" menu item: the worker takes a picture of the visible tab, asks the
// clicked frame for a structure-only snapshot, and opens a local page (report.html) that saves the report to Downloads.
// Everything stays on this computer: no fetch, no XHR, no beacon. The screenshot can hold spoilers and private content; it stays on
// the owner's disk, and whoever reads a report describes STRUCTURE only.
import { BETA_BADGE_COLOR, BETA_BADGE_TEXT, BETA_COMMAND, BETA_MENU_ID, BETA_MENU_TITLE, GET_REPORT_MSG, PICK_DONE_MSG, PICK_END_MSG, PICK_START_MSG, POPUP_PICK_MSG, SNAPSHOT_MSG } from './strings';
import type { Snapshot } from '../content/report-snapshot';

export { BETA_MENU_ID };

export type Pending = { id: string; screenshot: string | null; snapshot: Snapshot | null; zoom: number | null; version: string; when: number };
const pending = new Map<string, Pending>();
const KEY = 'gsb-beta-pending';

/** Test hook (beta only): replaces the screenshot step, which needs a real click on the menu for activeTab. */
export const hooks: { capture?: (windowId: number) => Promise<string> } = {};

/** The beta menu item's create props (src/site-pictures-menu.ts lists it last). */
export const betaMenuItem = (): chrome.contextMenus.CreateProperties => ({ id: BETA_MENU_ID, title: BETA_MENU_TITLE, contexts: ['all'] });

/** Made last, after every store item. */
export function registerMenu(): void {
  chrome.contextMenus.create(betaMenuItem());
}

/** The BETA badge on the icon, with its own colour; the count and OFF badges still take over per tab. */
export function showBetaBadge(): void {
  void chrome.action.setBadgeText({ text: BETA_BADGE_TEXT });
  void chrome.action.setBadgeBackgroundColor({ color: BETA_BADGE_COLOR });
}

/** A page of the extension itself (the report page, options): no report of a report. */
const ownPage = (url: string | undefined) => typeof url === 'string' && url.startsWith(chrome.runtime.getURL('/'));

export async function looksWrong(info: { frameId?: number; pageUrl?: string; frameUrl?: string }, tab: { id?: number; windowId?: number } | undefined): Promise<string | null> {
  if (tab?.id === undefined || tab.windowId === undefined) return null;
  if (ownPage(info.pageUrl) || ownPage(info.frameUrl)) return null;
  const tabId = tab.id;
  let screenshot: string | null = null;
  try {
    screenshot = await (hooks.capture ?? ((w: number) => chrome.tabs.captureVisibleTab(w, { format: 'png' })))(tab.windowId);
  } catch {
    /* no screenshot: the report still carries the structure */
  }
  let snapshot: Snapshot | null = null;
  try {
    const r = (await chrome.tabs.sendMessage(tabId, { type: SNAPSHOT_MSG }, { frameId: info.frameId ?? 0 })) as { snapshot?: Snapshot } | undefined;
    snapshot = r?.snapshot ?? null;
  } catch {
    /* no content script in that frame */
  }
  let zoom: number | null = null;
  try { zoom = await chrome.tabs.getZoom(tabId); } catch { /* the tab has gone */ }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item: Pending = { id, screenshot, snapshot, zoom, version: chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version, when: Date.now() };
  pending.set(id, item);
  try { await chrome.storage.session.set({ [KEY]: item }); } catch { /* too big for session storage: the worker's memory has it */ }
  await chrome.tabs.create({ url: chrome.runtime.getURL(`/report.html?id=${encodeURIComponent(id)}`) });
  return id;
}

type TabLike = { id?: number; windowId?: number; url?: string };

/**
 * The popup button and the shortcut: no right-click target, so every frame of the tab starts a pick (src/beta/pick.ts) and the top
 * frame shows the hint. Pressed again while picking: the whole page. Both presses grant activeTab for the tab, as the menu does; the
 * grant lasts until the tab goes to another site, so the picture is still allowed when the pick ends.
 */
export async function startPick(tab: TabLike | undefined): Promise<string | null> {
  if (tab?.id === undefined) return null;
  try {
    const r = (await chrome.tabs.sendMessage(tab.id, { type: PICK_START_MSG })) as { state?: string } | undefined;
    return r?.state ?? null;
  } catch {
    // No content script there. A web page opened before the extension was loaded: report the tab as it is, picture only. A browser
    // page (chrome://, the new tab page, the Web Store) has nothing of ours to report: nothing happens.
    if (!/^(https?|file):/i.test(tab.url ?? '')) return null;
    return (await looksWrong({ frameId: 0, pageUrl: tab.url }, tab)) ? 'whole' : null;
  }
}

/** The chrome.commands listener (the shortcut; the owner can change its key at chrome://extensions/shortcuts). */
export async function onCommand(command: string, tab?: chrome.tabs.Tab | TabLike): Promise<string | null> {
  if (command !== BETA_COMMAND) return null;
  return startPick(tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]);
}

/**
 * A frame picked a spot, or the pick was cancelled or made whole: every frame ends its pick, the top one answers once the hint is
 * gone from the screen, and then the same report as the menu's is made (the picking frame, or the top one for the whole page).
 */
export async function pickDone(msg: { how?: unknown }, sender: chrome.runtime.MessageSender): Promise<string | null> {
  const tab = sender.tab;
  if (sender.id !== chrome.runtime.id || tab?.id === undefined || !['pick', 'whole', 'cancel'].includes(msg.how as string)) return null;
  const whole = msg.how === 'whole';
  try { await chrome.tabs.sendMessage(tab.id, { type: PICK_END_MSG, whole }); } catch { /* the tab has gone */ }
  if (msg.how === 'cancel') return null;
  return looksWrong({ frameId: whole ? 0 : sender.frameId ?? 0, pageUrl: tab.url, frameUrl: sender.url }, tab);
}

/** Messages of the pick: from the popup button (the popup page only) and from the content scripts. */
export function answerPickMessage(msg: { type?: unknown; how?: unknown; tabId?: unknown }, sender: chrome.runtime.MessageSender, reply: (r: unknown) => void): boolean {
  if (msg?.type === PICK_DONE_MSG) { void pickDone(msg, sender); return false; }
  if (msg?.type !== POPUP_PICK_MSG) return false;
  const fromPopup = sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL('/popup.html'));
  if (!fromPopup || typeof msg.tabId !== 'number') { reply({ state: null }); return false; }
  chrome.tabs.get(msg.tabId).then(startPick, () => null).then((state) => reply({ state }));
  return true;
}

/** Only the extension's own report page gets a report (it holds the screenshot); no other page or frame does. */
export function fromReportPage(sender: { id?: string; url?: string }): boolean {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL('/report.html'));
}

/** The report page asks for what the worker gathered. It is handed over once, then forgotten. */
export function answerReportRequest(msg: { type?: unknown; id?: unknown }, sender: { id?: string; url?: string }, reply: (r: unknown) => void): boolean {
  if (msg?.type !== GET_REPORT_MSG) return false;
  if (!fromReportPage(sender) || typeof msg.id !== 'string') { reply({ item: null }); return false; }
  const id = msg.id;
  const forget = () => chrome.storage.session.get(KEY).then((r) => ((r[KEY] as Pending | undefined)?.id === id ? chrome.storage.session.remove(KEY) : undefined)).catch(() => {});
  const mem = pending.get(id);
  if (mem) {
    pending.delete(id);
    reply({ item: mem });
    void forget();
    return false;
  }
  chrome.storage.session.get(KEY).then((r) => {
    const item = r[KEY] as Pending | undefined;
    const found = item && item.id === id ? item : null;
    reply({ item: found });
    if (found) void forget();
  }, () => reply({ item: null }));
  return true;
}
