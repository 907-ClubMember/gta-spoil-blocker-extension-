import { UPDATE_MINUTES, blockingStatus, timerNextChange, loadSettings, normalizeSettings, saveSettings } from '../settings';
import { describeResult, updateList } from '../list/store';
import { FrameCounts } from '../frames';
import { cleanTally } from '../hidden';

const ALARM = 'list-update';
const MENU = 'hide-selection';

async function scheduleAlarm() {
  const s = await loadSettings();
  const minutes = UPDATE_MINUTES[s.updateEvery];
  await chrome.alarms.clear(ALARM);
  if (minutes) await chrome.alarms.create(ALARM, { periodInMinutes: minutes, delayInMinutes: 1 });
}

const BADGE_ALARM = 'gsb-badge';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL('/welcome.html') });
    chrome.contextMenus.create({
      id: MENU,
      title: 'Hide this on every page',
      contexts: ['selection'],
    });
    // The first download comes from the update timer a minute later, and never under "Only when I press" (the privacy page
    // promises that); a list ships inside the extension, so nothing is missing meanwhile.
    void scheduleAlarm();
  });

  chrome.runtime.onStartup.addListener(() => {
    void scheduleAlarm();
  });

  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) void updateList(false);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) void scheduleAlarm();
  });

  chrome.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId !== MENU || !info.selectionText) return;
    const s = await loadSettings();
    const word = info.selectionText.trim().slice(0, 80);
    if (!word) return;
    await saveSettings(normalizeSettings({ ...s, customWords: [...s.customWords, word] }));
  });

  // OFF on the icon for every tab while nothing is being hidden; tabs with a count of their own follow in showBadge.
  const showOff = async () => {
    const off = !blockingStatus(await loadSettings(), Date.now()).on;
    await chrome.action.setBadgeText({ text: off ? 'OFF' : '' });
    if (off) await chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
    // A pause or a set time ends with no settings change: look again then.
    const s = await loadSettings();
    const ends = [s.pausedUntil, timerNextChange(s, Date.now()) ?? 0].filter((t) => t > Date.now());
    if (ends.length) await chrome.alarms.create(BADGE_ALARM, { when: Math.min(...ends) + 1000 });
  };
  void showOff();
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === BADGE_ALARM) void showOff();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) void showOff();
  });

  // The toolbar count: how many items are hidden in a tab. Off when the user does not want a number there.
  const showBadge = async (tabId: number) => {
    try {
      const s = await loadSettings();
      const n = frameCounts.total(tabId);
      // OFF always shows, whatever the count setting: a forgotten switch can spoil someone.
      const off = !blockingStatus(s, Date.now()).on;
      await chrome.action.setBadgeText({ tabId, text: off ? 'OFF' : s.showBadge && n > 0 ? String(n > 99 ? '99+' : n) : '' });
      if (off || (s.showBadge && n > 0)) await chrome.action.setBadgeBackgroundColor({ tabId, color: off ? '#6b7280' : '#c2410c' });
    } catch {
      /* the tab has gone */
    }
  };

  // Whether each tab's top page is about the game, told by its top frame and relayed to the frames inside it.
  const pageAbout = new Map<number, boolean>();
  // The address of each tab's top page, told by its top frame (the extension has no permission to read tab addresses itself).
  const pageUrl = new Map<number, string>();
  const webUrl = (u: unknown): u is string => typeof u === 'string' && u.length <= 2000 && /^https?:\/\//i.test(u);
  const frameCounts = new FrameCounts();
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'gsb-count') return;
    const tabId = port.sender?.tab?.id;
    const frameId = port.sender?.frameId;
    if (tabId === undefined || frameId === undefined) return;
    port.onMessage.addListener((msg: { count?: unknown; groups?: unknown }) => {
      if (typeof msg?.count !== 'number') return;
      frameCounts.set(tabId, frameId, msg.count, cleanTally(msg.groups));
      void showBadge(tabId);
    });
    port.onDisconnect.addListener(() => {
      frameCounts.dropFrame(tabId, frameId);
      void showBadge(tabId);
    });
  });

  chrome.tabs.onRemoved.addListener((id) => {
    pageAbout.delete(id);
    pageUrl.delete(id);
    frameCounts.dropTab(id);
  });
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (info.url || info.status === 'loading') pageAbout.delete(id);
    // A new page load: the old address must not be handed to a frame that starts before the new top page reports.
    if (info.status === 'loading') pageUrl.delete(id);
  });

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    const tabId = sender.tab?.id;
    if (msg?.type === 'pageAbout' && tabId !== undefined && sender.frameId === 0) {
      const about = msg.about === true;
      pageAbout.set(tabId, about);
      try {
        chrome.tabs.sendMessage(tabId, { type: 'pageAbout', about }).catch(() => {});
      } catch {
        /* the tab has gone */
      }
      return false;
    }
    if (msg?.type === 'pageUrl' && tabId !== undefined && sender.frameId === 0) {
      if (!webUrl(msg.url)) return false;
      pageUrl.set(tabId, msg.url);
      try {
        chrome.tabs.sendMessage(tabId, { type: 'pageUrl', url: msg.url }).catch(() => {});
      } catch {
        /* the tab has gone */
      }
      return false;
    }
    if (msg?.type === 'tabUrl') {
      // A frame asks which page it sits in, so Safe and Strict entries follow the page, not the frame.
      if (tabId === undefined) return void reply({});
      const known = pageUrl.get(tabId) ?? (webUrl(sender.tab?.url) ? sender.tab.url : undefined);
      if (known) return void reply({ url: known });
      chrome.tabs.sendMessage(tabId, { type: 'askPageUrl' }, { frameId: 0 }).then(
        (r: { url?: unknown } | undefined) => {
          if (webUrl(r?.url)) pageUrl.set(tabId, r.url);
          reply({ url: webUrl(r?.url) ? r.url : undefined });
        },
        () => reply({}),
      );
      return true;
    }
    if (msg?.type === 'isPageAbout') {
      if (tabId === undefined) return void reply({ about: false });
      const known = pageAbout.get(tabId);
      if (known !== undefined) return void reply({ about: known });
      // Nothing remembered (the worker restarted, or the page changed): ask the top frame itself.
      chrome.tabs.sendMessage(tabId, { type: 'askPageAbout' }, { frameId: 0 }).then(
        (r: { about?: boolean } | undefined) => {
          const about = r?.about === true;
          pageAbout.set(tabId, about);
          reply({ about });
        },
        () => reply({ about: false }),
      );
      return true;
    }
    if (msg?.type === 'getPageCount') {
      reply(typeof msg.tabId === 'number' ? { count: frameCounts.total(msg.tabId), groups: frameCounts.groups(msg.tabId) } : { count: 0, groups: {} });
      return false;
    }
    if (msg?.type !== 'updateNow') return false;
    updateList(true).then((r) => reply({ result: r, text: describeResult(r) }));
    return true; // keep the channel open for the async reply
  });
});
