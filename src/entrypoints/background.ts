import { blockingStatus, timerNextChange, loadSettings, normalizeSettings, saveSettings } from '../settings';
import { activeList, builtinList, describeResult, updateList } from '../list/store';
import { ALARM, scheduleAlarm, startUpdates } from '../list/timer';
import { FrameCounts } from '../frames';
import { cleanTally } from '../hidden';
import { NEVER_HIDE_REFUSED, clickTerms, neverHideClick, serialQueue } from '../never-hide';
import { HIDE_SELECTION, PICS_CHOICES, refreshMenu, savePicsClick, storeMenuItems } from '../site-pictures-menu';
import { TEXT } from '../text';
import { BETA } from '../beta-flag';
import { isNewerVersion } from '../versions';
import { isSettingAnchor } from '../reason-settings';
import { BETA_BADGE_COLOR, BETA_BADGE_TEXT, GET_REPORT_MSG, PICK_DONE_MSG, POPUP_PICK_MSG } from '../beta/strings';
import { BETA_MENU_ID, answerPickMessage, answerReportRequest, hooks, looksWrong, onCommand, registerMenu, showBetaBadge } from '../beta/background';

const MENU = HIDE_SELECTION;

const BADGE_ALARM = 'gsb-badge';
// What the icon says when nothing else needs saying: nothing in the store build, BETA in the beta build.
const IDLE_BADGE = BETA ? BETA_BADGE_TEXT : '';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL('/welcome.html') });
    // After an update the popup says what is new, once (it shows only for a version that has release notes).
    const to = chrome.runtime.getManifest().version;
    if (details.reason === 'update' && isNewerVersion(to, details.previousVersion)) void chrome.storage.local.set({ whatsNew: { from: details.previousVersion, to } });
    // Cleared first, so an update never trips over the items it made last time.
    chrome.contextMenus.removeAll(() => {
      for (const m of storeMenuItems()) chrome.contextMenus.create(m);
      // The beta item comes last (site-pictures-menu.ts menuItems).
      if (BETA) registerMenu();
      void refreshPics();
    });
    // The list is downloaded right away, and never under "Only when I press" (the privacy page promises that); if that
    // fails, the list inside the extension stays in use and the update timer tries again a minute later.
    startUpdates().catch(() => {});
  });

  // Downloads at browser start only while no list is saved yet; later updates come from the timer.
  chrome.runtime.onStartup.addListener(() => {
    startUpdates().catch(() => {});
  });

  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) void updateList(false);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) void scheduleAlarm();
  });

  // Every read-change-save of the settings here goes through one queue, so two quick clicks never lose a word.
  const settingsWrite = serialQueue();

  chrome.contextMenus.onClicked.addListener((info, tab) => settingsWrite(async () => {
    if (BETA && info.menuItemId === BETA_MENU_ID) return void looksWrong(info, tab);
    if (info.menuItemId !== MENU || !info.selectionText) return;
    const s = await loadSettings();
    const word = info.selectionText.trim().slice(0, 80);
    if (!word) return;
    await saveSettings(normalizeSettings({ ...s, customWords: [...s.customWords, word] }));
  }));

  // "Never hide this": the selection or the link comes with the click itself. A check mark on the icon says it was added.
  // The game's own name is refused (a cross on the icon, the reason in its tooltip and on the options page).
  chrome.contextMenus.onClicked.addListener((info, tab) => settingsWrite(async () => {
    const s = await loadSettings();
    const done = neverHideClick(info, await clickTerms(info, activeList, builtinList), s);
    if (!done) return;
    if ('refused' in done) {
      await chrome.storage.local.set({ [NEVER_HIDE_REFUSED]: { at: Date.now() } });
      if (tab?.id !== undefined) void flashRefused(tab.id);
      return;
    }
    await saveSettings(normalizeSettings({ ...s, ...done.save }));
    if (tab?.id !== undefined) void flashDone(tab.id);
  }));

  // "Pictures on this site": the tab's site gets the choice, then a check mark on the icon.
  chrome.contextMenus.onClicked.addListener((info, tab) => settingsWrite(async () => {
    if (!(String(info.menuItemId) in PICS_CHOICES)) return;
    // The click tells the page's address: kept, so the radios can show this site again after a worker restart.
    if (tab?.id !== undefined && webUrl(info.pageUrl)) rememberPageUrl(tab.id, info.pageUrl);
    const url = info.pageUrl ?? (tab?.id !== undefined ? pageUrl.get(tab.id) : undefined);
    const saved = await savePicsClick(info.menuItemId, url);
    if (!saved) return;
    refreshMenu(url, saved);
    if (tab?.id !== undefined) void flashDone(tab.id);
  }));

  // The picture radios show the focused window's active tab's site (its address as its top frame told it: no permission to read
  // tab addresses).
  let activeTab: number | undefined;
  let focusedWindow: number | undefined;
  const refreshPics = async () => {
    await restored;
    try {
      if (activeTab === undefined) {
        const t = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
        activeTab = t?.id;
        focusedWindow = t?.windowId;
      }
    } catch {
      /* no tab */
    }
    refreshMenu(activeTab !== undefined ? pageUrl.get(activeTab) : undefined, await loadSettings());
  };
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    // A tab switched in a window behind the focused one: the menu still belongs to the focused window.
    if (focusedWindow !== undefined && windowId !== focusedWindow) return;
    activeTab = tabId;
    focusedWindow = windowId;
    void refreshPics();
  });
  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    focusedWindow = windowId;
    try {
      activeTab = (await chrome.tabs.query({ active: true, windowId }))[0]?.id;
    } catch {
      /* the window has gone */
    }
    void refreshPics();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) void refreshPics();
  });

  // OFF on the icon for every tab while nothing is being hidden; tabs with a count of their own follow in showBadge.
  const showOff = async () => {
    const off = !blockingStatus(await loadSettings(), Date.now()).on;
    await chrome.action.setBadgeText({ text: off ? 'OFF' : IDLE_BADGE });
    if (off) await chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
    else if (BETA) await chrome.action.setBadgeBackgroundColor({ color: BETA_BADGE_COLOR });
    // A pause or a set time ends with no settings change: look again then.
    const s = await loadSettings();
    const ends = [s.pausedUntil, timerNextChange(s, Date.now()) ?? 0].filter((t) => t > Date.now());
    if (ends.length) await chrome.alarms.create(BADGE_ALARM, { when: Math.min(...ends) + 1000 });
  };
  if (BETA) {
    showBetaBadge();
    (globalThis as { __gsbBeta?: unknown }).__gsbBeta = { looksWrong, hooks, onCommand };
    // The shortcut (declared in the beta manifest only, wxt.config.ts) starts a pick, as the popup button does.
    chrome.commands.onCommand.addListener((command, tab) => void onCommand(command, tab));
  }
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
      await chrome.action.setBadgeText({ tabId, text: off ? 'OFF' : s.showBadge && n > 0 ? String(n > 99 ? '99+' : n) : IDLE_BADGE });
      // Back to the BETA colour when the count or OFF goes (the tab keeps the last colour set for it otherwise).
      const color = off ? '#6b7280' : s.showBadge && n > 0 ? '#c2410c' : BETA ? BETA_BADGE_COLOR : null;
      if (color) await chrome.action.setBadgeBackgroundColor({ tabId, color });
    } catch {
      /* the tab has gone */
    }
  };

  // A check mark on the icon for a moment, then the usual count or OFF again.
  const flashDone = async (tabId: number) => {
    try {
      await chrome.action.setBadgeText({ tabId, text: '✓' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#15803d' });
    } catch {
      return; /* the tab has gone */
    }
    setTimeout(() => void showBadge(tabId), 1500);
  };

  // A cross on the icon for a moment, and the reason in its tooltip a little longer (no pop-up needs a permission).
  const flashRefused = async (tabId: number) => {
    try {
      await chrome.action.setBadgeText({ tabId, text: '✗' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#b91c1c' });
      await chrome.action.setTitle({ tabId, title: TEXT.allowWords.refused });
    } catch {
      return; /* the tab has gone */
    }
    setTimeout(() => void showBadge(tabId), 2000);
    // Then back to the tooltip every other tab shows.
    setTimeout(() => void chrome.action.getTitle({}).then((title) => chrome.action.setTitle({ tabId, title })).catch(() => {}), 15_000);
  };

  // Whether each tab's top page is about the game, told by its top frame and relayed to the frames inside it.
  const pageAbout = new Map<number, boolean>();
  // The address of each tab's top page, told by its top frame (the extension has no permission to read tab addresses itself).
  const pageUrl = new Map<number, string>();
  const webUrl = (u: unknown): u is string => typeof u === 'string' && u.length <= 2000 && /^https?:\/\//i.test(u);
  // Kept in session storage too (cleared when the browser closes), so a restarted worker still knows the open tabs' addresses.
  const savePageUrls = () => {
    try {
      chrome.storage.session.set({ pageUrls: Object.fromEntries(pageUrl) }).catch(() => {});
    } catch {
      /* no session storage here */
    }
  };
  const rememberPageUrl = (tabId: number, url: string) => {
    pageUrl.set(tabId, url);
    savePageUrls();
  };
  const forgetPageUrl = (tabId: number) => {
    if (pageUrl.delete(tabId)) savePageUrls();
  };
  const restored = (async () => {
    try {
      const got = (await chrome.storage.session.get('pageUrls')).pageUrls as Record<string, unknown> | undefined;
      for (const [k, v] of Object.entries(got ?? {})) if (!pageUrl.has(Number(k)) && webUrl(v)) pageUrl.set(Number(k), v);
    } catch {
      /* none kept */
    }
  })();
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
    forgetPageUrl(id);
    frameCounts.dropTab(id);
  });
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (info.url || info.status === 'loading') pageAbout.delete(id);
    // A new page load: the old address must not be handed to a frame that starts before the new top page reports.
    if (info.status === 'loading') forgetPageUrl(id);
    if (id === activeTab && (info.url || info.status === 'complete')) void refreshPics();
  });

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (BETA && msg?.type === GET_REPORT_MSG) return answerReportRequest(msg, sender, reply);
    if (BETA && (msg?.type === PICK_DONE_MSG || msg?.type === POPUP_PICK_MSG)) return answerPickMessage(msg, sender, reply);
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
      rememberPageUrl(tabId, msg.url);
      if (tabId === activeTab) void refreshPics();
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
          if (webUrl(r?.url)) rememberPageUrl(tabId, r.url);
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
    // A cover's "Change this": the options page opens at the setting that decides that kind of cover (only a place we know is taken).
    if (msg?.type === 'openSetting' && sender.id === chrome.runtime.id) {
      if (isSettingAnchor(msg.anchor)) void chrome.storage.local.set({ optionsAnchor: msg.anchor }).then(() => chrome.runtime.openOptionsPage());
      return false;
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
