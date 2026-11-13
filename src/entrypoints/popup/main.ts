import '../../ui/style.css';
import { el, restoreFocus, rememberFocus, twoPress } from '../../ui/dom';
import { DONATE_URL, MAKER_URL, RELEASES_URL } from '../../donate';
import { HIDDEN_GROUP_TEXT, PROTECT_TEXT, TEXT } from '../../text';
import { DEFAULT_SETTINGS, blackoutOn, blockingStatus, listVerdict, loadSettings, normalizeHost, normalizeSettings, patternChoices, patternLabel, saveSettings, settingsForUrl, groupDeciding, groupSwitchedOff, sitePicturesChoice, urlMatches, withSitePictures, type Settings, type SitePattern } from '../../settings';
import { cleanTally, describeTally, type HiddenTally } from '../../hidden';
import { builtinList, chooseList, loadMeta, savedList } from '../../list/store';
import { staleNotice } from '../../list/stale';
import { RELEASE_NOTES } from '../../text';
import { installKindOf, isNewerVersion, noteToShow, showUpdateSteps } from '../../versions';
import { BETA } from '../../beta-flag';
import { BETA_MENU_TITLE, POPUP_PICK_MSG } from '../../beta/strings';

const app = document.getElementById('app')!;
let moreOpen = false;
let updateOpen = false;
let countTimer = 0;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function tabHost(url?: string): string {
  try {
    const u = new URL(url ?? '');
    return u.protocol === 'http:' || u.protocol === 'https:' ? normalizeHost(u.hostname) : '';
  } catch {
    return '';
  }
}

/** "5:55 PM" today, otherwise the date too. Seconds say nothing here. */
const shortTime = (t: number) => {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};

