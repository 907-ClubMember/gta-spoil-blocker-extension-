import { SPOILER_ACCOUNTS, parseAccount } from '../../accounts';
import '../../ui/style.css';
import { choiceRow, el } from '../../ui/dom';
import { DONATE_URL } from '../../donate';
import { BLUR_TEXT, CATEGORY_MODE_TEXT, CATEGORY_TEXT, HIDE_MODE_TEXT, KIND_GROUP_TEXT, KIND_MODE_TEXT, KIND_TEXT, MEDIA_NEAR_TEXT, ORDINARY_TEXT, PART_TEXT, RARE_TEXT, PRESET_TEXT, PROTECT_TEXT, REPLIES_TEXT, REVEAL_TEXT, STRICTNESS_TEXT, TEXT, UPDATE_TEXT, BLACKOUT_TEXT } from '../../text';
import { DEFAULT_SETTINGS, PAGE_PARTS, applyPreset, blockingStatus, loadSettings, PROTECTS, normalizeHost, normalizeSettings, coveringEntry, parsePattern, patternChoices, patternLabel, saveSettings, type CategoryMode, type Settings, type SiteOverride, type SitePattern } from '../../settings';
import { activeList, describeResult, loadMeta } from '../../list/store';
import { CATEGORIES, KINDS, KIND_GROUP, KIND_GROUPS } from '../../types';
import { countByCategory } from '../../list';

const app = document.getElementById('app')!;
let s: Settings;

// Changes made elsewhere while this page is open (the popup's pause, the right-click "hide this") are kept: each save starts
// from what is stored now, and the page's copy follows every change.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings?.newValue) s = normalizeSettings(changes.settings.newValue);
  });
} catch {
  /* no storage events here: each save still reads first */
}

/** Any change made by hand turns a named preset into "Custom". */
async function commit(patch: Partial<Settings>) {
  s = normalizeSettings({ ...(await loadSettings()), ...patch, preset: patch.preset ?? 'custom' });
  await saveSettings(s);
}

/** A change to what is protected. The look preset (Casual, Careful...) is left as it was. */
async function commitProtect(patch: Partial<Settings>) {
  s = normalizeSettings({ ...(await loadSettings()), ...patch });
  await saveSettings(s);
}

function section(title: string, help: string, ...body: Node[]) {
  return el('section', { class: 'card' }, el('h2', {}, title), el('p', { class: 'help' }, help), ...body);
}

function radioGroup<T extends string>(name: string, current: T, options: Record<T, { name: string; help: string }>, onPick: (v: T) => void) {
  return (Object.keys(options) as T[]).map((k) => {
    const input = el('input', { type: 'radio', name, checked: k === current });
    input.addEventListener('change', () => onPick(k));
    return choiceRow(input, options[k].name, options[k].help);
  });
}

function wordList(
  info: { name: string; help: string; placeholder: string },
  values: string[],
  clean: (v: string) => string,
  onChange: (next: string[]) => void,
) {
  const input = el('input', { type: 'text', placeholder: info.placeholder, maxLength: 80 });
  const add = el('button', { class: 'primary' }, 'Add');
  const submit = () => {
    const v = clean(input.value);
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
  };
  add.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  const chips = el(
    'div',
    { class: 'chips' },
    ...values.map((v) => {
      const x = el('button', { title: `Remove ${v}`, ariaLabel: `Remove ${v}` }, '×');
      x.addEventListener('click', () => onChange(values.filter((y) => y !== v)));
      return el('span', { class: 'chip' }, v, x);
    }),
  );
  return section(info.name, info.help, el('div', { class: 'add' }, input, add), chips);
}

const KIND_ORDER = { site: 0, prefix: 1, page: 2 } as const;
const samePattern = (a: SitePattern, b: SitePattern) => a.kind === b.kind && a.host === b.host && a.path.toLowerCase() === b.path.toLowerCase();

