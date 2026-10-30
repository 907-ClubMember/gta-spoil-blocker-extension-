import '../../ui/style.css';
import { el } from '../../ui/dom';
import { DONATE_URL } from '../../donate';
import { HIDDEN_GROUP_TEXT, TEXT } from '../../text';
import { blockingStatus, isSuspended, listVerdict, loadSettings, normalizeHost, normalizeSettings, patternChoices, patternLabel, saveSettings, urlMatches, type Settings, type SitePattern } from '../../settings';
import { cleanTally, describeTally, type HiddenTally } from '../../hidden';
import { activeList, loadMeta } from '../../list/store';

const app = document.getElementById('app')!;

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

async function render() {
  const s = await loadSettings();
  const tab = await activeTab();
  const host = tabHost(tab?.url);
  const tabUrl = tab?.url ?? '';
  // Every Safe entry that covers this address; Resume removes exactly these.
  const safeEntries = host ? s.allowSites.filter((p) => urlMatches(tabUrl, [p])) : [];

  const update = async (patch: Partial<Settings>) => {
    await saveSettings(normalizeSettings({ ...s, ...patch }));
    await render();
  };

  const toggle = el('input', { type: 'checkbox', checked: s.enabled });
  toggle.addEventListener('change', () => update({ enabled: toggle.checked }));
  const status = blockingStatus(s, Date.now());
  const master = el(
    'label',
    { class: 'row' },
    toggle,
    el('span', {}, el('b', {}, TEXT.masterToggle), el('span', { class: `status ${status.on ? 'on' : 'off'}` }, status.text)),
  );

  // Count of hidden items on this page, asked of the page's own script.
  const count = el('p', { class: 'help' }, '');
  const kinds = el('p', { class: 'help', id: 'hidden-kinds' }, '');
  const reveal = el('button', {}, TEXT.revealAll);
  reveal.addEventListener('click', async () => {
    if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { type: 'revealAll' }).catch(() => {});
    count.textContent = TEXT.hidden(0);
    kinds.textContent = '';
  });
  if (tab?.id != null) {
    const cannot = () => {
      count.textContent = 'This page cannot be checked (browser pages and the web store are off limits).';
      reveal.disabled = true;
    };
    const show = (n: number, groups: HiddenTally = {}) => {
      count.textContent = TEXT.hidden(n);
      kinds.textContent = describeTally(groups, HIDDEN_GROUP_TEXT);
      reveal.disabled = n === 0;
    };
    const tabId = tab.id;
    if (!/^https?:/i.test(tab.url ?? '')) cannot();
    else
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
  }

  const card = el('div', { class: 'card' }, master, el('p', { class: 'help', id: 'protect-line' }, TEXT.protectNow(s.protect)), count, kinds, reveal);

  const siteCard = el('div', { class: 'card' });
  if (host && safeEntries.length) {
    const resume = el('button', { class: 'primary' }, TEXT.safeResume);
    resume.addEventListener('click', () => update({ allowSites: s.allowSites.filter((p) => !safeEntries.includes(p)) }));
    siteCard.append(
      ...safeEntries.map((p) => el('p', { class: 'safe-why' }, el('b', {}, TEXT.safeWhy(p.kind, patternLabel(p))))),
      el('p', { class: 'help' }, TEXT.safeResumeHelp),
      resume,
    );
  } else if (host) {
    const pick = el('div', { class: 'mark-safe', role: 'group', ariaLabel: TEXT.markSafe });
    // patternChoices is page first, then up to two parts, then the whole site: at most four.
    for (const p of patternChoices(tabUrl).slice(0, 4)) {
      const b = el('button', {}, el('b', {}, TEXT.siteChoice[p.kind]), el('code', {}, patternLabel(p)));
      b.addEventListener('click', () => update({ allowSites: [...s.allowSites, p] }));
      pick.append(b);
    }
    siteCard.append(el('p', {}, el('b', {}, TEXT.markSafe)), el('p', { class: 'help' }, TEXT.markSafeHelp), pick);
    if (listVerdict(s, tabUrl) === 'strict') {
      const hit = s.blockSites.find((p: SitePattern) => urlMatches(tabUrl, [p]));
      if (hit) siteCard.append(el('p', { class: 'help' }, TEXT.strictHere(patternLabel(hit))));
    }
    siteCard.append(el('p', { class: 'help' }, TEXT.strictInOptions));
  }

  // Pause everywhere for a while. Hiding comes back by itself when the time is up.
  const pauseCard = el('div', { class: 'card' });
  if (isSuspended(s, Date.now()) && s.pausedUntil > Date.now()) {
    const back = el('button', {}, 'Resume now');
    back.addEventListener('click', () => update({ pausedUntil: 0 }));
    pauseCard.append(el('p', {}, `Paused until ${new Date(s.pausedUntil).toLocaleString()}.`), back);
  } else {
    const row = el('div', { class: 'add' });
    const tomorrow = () => {
      const d = new Date();
      d.setHours(24, 0, 0, 0);
      return d.getTime();
    };
    for (const [label, until] of [['15 minutes', () => Date.now() + 15 * 60_000], ['1 hour', () => Date.now() + 3_600_000], ['Until tomorrow', tomorrow]] as const) {
      const b = el('button', {}, label);
      b.addEventListener('click', () => update({ pausedUntil: until() }));
      row.append(b);
    }
    pauseCard.append(el('p', {}, el('b', {}, 'Pause everywhere')), row, el('p', { class: 'help' }, 'Nothing is hidden until the time is up, then blocking comes back by itself.'));
  }

  const [list, meta] = await Promise.all([activeList(), loadMeta()]);
  const msg = el('p', { class: 'msg help' }, '');
  const upBtn = el('button', { class: 'primary' }, TEXT.updates.button);
  upBtn.addEventListener('click', async () => {
    upBtn.disabled = true;
    msg.textContent = 'Checking for new spoilers...';
    try {
      const r = (await chrome.runtime.sendMessage({ type: 'updateNow' })) as { text: string };
      msg.textContent = r.text;
    } catch {
      msg.textContent = 'Could not check right now.';
    }
    upBtn.disabled = false;
  });
  const when = meta.checkedAt ? `Last checked ${new Date(meta.checkedAt).toLocaleString()}.` : 'Not checked yet.';
  const updCard = el('div', { class: 'card' }, upBtn, msg, el('p', { class: 'help' }, `List version ${list.v}. ${when}`));

  const open = el('button', {}, 'Open all settings');
  open.addEventListener('click', () => chrome.runtime.openOptionsPage());

  const tip = el('p', { class: 'help' }, el('a', { href: DONATE_URL, target: '_blank', rel: 'noreferrer noopener' }, TEXT.donate.link));
  app.replaceChildren(el('h1', {}, 'Spoiler Blocker for GTA 6'), card, pauseCard, ...(host ? [siteCard] : []), updCard, open, tip);
}

void render();