async function render() {
  const focus = rememberFocus(app);
  const s = await loadSettings();
  const tab = await activeTab();
  const host = tabHost(tab?.url);
  const tabUrl = tab?.url ?? '';
  const now = Date.now();
  // Every Safe entry that covers this address; turning back on removes exactly these.
  const safeEntries = host ? s.allowSites.filter((p) => urlMatches(tabUrl, [p])) : [];
  // A site's own "never hide anything here" setting, under its longest matching name.
  const siteOffKeys = host ? Object.keys(s.sites).filter((k) => s.sites[k]!.off && (host === k || host.endsWith(`.${k}`))) : [];
  const offHere = !!host && s.enabled && !settingsForUrl(s, tabUrl).enabled;
  // Switched off for a group of sites (Livestream sites, YouTube): this site alone can be turned back on (its own off: false).
  const offGroup = host && !safeEntries.length && !siteOffKeys.length ? groupSwitchedOff(s, tabUrl) : undefined;

  const update = async (patch: Partial<Settings>) => {
    await saveSettings(normalizeSettings({ ...(await loadSettings()), ...patch }));
    await render();
  };

  const status = blockingStatus(s, now);
  const on = status.on && !offHere;
  const toggle = el('input', { type: 'checkbox', checked: s.enabled, class: 'switch', ariaLabel: TEXT.masterToggle });
  toggle.setAttribute('role', 'switch');
  toggle.addEventListener('change', () => update({ enabled: toggle.checked }));
  const head = el('div', { class: 'top' }, el('img', { src: chrome.runtime.getURL('/icon/32.PNG'), alt: '', width: 24, height: 24 }), el('h1', {}, TEXT.popupTitle), toggle);
  const statusLine = el('p', { class: `status ${on ? 'on' : 'off'}`, role: 'status' }, status.on && offHere ? (safeEntries.length && safeEntries.every((p) => p.kind === 'page') ? TEXT.masterOffPage : TEXT.masterOffHere) : status.text);

  const body: Node[] = [head, statusLine];
  // A list that has not updated for a day, or only the built-in one: say so, so a quiet failure is not mistaken for full cover.
  const saved = await savedList();
  const stale = staleNotice(await loadMeta(), chooseList(saved, builtinList()).savedInUse, now);
  if (stale) body.push(el('p', { class: 'warn stale', role: 'status' }, stale.kind === 'builtin' ? TEXT.listStale.builtin : stale.since ? TEXT.listStaleSince(shortTime(stale.since)) : TEXT.listStale.never));

  // What changed, once after an update; and a newer version, when the list says there is one.
  const version = chrome.runtime.getManifest().version;
  const note = noteToShow((await chrome.storage.local.get('whatsNew')).whatsNew, version, RELEASE_NOTES);
  if (note) {
    const gotIt = el('button', { class: 'wide' }, TEXT.whatsNew.dismiss);
    gotIt.addEventListener('click', async () => { await chrome.storage.local.remove('whatsNew'); await render(); });
    body.push(el('div', { class: 'whats-new', role: 'status' }, el('p', { class: 'mini-head' }, TEXT.whatsNewTitle(version)), el('ul', {}, ...note.map((t) => el('li', {}, t))), gotIt));
  }
  const latest = saved?.latest;
  if (isNewerVersion(latest, version)) {
    // (A call that throws, or an API that is missing, means the store text.)
    let installType: string | undefined;
    try { installType = (await chrome.management?.getSelf?.())?.installType; } catch { /* the store text */ }
    const kind = installKindOf(installType);
    body.push(el('p', { class: 'help update', role: 'status' }, TEXT.updateLine(latest!), ' ', TEXT.updateAvailable[kind]));
    if (showUpdateSteps(kind)) {
      const [before = '', after = ''] = TEXT.howToUpdate.step1.split('{link}');
      const a = el('a', { href: RELEASES_URL, target: '_blank', rel: 'noreferrer noopener' }, TEXT.howToUpdate.link);
      const how = el('details', { class: 'how-update', open: updateOpen }, el('summary', {}, TEXT.howToUpdate.button), el('ol', {}, el('li', {}, before, a, after), el('li', {}, TEXT.howToUpdate.step2), el('li', {}, TEXT.howToUpdate.step3)), el('p', { class: 'help' }, TEXT.howToUpdate.stay));
      how.addEventListener('toggle', () => (updateOpen = how.open));
      body.push(how);
    }
  }

  // Finished the story, or outside the set time: the switch can't help, so offer the way back here.
  if (s.enabled && !status.on && s.pausedUntil <= now) {
    const back = el('button', { class: 'primary wide' }, TEXT.hideAgain);
    back.addEventListener('click', () => update({ storyFinished: false, timerOff: true }));
    body.push(back);
  }

  if (s.pausedUntil > now) {
    const resume = el('button', { class: 'primary wide' }, TEXT.pauseResume);
    resume.addEventListener('click', () => update({ pausedUntil: 0 }));
    body.push(el('p', { class: 'help' }, TEXT.pausedUntil(shortTime(s.pausedUntil))), resume);
  }

  // Count of hidden items on this page, asked of the page's own script. Asked again while open: a scan may still be running.
  const count = el('p', { class: 'count', role: 'status' }, '');
  const kinds = el('p', { class: 'help', id: 'hidden-kinds' }, '');
  const reveal = el('button', { hidden: true, class: 'wide' }, TEXT.revealAll);
  twoPress(reveal, TEXT.revealAll, TEXT.revealConfirm, async () => {
    reveal.hidden = true;
    if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { type: 'revealAll' }).catch(() => {});
    count.textContent = TEXT.hidden(0);
    kinds.textContent = '';
  });
  window.clearInterval(countTimer);
  if (tab?.id != null && on) {
    const cannot = () => {
      count.textContent = TEXT.cannotCheck;
      count.className = 'help';
      reveal.hidden = true;
    };
    const show = (n: number, groups: HiddenTally = {}) => {
      count.textContent = TEXT.hidden(n);
      kinds.textContent = describeTally(groups, HIDDEN_GROUP_TEXT);
      reveal.hidden = n === 0;
    };
    const tabId = tab.id;
    const ask = () =>
      chrome.runtime
        .sendMessage({ type: 'getPageCount', tabId })
        .then(async (r: { count: number; groups?: unknown }) => {
          if (r.count > 0) return show(r.count, cleanTally(r.groups));
          // Zero may mean the worker restarted and forgot: ask the page's top frame directly.
          const top = (await chrome.tabs.sendMessage(tabId, { type: 'getCount' }, { frameId: 0 }).catch(() => undefined)) as
            | { count?: number; groups?: unknown }
            | undefined;
          if (top === undefined) return show(0); // the page has no content script (not reloaded since install)
          show(Math.max(r.count, top.count ?? 0), cleanTally(top.groups));
        })
        .catch(cannot);
    if (!/^https?:/i.test(tab.url ?? '')) cannot();
    else {
      void ask();
      countTimer = window.setInterval(ask, 1000);
    }
    // The page is read with the general rules because the site's layout seems to have changed (src/adapters/stale.ts).
    const layout = el('p', { class: 'help', hidden: true }, TEXT.layoutChanged);
    if (tab.id != null) void chrome.tabs.sendMessage(tab.id, { type: 'askGeneric' }, { frameId: 0 }).then((r: { generic?: boolean } | undefined) => { layout.hidden = !r?.generic; }).catch(() => {});
    body.push(count, kinds, reveal, layout);
  }

  // How much to hide, without opening a new tab. Custom only shows for someone who already chose it.
  if (on) {
    const pick = el('select', { ariaLabel: TEXT.protect.name });
    for (const k of ['big', 'story', 'all', ...(s.protect === 'custom' ? ['custom'] as const : [])] as const) pick.append(el('option', { value: k, selected: s.protect === k }, PROTECT_TEXT[k].name));
    pick.addEventListener('change', () => {
      if (pick.value !== 'custom') void update({ protect: pick.value as Settings['protect'], kindModes: undefined as never, rareNames: DEFAULT_SETTINGS.rareNames });
    });
    body.push(el('label', { class: 'field' }, el('span', {}, TEXT.protect.name), pick));
  }

  // This site: one click for the usual choice, the narrower ones folded away.
  if (host && (safeEntries.length || siteOffKeys.length)) {
    const resume = el('button', { class: 'wide' }, TEXT.safeResume);
    resume.addEventListener('click', () => update({
      allowSites: s.allowSites.filter((p) => !safeEntries.includes(p)),
      sites: Object.fromEntries(Object.entries(s.sites).map(([k, o]) => [k, siteOffKeys.includes(k) ? { ...o, off: undefined } : o])),
    }));
    body.push(el('hr'), ...safeEntries.map((p) => el('p', { class: 'safe-why help' }, TEXT.safeWhy(p.kind, patternLabel(p)))), resume);
  } else if (host && offGroup) {
    // The site entry that already applies to the host (the longest matching name), or a new one.
    const key = Object.keys(s.sites).filter((k) => host === k || host.endsWith(`.${k}`)).sort((a, b) => b.length - a.length)[0] ?? host;
    const resume = el('button', { class: 'wide' }, TEXT.sitePictures.groupOffResume);
    resume.addEventListener('click', () => update({ sites: { ...s.sites, [key]: { ...s.sites[key], off: false } } }));
    const note = el('p', { class: 'help group-off' }, TEXT.sitePictures.groupOff.replace('{group}', TEXT.sitePictures.groups[offGroup]));
    body.push(el('hr'), note, resume);
  } else if (host) {
    const choices = patternChoices(tabUrl).slice(0, 4);
    const whole = choices[choices.length - 1]!;
    const off = el('button', { class: 'wide' }, TEXT.offOnSite(patternLabel(whole)));
    off.addEventListener('click', () => update({ allowSites: [...s.allowSites, whole] }));
    body.push(el('hr'), off);
    const narrower = choices.slice(0, -1);
    if (narrower.length) {
      const pick = el('div', { class: 'mark-safe', role: 'group', ariaLabel: TEXT.moreChoices });
      for (const p of narrower) {
        const b = el('button', { title: patternLabel(p) }, el('b', {}, TEXT.siteChoice[p.kind]), el('code', {}, patternLabel(p)));
        b.addEventListener('click', () => update({ allowSites: [...s.allowSites, p] }));
        pick.append(b);
      }
      const more = el('details', { open: moreOpen }, el('summary', {}, TEXT.moreChoices), pick);
      more.addEventListener('toggle', () => (moreOpen = more.open));
      body.push(more);
    }
    if (listVerdict(s, tabUrl) === 'strict') {
      const hit = s.blockSites.find((p: SitePattern) => urlMatches(tabUrl, [p]));
      if (hit) body.push(el('p', { class: 'help' }, TEXT.strictHere(patternLabel(hit))));
    }
  }

  // Pictures on this site in one tap: covered, shown, or the usual settings. settings.ts SITE_PICTURES says what each one sets.
  if (host && on) {
    const picked = sitePicturesChoice(s, host);
    const group = el('div', { class: 'chips site-pictures', role: 'radiogroup', ariaLabel: TEXT.sitePictures.name });
    for (const c of ['covered', 'shown', 'same'] as const) {
      const r = el('input', { type: 'radio', name: 'site-pictures', value: c, checked: picked === c });
      r.addEventListener('change', async () => update({ sites: withSitePictures(await loadSettings(), host, c) }));
      group.append(el('label', { class: 'chip' }, r, ` ${TEXT.sitePictures[c]}`));
    }
    body.push(el('p', { class: 'mini-head' }, TEXT.sitePictures.name), group, el('p', { class: 'help' }, TEXT.sitePictures.help));
    if (picked === 'mixed') body.push(el('p', { class: 'help' }, TEXT.sitePictures.mixed));
    // A group (Livestream sites, YouTube) decides some of the pictures here: say which, as the choice above is for this site only.
    const decider = groupDeciding(s, tabUrl);
    if (decider) {
      const note = el('p', { class: 'help site-pictures-group' }, TEXT.sitePictures.fromGroup.replace('{group}', TEXT.sitePictures.groups[decider]));
      note.dataset.group = decider;
      body.push(note);
    }
    if (blackoutOn(s, chooseList(saved, builtinList()).list.release, now)) body.push(el('p', { class: 'help' }, TEXT.sitePictures.blackout));
  }

  // Pause everywhere for a while. Hiding comes back by itself when the time is up.
  if (s.enabled && s.pausedUntil <= now && status.on) {
    const row = el('div', { class: 'add', role: 'group', ariaLabel: TEXT.pauseName });
    const tomorrow = () => {
      const d = new Date();
      d.setHours(24, 0, 0, 0);
      return d.getTime();
    };
    for (const [label, until] of [[TEXT.pause15, () => Date.now() + 15 * 60_000], [TEXT.pause60, () => Date.now() + 3_600_000], [TEXT.pauseTomorrow, tomorrow]] as const) {
      const b = el('button', {}, label);
      b.addEventListener('click', () => update({ pausedUntil: until() }));
      row.append(b);
    }
    body.push(el('p', { class: 'mini-head' }, TEXT.pauseName), row);
  }

  // Beta only: "This looks wrong" for pages that replace the right-click menu (the page then waits for a click on the wrong part).
  if (BETA) {
    const wrong = el('button', { class: 'wide' }, BETA_MENU_TITLE);
    wrong.addEventListener('click', async () => {
      const t = await activeTab();
      if (t?.id == null) return;
      await chrome.runtime.sendMessage({ type: POPUP_PICK_MSG, tabId: t.id }).catch(() => {});
      window.close();
    });
    body.push(el('hr'), wrong);
  }

  const open = el('button', {}, TEXT.openSettings);
  open.addEventListener('click', () => chrome.runtime.openOptionsPage());
  const out = (href: string, text: string) => el('a', { href, target: '_blank', rel: 'noreferrer noopener' }, text);
  body.push(el('hr'), el('div', { class: 'foot' }, open, el('div', { class: 'foot-links' }, out(DONATE_URL, TEXT.donate.link), out(MAKER_URL, TEXT.donate.own))));

  app.className = 'pop';
  app.replaceChildren(...body);
  restoreFocus(app, focus);
}

void render();