/**
 * The Safe and Always Strict lists. One box takes a pasted address or a bare site. A bare site is added at once;
 * an address with a path shows its choices (just this page / a part / whole site) with live examples, and one tap adds.
 * Saved entries are rows grouped by site: a kind label, the address, and a remove button.
 */
function siteList(info: { name: string; help: string; placeholder: string; examples: readonly (readonly [string, string, string])[] }, values: SitePattern[], onChange: (next: SitePattern[]) => void) {
  const input = el('input', { type: 'text', placeholder: info.placeholder, maxLength: 300, ariaLabel: info.name });
  const add = el('button', { class: 'primary' }, 'Add');
  const choices = el('div', { class: 'site-choices', role: 'group', ariaLabel: TEXT.siteChoiceIntro });
  const note = el('p', { class: 'msg help', role: 'status' }, '');

  const addOne = (p: SitePattern) => {
    const cover = coveringEntry(values, p);
    if (cover) {
      note.textContent = samePattern(cover, p) ? TEXT.siteAlreadyThere : TEXT.siteCoveredBy(patternLabel(cover));
      return;
    }
    onChange([...values, p]);
  };

  /** Choices for what is typed so far: just this page, then each part, then the whole site. */
  const showChoices = () => {
    choices.replaceChildren();
    note.textContent = '';
    const typed = parsePattern(input.value);
    if (!typed || typed.kind === 'site') return;
    const ordered = patternChoices(input.value); // narrowest first, the same order as the popup
    choices.append(el('p', { class: 'help' }, TEXT.siteChoiceIntro));
    for (const p of ordered) {
      const b = el('button', { class: 'pill', type: 'button' }, el('b', {}, TEXT.siteChoice[p.kind]), el('code', {}, patternLabel(p)));
      b.addEventListener('click', () => addOne(p));
      choices.append(b);
    }
  };

  const submit = () => {
    const typed = parsePattern(input.value);
    if (!typed) {
      note.textContent = input.value.trim() ? TEXT.siteBadAddress : '';
      return;
    }
    if (typed.kind === 'site') return addOne(typed);
    showChoices();
    choices.querySelector<HTMLButtonElement>('button')?.focus();
  };
  add.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  input.addEventListener('input', showChoices);

  const sorted = [...values].sort((x, y) => x.host.localeCompare(y.host) || KIND_ORDER[x.kind] - KIND_ORDER[y.kind] || x.path.localeCompare(y.path));
  const rows = sorted.length
    ? el(
        'ul',
        { class: 'site-rows' },
        ...sorted.map((p) => {
          const x = el('button', { title: `Remove ${patternLabel(p)}`, ariaLabel: `Remove ${patternLabel(p)}` }, 'Remove');
          x.addEventListener('click', () => onChange(values.filter((v) => v !== p)));
          return el('li', { class: `site-row ${p.kind}` }, el('span', { class: 'kind-tag' }, TEXT.siteKind[p.kind]), el('code', {}, patternLabel(p)), x);
        }),
      )
    : el('p', { class: 'help' }, TEXT.siteEmpty);

  const examples = el('ul', { class: 'site-examples help' }, ...info.examples.map(([kind, example, what]) => el('li', {}, el('b', {}, `${kind}: `), el('code', {}, example), ` (${what})`)));
  return section(info.name, info.help, examples, el('div', { class: 'add' }, input, add), note, choices, rows);
}

