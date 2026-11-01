import '../../ui/style.css';
import { el, rememberFocus, restoreFocus } from '../../ui/dom';
import { BLACKOUT_TEXT, PROTECT_TEXT, TEXT } from '../../text';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from '../../settings';

const app = document.getElementById('app')!;
let saved = false;

/** Shown once, on install: what it does, and the one choice that matters. Hiding already works if this page is just closed. */
async function render() {
  const focus = rememberFocus(app);
  const s = await loadSettings();
  const pick = el('div', { class: 'pick', role: 'group', ariaLabel: TEXT.welcome.pick }, ...(['big', 'story', 'all'] as const).map((k) => {
    const b = el('button', { class: s.protect === k ? 'on' : '' }, el('b', {}, PROTECT_TEXT[k].name), el('span', { class: 'help' }, PROTECT_TEXT[k].help));
    b.setAttribute('aria-pressed', String(s.protect === k));
    b.addEventListener('click', async () => {
      await saveSettings(normalizeSettings({ ...(await loadSettings()), protect: k, kindModes: undefined, rareNames: DEFAULT_SETTINGS.rareNames }));
      saved = true;
      await render();
    });
    return b;
  }));
  const launch = el('select', { ariaLabel: TEXT.welcome.launchPick }, ...([0, 3, 7, 14] as const).map((n) => el('option', { value: String(n), selected: s.blackoutDays === n }, BLACKOUT_TEXT.options[n])));
  launch.addEventListener('change', async () => {
    await saveSettings(normalizeSettings({ ...(await loadSettings()), blackoutDays: Number(launch.value) as 0 | 3 | 7 | 14 }));
    saved = true;
    await render();
  });
  const done = el('button', { class: 'primary' }, TEXT.welcome.done);
  done.addEventListener('click', async () => {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id != null) await chrome.tabs.remove(tab.id);
  });
  const open = el('button', {}, TEXT.welcome.settings);
  open.addEventListener('click', () => chrome.runtime.openOptionsPage());
  app.replaceChildren(
    el('img', { src: chrome.runtime.getURL('/icon/48.png'), alt: '', width: 48, height: 48 }),
    el('h1', {}, TEXT.welcome.title),
    el('p', {}, TEXT.welcome.intro),
    el('h2', {}, TEXT.welcome.pick),
    pick,
    el('h2', {}, TEXT.welcome.launchPick),
    el('p', { class: 'help' }, TEXT.welcome.launchHelp),
    launch,
    el('p', { class: 'help', role: 'status' }, saved ? TEXT.welcome.saved : TEXT.welcome.change),
    el('p', { class: 'help' }, TEXT.welcome.howto),
    el('p', { class: 'help' }, TEXT.welcome.pin),
    el('div', { class: 'add' }, done, open),
  );
  restoreFocus(app, focus);
}

void render();
