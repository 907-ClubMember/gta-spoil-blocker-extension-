// The right-click menu: "Hide this on every page", the never-hide items, and "Pictures on this site" with its three radios.
// A radio click writes the tab's site entry (settings.ts withSitePictures); the radios show what that site is set to now.
import { betaMenuItem } from './beta/background';
import { neverHideMenus } from './never-hide';
import { groupDeciding, loadSettings, normalizeHost, normalizeSettings, saveSettings, sitePicturesChoice, withSitePictures, type Settings, type SitePictures } from './settings';
import { TEXT } from './text';

export const HIDE_SELECTION = 'hide-selection';
export const PICS = 'gsb-pics';
/** The three choices, by menu id. */
export const PICS_CHOICES: Record<string, SitePictures> = { 'gsb-pics-shown': 'shown', 'gsb-pics-covered': 'covered', 'gsb-pics-same': 'same' };
/** Shown only while the site has its own mix of picture settings (see refreshMenu). */
export const PICS_MIXED = 'gsb-pics-mixed';

type MenuItem = chrome.contextMenus.CreateProperties & { id: string };

/** The store build's items, in order. */
export function storeMenuItems(): MenuItem[] {
  const m = TEXT.sitePictures.menu;
  return [
    { id: HIDE_SELECTION, title: 'Hide this on every page', contexts: ['selection'] },
    ...neverHideMenus(),
    { id: PICS, title: m.title, contexts: ['image', 'video', 'page'] },
    { id: 'gsb-pics-shown', parentId: PICS, type: 'radio', title: m.show, contexts: ['image', 'video', 'page'], checked: false },
    { id: 'gsb-pics-covered', parentId: PICS, type: 'radio', title: m.cover, contexts: ['image', 'video', 'page'], checked: false },
    { id: 'gsb-pics-same', parentId: PICS, type: 'radio', title: m.same, contexts: ['image', 'video', 'page'], checked: true },
  ];
}

/**
 * The full ordered list: the store items, then the beta item last in the beta build. Tests read it; the background creates
 * storeMenuItems() and then calls registerMenu() under BETA itself, so the beta words stay out of the store build.
 */
export function menuItems(beta: boolean): MenuItem[] {
  return [...storeMenuItems(), ...(beta ? [betaMenuItem() as MenuItem] : [])];
}

/** A radio click: the tab's site gets that choice. Returns the saved settings, or undefined when nothing was saved. `pageUrl` is the tab's page (the click's own, else the one its top frame told). */
export async function savePicsClick(menuItemId: string | number, pageUrl: string | undefined): Promise<Settings | undefined> {
  const choice = PICS_CHOICES[String(menuItemId)];
  const host = normalizeHost(pageUrl ?? '');
  if (!choice || !host || !/^https?:/i.test(pageUrl ?? '')) return undefined;
  const s = await loadSettings();
  const next = normalizeSettings({ ...s, sites: withSitePictures(s, host, choice) });
  await saveSettings(next);
  return next;
}

/**
 * The radios follow the active tab's site. Chrome keeps one radio of a group checked (it checks the first one when none is), so
 * "none checked" cannot be shown for a site with its own mix, or an unknown page. Then a disabled fourth radio "Own mix (see
 * Settings)" is added right after the three (adjacent radios form one group) and checked; it goes again once the site matches a
 * choice. A site with no picture choice of its own shows its group's (Livestream sites, YouTube); a click still writes the site.
 * An unknown address (the worker has not been told it yet) leaves the radios as they are.
 * An update can come before the items exist (the worker started before onInstalled made them): lastError is read and ignored.
 */
export function refreshMenu(pageUrl: string | undefined, s: Settings): void {
  const host = /^https?:/i.test(pageUrl ?? '') ? normalizeHost(pageUrl!) : '';
  if (!host) return;
  let choice = sitePicturesChoice(s, host);
  const group = choice === 'same' ? groupDeciding(s, pageUrl!) : undefined;
  if (group) choice = sitePicturesChoice(s, { group });
  const done = () => void chrome.runtime.lastError;
  try {
    if (choice === 'mixed') {
      // Already there (made for another tab, or before the worker restarted): the create fails, so check it instead.
      const props: chrome.contextMenus.CreateProperties = { parentId: PICS, type: 'radio', title: TEXT.sitePictures.menu.mixed, contexts: ['image', 'video', 'page'], enabled: false };
      chrome.contextMenus.create({ id: PICS_MIXED, ...props, checked: true }, () => {
        if (chrome.runtime.lastError) chrome.contextMenus.update(PICS_MIXED, { checked: true }, done);
      });
      return;
    }
    // Not there is fine.
    chrome.contextMenus.remove(PICS_MIXED, done);
    for (const [id, c] of Object.entries(PICS_CHOICES)) chrome.contextMenus.update(id, { checked: c === choice }, done);
  } catch {
    /* no menu here */
  }
}