async function render() {
  s = await loadSettings();
  const [list, meta] = await Promise.all([activeList(), loadMeta()]);
  const counts = countByCategory(list.terms);

  // Two presses, not a browser pop-up: one stray click must not lose someone's settings.
  const resetBtn = el('button', {}, TEXT.resetButton);
  resetBtn.addEventListener('click', () => {
    if (resetBtn.textContent === TEXT.resetConfirm) void commit(structuredClone(DEFAULT_SETTINGS)).then(render);
    else resetBtn.textContent = TEXT.resetConfirm;
  });

  const master = el('input', { type: 'checkbox', checked: s.enabled });
  master.addEventListener('change', () => commit({ enabled: master.checked }).then(render));

  const imgs = el('input', { type: 'checkbox', checked: s.hideImages });
  imgs.addEventListener('change', () => commit({ hideImages: imgs.checked }));

  const media = el('input', { type: 'checkbox', checked: s.hideMediaPosts });
  media.addEventListener('change', () => commit({ hideMediaPosts: media.checked }));

  const catRows = CATEGORIES.map((c) => {
    const pick = el('select', {});
    for (const m of Object.keys(CATEGORY_MODE_TEXT) as CategoryMode[]) pick.append(el('option', { value: m, selected: m === s.categoryModes[c] }, CATEGORY_MODE_TEXT[m]));
    pick.addEventListener('change', () => commit({ categoryModes: { ...s.categoryModes, [c]: pick.value as CategoryMode } }));
    const n = counts[c] ?? 0;
    return el('label', { class: 'row' }, el('span', {}, el('b', {}, CATEGORY_TEXT[c].name), el('span', { class: 'help' }, `${CATEGORY_TEXT[c].help} (${n} ${n === 1 ? 'entry' : 'entries'} in the list)`), pick));
  });

  // What to protect: a preset button fills the grid; changing any row switches to Custom.
  const protectButtons = el('div', { class: 'seg', role: 'group', ariaLabel: TEXT.protect.name });
  for (const k of PROTECTS) {
    const on = s.protect === k;
    const b = el('button', { class: on ? 'on' : '', title: PROTECT_TEXT[k].help }, PROTECT_TEXT[k].name);
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', async () => {
      if (on) return;
      await commitProtect({ protect: k, kindModes: k === 'custom' ? s.kindModes : undefined, rareNames: k === 'custom' ? s.rareNames : DEFAULT_SETTINGS.rareNames });
      await render();
    });
    protectButtons.append(b);
  }
  const kindGrid = KIND_GROUPS.map((g) =>
    el('div', { class: 'kinds' }, el('h3', {}, KIND_GROUP_TEXT[g]), ...KINDS.filter((k) => KIND_GROUP[k] === g).map((k) => {
      const pick = el('select', { ariaLabel: KIND_TEXT[k].name });
      for (const m of ['always', 'mention', 'off'] as const) pick.append(el('option', { value: m, selected: m === s.kindModes[k] }, KIND_MODE_TEXT[m]));
      pick.addEventListener('change', async () => {
        await commitProtect({ protect: 'custom', kindModes: { ...s.kindModes, [k]: pick.value as CategoryMode } });
        await render();
      });
      return el('label', { class: 'kind' }, el('span', {}, el('b', {}, KIND_TEXT[k].name), el('span', { class: 'help' }, KIND_TEXT[k].example)), pick);
    })),
  );
  const ordinary = el('select', { ariaLabel: ORDINARY_TEXT.name });
  for (const m of ['light', 'medium', 'strict'] as const) ordinary.append(el('option', { value: m, selected: m === s.strictness }, ORDINARY_TEXT.options[m]));
  ordinary.addEventListener('change', () => commit({ strictness: ordinary.value as Settings['strictness'] }).then(render));
  const ordinaryRow = el('div', { class: 'kinds' }, el('h3', {}, 'Names that look like everyday words'), el('label', { class: 'kind' }, el('span', {}, el('b', {}, ORDINARY_TEXT.name), el('span', { class: 'help' }, ORDINARY_TEXT.help)), ordinary));
  const rare = el('select', { ariaLabel: RARE_TEXT.name });
  for (const m of ['always', 'mention', 'off'] as const) rare.append(el('option', { value: m, selected: m === s.rareNames }, KIND_MODE_TEXT[m]));
  rare.addEventListener('change', () => commitProtect({ rareNames: rare.value as CategoryMode }).then(render));
  const rareRow = el('div', { class: 'kinds' }, el('h3', {}, RARE_TEXT.heading), el('label', { class: 'kind' }, el('span', {}, el('b', {}, RARE_TEXT.name), el('span', { class: 'help' }, RARE_TEXT.help)), rare));

  const check = (value: boolean, name: string, help: string, patch: (v: boolean) => Partial<Settings>) => {
    const input = el('input', { type: 'checkbox', checked: value });
    input.addEventListener('change', () => commit(patch(input.checked)).then(render));
    return choiceRow(input, name, help);
  };

  const presetRow = (Object.keys(PRESET_TEXT) as (keyof typeof PRESET_TEXT)[]).map((k) => {
    const input = el('input', { type: 'radio', name: 'preset', checked: s.preset === k, disabled: k === 'custom' });
    input.addEventListener('change', async () => {
      if (k === 'custom') return;
      s = applyPreset(await loadSettings(), k);
      await saveSettings(s);
      await render();
    });
    return choiceRow(input, PRESET_TEXT[k].name, PRESET_TEXT[k].help);
  });

  const partRows = PAGE_PARTS.map((p) => check(s.parts[p], PART_TEXT[p].name, PART_TEXT[p].help, (v) => ({ parts: { ...s.parts, [p]: v } })));

  // One row per site that has its own settings, plus a box to add a site.
  const siteBox = el('input', { type: 'text', placeholder: 'Type a site such as youtube.com', maxLength: 80 });
  const siteAdd = el('button', { class: 'primary' }, 'Add site');
  siteAdd.addEventListener('click', async () => {
    const host = normalizeHost(siteBox.value);
    if (!host || s.sites[host]) return;
    await commit({ sites: { ...s.sites, [host]: {} } });
    await render();
  });
  const siteRows = Object.entries(s.sites).map(([host, o]) => {
    const set = (patch: SiteOverride) => commit({ sites: { ...s.sites, [host]: { ...o, ...patch } } }).then(render);
    const strict = el('select', {}, el('option', { value: '' }, 'Same as everywhere'), ...(['light', 'medium', 'strict'] as const).map((k) => el('option', { value: k, selected: o.strictness === k }, STRICTNESS_TEXT[k].name)));
    strict.addEventListener('change', () => set({ strictness: (strict.value || undefined) as SiteOverride['strictness'] }));
    const style = el('select', {}, el('option', { value: '' }, 'Same as everywhere'), ...(['blur', 'collapse', 'remove'] as const).map((k) => el('option', { value: k, selected: o.hideMode === k }, HIDE_MODE_TEXT[k].name)));
    style.addEventListener('change', () => set({ hideMode: (style.value || undefined) as SiteOverride['hideMode'] }));
    const off = el('input', { type: 'checkbox', checked: o.off === true });
    off.addEventListener('change', () => set({ off: off.checked || undefined }));
    const parts = PAGE_PARTS.map((p) => {
      const c = el('input', { type: 'checkbox', checked: o.parts?.[p] ?? s.parts[p] });
      c.addEventListener('change', () => set({ parts: { ...o.parts, [p]: c.checked } }));
      return el('label', { class: 'chip' }, c, ` ${PART_TEXT[p].name}`);
    });
    const del = el('button', { title: `Remove ${host}` }, 'Remove');
    del.addEventListener('click', async () => {
      const { [host]: _gone, ...rest } = s.sites;
      await commit({ sites: rest });
      await render();
    });
    return el('div', { class: 'card' }, el('h3', {}, host), choiceRow(off, 'Never hide anything here', 'Spoiler blocking is switched off on this site.'), el('label', {}, 'How careful: ', strict), el('br'), el('label', {}, 'What hiding looks like: ', style), el('div', { class: 'chips' }, ...parts), del);
  });

  const endBox = el('input', { type: 'date', value: s.endDate });
  endBox.addEventListener('change', () => commit({ endDate: endBox.value }).then(render));
  const endClear = el('button', {}, 'Clear the date');
  endClear.addEventListener('click', () => commit({ endDate: '' }).then(render));
  const weeks = [4, 8, 12].map((n) => {
    const b = el('button', {}, `${n} weeks from today`);
    b.addEventListener('click', () => commit({ endDate: new Date(Date.now() + n * 7 * 86_400_000).toISOString().slice(0, 10) }).then(render));
    return b;
  });
  const pauseNote = s.pausedUntil > Date.now() ? el('p', { class: 'help' }, `Paused until ${new Date(s.pausedUntil).toLocaleString()}.`) : el('p', { class: 'help' }, 'Use the toolbar popup to pause for a while.');

  const blackout = el('select', { ariaLabel: BLACKOUT_TEXT.name });
  for (const n of [0, 3, 7, 14] as const) blackout.append(el('option', { value: String(n), selected: n === s.blackoutDays }, BLACKOUT_TEXT.options[n]));
  blackout.addEventListener('change', () => commit({ blackoutDays: Number(blackout.value) as Settings['blackoutDays'] }));

  const sel = el('select', {});
  for (const k of Object.keys(UPDATE_TEXT) as (keyof typeof UPDATE_TEXT)[]) {
    sel.append(el('option', { value: k, selected: k === s.updateEvery }, UPDATE_TEXT[k]));
  }
  sel.addEventListener('change', () => commit({ updateEvery: sel.value as Settings['updateEvery'] }));
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

  app.replaceChildren(
    el('h1', {}, 'Spoiler Blocker for GTA 6 settings'),
    el('p', { class: 'help' }, 'Changes save automatically and apply to open pages straight away.'),
    el('section', { class: 'card' }, choiceRow(master, TEXT.masterToggle, blockingStatus(s, Date.now()).text)),
    section(TEXT.protect.name, TEXT.protect.help, protectButtons, el('p', { class: 'help' }, PROTECT_TEXT[s.protect].help), ...kindGrid, ordinaryRow, rareRow),
    section('Style presets', 'A preset sets how careful it is and what hiding looks like. It does not change what to protect above. Your word lists and site lists are kept.', ...presetRow),
    section('What should hiding look like?', 'Choose what you see in place of a spoiler.', ...radioGroup('hide', s.hideMode, HIDE_MODE_TEXT, (v) => commit({ hideMode: v }))),
    section('Replies under a hidden comment', 'On sites where replies sit under the comment they answer, such as Reddit and YouTube.', ...radioGroup('replies', (s.hideReplies ? 'all' : 'own') as 'all' | 'own', REPLIES_TEXT, (v) => commit({ hideReplies: v === 'all' }))),
    section('Pictures and video', 'Spoilers are not always text.', choiceRow(imgs, TEXT.hideImages.name, TEXT.hideImages.help), choiceRow(media, TEXT.hideMediaPosts.name, TEXT.hideMediaPosts.help), el('p', {}, el('b', {}, TEXT.mediaNearGame)), ...radioGroup('mediaNear', s.mediaNearGame, MEDIA_NEAR_TEXT, (v) => commit({ mediaNearGame: v }))),
    section('Time and progress', 'Blocking can step back by itself.', pauseNote, el('p', {}, el('b', {}, 'Stop hiding on this day')), el('div', { class: 'add' }, endBox, endClear), el('div', { class: 'add' }, ...weeks), el('p', {}, el('b', {}, BLACKOUT_TEXT.name)), el('p', { class: 'help' }, BLACKOUT_TEXT.help), blackout, check(s.storyFinished, 'I have finished the story', 'Nothing is hidden at all. Untick to turn blocking back on.', (v) => ({ storyFinished: v })), check(s.allowTrailers, 'Let official trailer content through', 'Names and details that were shown in the official trailers are not hidden. Only takes effect for list entries marked as trailer content.', (v) => ({ allowTrailers: v }))),
    section('Toolbar', 'What the extension icon shows.', check(s.showBadge, 'Show the number of hidden items on the icon', 'A small number over the icon counts what was hidden on the current tab.', (v) => ({ showBadge: v }))),
    wordList(TEXT.customWords, s.customWords, (v) => v.trim(), (next) => commit({ customWords: next }).then(render)),
    section(TEXT.spoilerAccounts.name, TEXT.spoilerAccounts.help, check(s.spoilerAccounts, 'Hide the built-in spoiler accounts', `Now: ${SPOILER_ACCOUNTS.map((a) => a.name).join(', ')}.`, (v) => ({ spoilerAccounts: v }))),
    wordList(TEXT.blockedAccounts, s.blockedAccounts, (v) => parseAccount(v) ?? '', (next) => commit({ blockedAccounts: next }).then(render)),
    siteList(TEXT.allowSites, s.allowSites, (next) => commit({ allowSites: next }).then(render)),
    siteList(TEXT.blockSites, s.blockSites, (next) => commit({ blockSites: next }).then(render)),
    el('details', { class: 'card' }, el('summary', {}, 'Advanced settings: cover strength, label details, parts of a page, per-site settings, sound and hint words'),
      section(TEXT.categories.name, TEXT.categories.help, ...catRows),
      section('How strong should the cover be?', 'Applies when "Blur it" is chosen above. "Solid box" shows nothing of the content at all.', ...radioGroup('blur', s.blur, BLUR_TEXT, (v) => commit({ blur: v }))),
      section('Details of the label', 'What the label says and how you lift it.', check(s.showReason, 'Say what kind of thing was hidden', 'The label reads "Hidden: story spoiler" or "Hidden: character spoiler". It never shows the word. Turn off for a plain "Hidden".', (v) => ({ showReason: v })), el('p', {}, el('b', {}, 'How you show something')), ...radioGroup('reveal', s.revealMode, REVEAL_TEXT, (v) => commit({ revealMode: v })), check(s.rememberReveals, 'Keep things I showed shown', 'Something you chose to show stays shown when the page is checked again, for as long as the page is open.', (v) => ({ rememberReveals: v }))),
      section('Parts of a page', 'Untick a part to leave it alone everywhere. Nothing inside it is hidden.', ...partRows),
      section('Sites with their own settings', 'Each site here can be more or less careful than everywhere else, look different, or leave parts of its pages alone.', ...siteRows, el('div', { class: 'add' }, siteBox, siteAdd)),
      section('Sound and video', 'On pages about the game.', check(s.pauseVideo, 'Stop videos that start by themselves', 'A video that begins playing on its own is paused. A video you pressed play on is never stopped.', (v) => ({ pauseVideo: v })), check(s.muteAudio, 'Mute sound', 'Video and audio are muted on pages about the game. You can turn the sound on yourself.', (v) => ({ muteAudio: v })), check(s.thumbsOnly, 'Cover pictures only, never words', 'Only pictures and clip thumbnails are blurred. Words are left alone, so you can still read everything. Spoilers in text will show.', (v) => ({ thumbsOnly: v }))),
      wordList(TEXT.allowWords, s.allowWords, (v) => v.trim(), (next) => commit({ allowWords: next }).then(render)),
      wordList(TEXT.hintWords, s.hintWords, (v) => v.trim(), (next) => commit({ hintWords: next }).then(render)),
    ),
    section(TEXT.resetName, TEXT.resetHelp, resetBtn),
    section(TEXT.updates.name, TEXT.updates.help, el('div', { class: 'add' }, sel), upBtn, msg, el('p', { class: 'help' }, `List version ${list.v}. ${when} ${TEXT.updates.privacyNote}`)),
    section(TEXT.donate.name, TEXT.donate.help, el('a', { href: DONATE_URL, target: '_blank', rel: 'noreferrer noopener' }, TEXT.donate.link)),
  );
}

void render();
