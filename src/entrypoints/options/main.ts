import { SPOILER_ACCOUNTS, parseAccount } from '../../accounts';
import '../../ui/style.css';
import { choiceRow, el, preview, rememberFocus, restoreFocus, twoPress } from '../../ui/dom';
import { DONATE_URL, MAKER_URL, WIKI_URL } from '../../donate';
import { installKindOf, showUpdateSteps } from '../../versions';
import { BLUR_TEXT, CATEGORY_MODE_TEXT, CATEGORY_TEXT, HIDE_MODE_TEXT, KIND_GROUP_TEXT, KIND_MODE_TEXT, KIND_TEXT, MEDIA_NEAR_TEXT, REACTION_GIF_TEXT, REPLY_GIF_TEXT, REPLY_PHOTO_TEXT, ORDINARY_TEXT, PART_TEXT, RARE_TEXT, PRESET_TEXT, PROTECT_TEXT, REPLIES_TEXT, REVEAL_TEXT, STRICTNESS_TEXT, TEXT, UPDATE_TEXT, BLACKOUT_TEXT } from '../../text';
import { DEFAULT_SETTINGS, PAGE_PARTS, WORDS_ONLY_TOPICS, PRESETS, applyPreset, blockingStatus, loadSettings, PROTECTS, normalizeHost, normalizeSettings, coveringEntry, parsePattern, patternChoices, patternLabel, samePattern, saveSettings, timeOf, SITE_GROUPS, type CategoryMode, type Settings, type SiteOverride, type SitePattern } from '../../settings';
import { activeList, describeResult, loadMeta } from '../../list/store';
import { CATEGORIES, KINDS, KIND_GROUP, KIND_GROUPS } from '../../types';
import { countByCategory } from '../../list';
import { DEBUG_WHY } from '../../debug-flag';
import { allowDropsGameName } from '../../matcher';
import { shapeTerms } from '../../levels';
import { NEVER_HIDE_REFUSED } from '../../never-hide';
import { SITE_OFF, attachExamples, noEffectBecause } from './examples';
import { isSettingAnchor } from '../../reason-settings';
import { KEY_FOLD, PAGE_ANCHOR_TAB, drawSummary, scheduleRedraw, type DiffKey, type PageAnchor } from './summary';

const app = document.getElementById('app')!;
let s: Settings;

// The "Current settings" panel sits outside the page's redraws (beside it on a wide screen, a bar on top of it on a narrow one),
// drawn again after every save. Its Hide choice is remembered on this computer only; the panel works without it.
const HIDE_KEY = 'summaryHidden';
const summaryBox = el('aside', { className: 'sum-panel', ariaLabel: TEXT.summary.title });
// After the page in reading order; CSS puts it on the right, or on top as a bar on a narrow screen.
app.after(summaryBox);
let summaryHidden = false;
try { summaryHidden = localStorage.getItem(HIDE_KEY) === '1'; } catch { /* no storage: shown */ }
let summaryOpen = false;
function showSummary() {
  if (!s) return;
  // Drawn again when a pause or the timer runs out.
  scheduleRedraw(s, Date.now(), () => void render());
  drawSummary(summaryBox, s, Date.now(), {
    hidden: summaryHidden,
    open: summaryOpen,
    setHidden: (v) => {
      summaryHidden = v;
      try { if (v) localStorage.setItem(HIDE_KEY, '1'); else localStorage.removeItem(HIDE_KEY); } catch { /* not remembered */ }
      showSummary();
    },
    toggleOpen: () => { summaryOpen = !summaryOpen; showSummary(); },
    jump: (anchor, key) => {
      summaryOpen = false;
      showSummary();
      void jumpTo(anchor, key);
    },
    // The popup's "Resume now": the pause cleared.
    resume: () => void commit({ pausedUntil: 0 }).then(render),
  });
}

// The page is drawn again after most changes: which tab and folds are open, and where the keyboard was, must survive that.
const TABS = ['Basics', 'Pictures and comments', 'My lists', 'Advanced'] as const;
let tab: (typeof TABS)[number] = 'Basics';
const opened = new Set<string>();
const closed = new Set<string>();
function fold(title: string, startOpen: boolean, ...body: Node[]) {
  const d = el('details', { open: opened.has(title) || (startOpen && !closed.has(title)) }, el('summary', {}, title), ...body);
  d.addEventListener('toggle', () => {
    if (d.open) {
      opened.add(title);
      closed.delete(title);
    } else {
      opened.delete(title);
      closed.add(title);
    }
  });
  return d;
}
/** Half-typed text in the add boxes, kept per list across a redraw. */
const drafts = new Map<string, string>();
let updateMsg = '';
let resetDone = false;

// Changes made elsewhere while this page is open (the popup's pause, the right-click "hide this") show here at once, so a later
// change here starts from them. A save of this page's own arrives equal to what it already has, and needs no drawing.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    // A right-click refused the game's name: its notice shows at once.
    if (area === 'local' && changes[NEVER_HIDE_REFUSED]?.newValue && s) return void render();
    if (area !== 'local' || !changes.settings?.newValue) return;
    const next = normalizeSettings(changes.settings.newValue);
    if (s && JSON.stringify(next) !== JSON.stringify(s)) {
      s = next;
      void render();
    }
  });
} catch {
  /* no storage events here: each save still reads first */
}

/** A change to how careful it is or how hiding looks turns a named preset into "Custom"; anything else leaves it alone. */
const LOOK_FIELDS = Object.keys(PRESETS.careful);
async function commit(patch: Partial<Settings>) {
  const touchesLook = Object.keys(patch).some((k) => LOOK_FIELDS.includes(k));
  const now = await loadSettings();
  s = normalizeSettings({ ...now, ...patch, preset: patch.preset ?? (touchesLook ? 'custom' : now.preset) });
  await saveSettings(s);
  showSummary();
}

/** A change to what is protected. The look preset (Casual, Careful...) is left as it was. */
async function commitProtect(patch: Partial<Settings>) {
  s = normalizeSettings({ ...(await loadSettings()), ...patch });
  await saveSettings(s);
  showSummary();
}

// Each place a cover's "Change this" can open: the card whose title is this one (data-setting), see src/reason-settings.ts.
const ANCHOR_TITLES: Record<string, PageAnchor> = {
  [TEXT.protect.name]: 'protect',
  [TEXT.picturesTitle]: 'pictures',
  [TEXT.repliesTitle]: 'replies',
  [TEXT.categories.name]: 'topics',
  [TEXT.partsTitle]: 'parts',
  [TEXT.spoilerAccounts.name]: 'accounts',
  [TEXT.labelTitle]: 'label',
  [TEXT.hintWords.name]: 'hint-words',
  [TEXT.customWords.name]: 'words',
  // Only the "Current settings" panel links to these.
  [TEXT.looksTitle]: 'looks',
  [TEXT.soundTitle]: 'sound',
  [TEXT.updates.name]: 'updates',
  [TEXT.blurTitle]: 'blur',
  [TEXT.toolbarTitle]: 'toolbar',
};

function section(title: string, help: string, ...body: Node[]) {
  const card = el('section', { class: 'card' }, el('h2', {}, title), el('p', { class: 'help' }, help), ...body);
  const anchor = ANCHOR_TITLES[title];
  if (anchor) card.setAttribute('data-setting', anchor);
  return card;
}

/**
 * Opens the tab the setting is on, scrolls to its card, lights it for a moment and puts the keyboard in it: in the control of
 * `key` (its data-key) when given, else the card's first.
 */
let jumpTimer = 0;
async function jumpTo(anchor: PageAnchor, key?: DiffKey) {
  // The finer controls of "how much to protect" (how careful, rare names, trailers) are in a fold: open for this jump.
  const wasFolded = anchor === 'protect' && !opened.has(TEXT.protect.fine);
  if (wasFolded) { opened.add(TEXT.protect.fine); closed.delete(TEXT.protect.fine); }
  const fold = key && KEY_FOLD[key];
  const foldShut = !!fold && !opened.has(fold);
  if (fold && foldShut) { opened.add(fold); closed.delete(fold); }
  if (tab !== PAGE_ANCHOR_TAB[anchor] || wasFolded || foldShut) {
    tab = PAGE_ANCHOR_TAB[anchor];
    await render();
  }
  const card = document.querySelector<HTMLElement>(`[data-setting="${anchor}"]`);
  if (!card) return;
  const control = key ? card.querySelector<HTMLElement>(`input[data-key="${key}"]:checked`) ?? card.querySelector<HTMLElement>(`[data-key="${key}"]`) : null;
  (control?.closest<HTMLElement>('label, fieldset') ?? card).scrollIntoView({ block: control ? 'center' : 'start', behavior: 'smooth' });
  card.classList.add('jump');
  window.clearTimeout(jumpTimer);
  jumpTimer = window.setTimeout(() => card.classList.remove('jump'), 2500);
  // A greyed-out control can't take the keyboard: the card does.
  if ((control as HTMLInputElement | null)?.disabled) {
    card.tabIndex = -1;
    card.focus({ preventScroll: true });
  } else (control ?? card.querySelector<HTMLElement>('input, select, button'))?.focus({ preventScroll: true });
}

/** Where the cover that sent us here wants to land: a key in storage (set by the background) or #setting=<name> in the address. */
async function takeJump() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('setting');
  let anchor: unknown = fromHash;
  try {
    const { optionsAnchor } = await chrome.storage.local.get('optionsAnchor');
    if (optionsAnchor !== undefined) {
      anchor = optionsAnchor;
      await chrome.storage.local.remove('optionsAnchor');
    }
  } catch {
    /* no storage events here: the address alone */
  }
  if (isSettingAnchor(anchor)) await jumpTo(anchor);
}

/** The setting each group of round buttons sets, for a jump from the "Current settings" panel. */
const RADIO_KEY: Record<string, keyof Settings> = { mediaNear: 'mediaNearGame', reactionGifs: 'reactionGifs', replyGifs: 'replyGifs', replyPhotos: 'replyPhotos', replies: 'hideReplies', blur: 'blur', reveal: 'revealMode' };

function radioGroup<T extends string>(name: string, label: string, current: T, options: Record<T, { name: string; help: string }>, onPick: (v: T) => void, sample?: (k: T) => HTMLElement) {
  return [el('fieldset', {}, el('legend', { class: 'sr' }, label), ...(Object.keys(options) as T[]).map((k) => {
    const input = el('input', { type: 'radio', name, value: k, checked: k === current });
    if (RADIO_KEY[name]) input.dataset.key = RADIO_KEY[name];
    input.addEventListener('change', () => onPick(k));
    const row = choiceRow(input, options[k].name, options[k].help);
    if (sample) row.append(sample(k));
    return row;
  }))];
}

function wordList(
  info: { name: string; help: string; placeholder: string },
  values: string[],
  clean: (v: string) => string,
  onChange: (next: string[]) => void,
  opts: { maxLength?: number; badText?: string; refuse?: (v: string) => string | null; ignored?: (v: string) => string | null; notice?: HTMLElement } = {},
) {
  const input = el('input', { type: 'text', placeholder: info.placeholder, ariaLabel: info.name, maxLength: opts.maxLength ?? 80, value: drafts.get(info.name) ?? '' });
  const add = el('button', {}, 'Add');
  const note = el('p', { class: 'msg help', role: 'status' }, '');
  input.addEventListener('input', () => drafts.set(info.name, input.value));
  const submit = () => {
    const v = clean(input.value);
    const refused = v ? opts.refuse?.(v) : null;
    if (!v) note.textContent = input.value.trim() ? (opts.badText ?? 'That does not look right. Check it and try again.') : '';
    else if (refused) note.textContent = refused;
    else if (values.some((x) => x.toLowerCase() === v.toLowerCase())) note.textContent = 'That one is already in the list.';
    else {
      drafts.delete(info.name);
      onChange([...values, v]);
    }
  };
  add.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  const chips = el(
    'div',
    { class: 'chips' },
    ...values.map((v) => {
      const x = el('button', { title: `Remove ${v}`, ariaLabel: `Remove ${v}` }, '×');
      x.addEventListener('click', () => onChange(values.filter((y) => y !== v)));
      const why = opts.ignored?.(v);
      return el('span', { class: 'chip' }, v, ...(why ? [el('span', { class: 'help' }, ` (${why})`)] : []), x);
    }),
  );
  const notice = opts.notice ? [opts.notice] : [];
  return section(info.name, info.help, ...notice, el('div', { class: 'add' }, input, add), note, chips);
}

const KIND_ORDER = { site: 0, prefix: 1, page: 2 } as const;

/**
 * The Safe and Always Strict lists. One box takes a pasted address or a bare site. A bare site is added at once;
 * an address with a path shows its choices (just this page / a part / whole site) with live examples, and one tap adds.
 * Saved entries are rows grouped by site: a kind label, the address, and a remove button.
 */
function siteList(info: { name: string; help: string; placeholder: string; examples: readonly (readonly [string, string, string])[] }, values: SitePattern[], onChange: (next: SitePattern[]) => void) {
  const input = el('input', { type: 'text', placeholder: info.placeholder, maxLength: 2000, ariaLabel: info.name, value: drafts.get(info.name) ?? '' });
  const add = el('button', {}, 'Add');
  const choices = el('div', { class: 'site-choices', role: 'group', ariaLabel: TEXT.siteChoiceIntro });
  const note = el('p', { class: 'msg help', role: 'status' }, '');

  const addOne = (p: SitePattern) => {
    const cover = coveringEntry(values, p);
    if (cover) {
      note.textContent = samePattern(cover, p) ? TEXT.siteAlreadyThere : TEXT.siteCoveredBy(patternLabel(cover));
      return;
    }
    drafts.delete(info.name);
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
  // Enter must not also press the first choice, which takes the focus here.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  input.addEventListener('input', () => {
    drafts.set(info.name, input.value);
    showChoices();
  });
  if (input.value) showChoices();

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

/** How long the options page mentions a refused right-click "Never hide this word". */
const REFUSAL_SHOWN_MS = 24 * 60 * 60 * 1000;

/** When the right-click "Never hide this word" last refused the game's name, or null. */
async function lastRefusal(): Promise<number | null> {
  try {
    const at = ((await chrome.storage.local.get(NEVER_HIDE_REFUSED))[NEVER_HIDE_REFUSED] as { at?: unknown } | undefined)?.at;
    return typeof at === 'number' ? at : null;
  } catch {
    return null;
  }
}

/** The right-click refusal, with a button that clears it. */
function refusalNotice(): HTMLElement {
  const x = el('button', { title: TEXT.allowWords.dismiss, ariaLabel: TEXT.allowWords.dismiss }, '×');
  x.addEventListener('click', () => void chrome.storage.local.remove(NEVER_HIDE_REFUSED).catch(() => {}).then(render));
  return el('p', { class: 'msg help' }, TEXT.allowWords.refusedNotice, ' ', x);
}

async function render() {
  const y = window.scrollY;
  const focus = rememberFocus(app);
  s = await loadSettings();
  const [list, meta, refusedAt] = await Promise.all([activeList(), loadMeta(), lastRefusal()]);
  // A folder loaded by hand (installed from GitHub): updates are manual (the popup says when one is out).
  let installType: string | undefined;
  try { installType = (await chrome.management?.getSelf?.())?.installType; } catch { /* the store text: no line */ }
  const fromGithub = showUpdateSteps(installKindOf(installType));
  // The names as the matcher sees them with these settings: a name shaped into the game's marker skips a word never to hide too.
  const shaped = shapeTerms(list.terms, s);
  const counts = countByCategory(list.terms);

  // Two presses, not a browser pop-up: one stray click must not lose someone's settings.
  // The on/off card: a jump target of the panel too.
  const masterCard = (...kids: Node[]) => {
    const c = el('section', { class: 'card' }, ...kids);
    c.dataset.setting = 'master';
    return c;
  };
  const resetBtn = el('button', {}, TEXT.resetButton);
  twoPress(resetBtn, TEXT.resetButton, TEXT.resetConfirm, async () => {
    resetDone = true;
    await commit(structuredClone(DEFAULT_SETTINGS));
    await render();
  });

  const master = el('input', { type: 'checkbox', checked: s.enabled, class: 'switch', ariaLabel: TEXT.masterToggle });
  master.setAttribute('role', 'switch');
  master.dataset.key = 'enabled';
  master.addEventListener('change', () => commit({ enabled: master.checked }).then(render));

  const imgs = el('input', { type: 'checkbox', checked: s.hideImages });
  imgs.dataset.key = 'hideImages';
  // Drawn again: the picture posts row below depends on it.
  imgs.addEventListener('change', () => commit({ hideImages: imgs.checked }).then(render));

  const media = el('input', { type: 'checkbox', checked: s.hideMediaPosts });
  media.dataset.key = 'hideMediaPosts';
  media.addEventListener('change', () => commit({ hideMediaPosts: media.checked }));
  // Greyed out, with the reason, where it can do nothing at all. "Covered anyway" is only said in its example.
  const mediaOff = noEffectBecause('hideMediaPosts', s);
  const mediaRow = choiceRow(media, TEXT.hideMediaPosts.name, TEXT.hideMediaPosts.help);
  if (mediaOff === 'hideImagesOff' || mediaOff === 'casual') {
    media.disabled = true;
    mediaRow.lastElementChild!.append(el('span', { class: 'help' }, TEXT.noEffect[mediaOff]));
  }

  // These two go by a few words in a post, not by names on the list, so a count of list names would mislead.
  const catRows = CATEGORIES.map((c) => {
    const pick = el('select', { ariaLabel: CATEGORY_TEXT[c].name });
    pick.dataset.example = `topic.${c}`;
    pick.dataset.key = 'categoryModes';
    // Leak and trailer words count the same under Hide and the middle choice, so those two offer only Hide and Show.
    for (const m of Object.keys(CATEGORY_MODE_TEXT) as CategoryMode[]) if (m !== 'mention' || !WORDS_ONLY_TOPICS.has(c)) pick.append(el('option', { value: m, selected: m === s.categoryModes[c] }, CATEGORY_MODE_TEXT[m]));
    pick.addEventListener('change', () => commit({ categoryModes: { ...s.categoryModes, [c]: pick.value as CategoryMode } }));
    const n = counts[c] ?? 0;
    return el('label', { class: 'kind' }, el('span', {}, el('b', {}, CATEGORY_TEXT[c].name), el('span', { class: 'help' }, WORDS_ONLY_TOPICS.has(c) ? CATEGORY_TEXT[c].help : `${CATEGORY_TEXT[c].help} (${n} ${n === 1 ? 'entry' : 'entries'} in the list)`)), pick);
  });

  // What to protect: a preset button fills the grid; changing any row switches to Custom.
  const protectButtons = el('div', { class: 'seg', role: 'group', ariaLabel: TEXT.protect.name });
  for (const k of PROTECTS) {
    const on = s.protect === k;
    const b = el('button', { class: on ? 'on' : '', title: PROTECT_TEXT[k].help, value: k }, PROTECT_TEXT[k].name);
    b.setAttribute('aria-pressed', String(on));
    if (on) b.dataset.key = 'protect';
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
      pick.dataset.example = `kind.${k}`;
      pick.dataset.key = 'kindModes';
      for (const m of ['always', 'mention', 'off'] as const) pick.append(el('option', { value: m, selected: m === s.kindModes[k] }, KIND_MODE_TEXT[m]));
      pick.addEventListener('change', async () => {
        await commitProtect({ protect: 'custom', kindModes: { ...s.kindModes, [k]: pick.value as CategoryMode } });
        await render();
      });
      return el('label', { class: 'kind' }, el('span', {}, el('b', {}, KIND_TEXT[k].name), el('span', { class: 'help' }, KIND_TEXT[k].example)), pick);
    })),
  );
  // What the current choice really hides, read from the same settings the hiding uses, so this can't drift from what it does.
  const coverColumn = (title: string, mode: CategoryMode) => {
    const kinds = KINDS.filter((k) => s.kindModes[k] === mode);
    if (!kinds.length) return [];
    return [el('div', {}, el('h3', {}, title), el('ul', {}, ...kinds.map((k) => el('li', {}, el('b', {}, KIND_TEXT[k].name), el('span', { class: 'help' }, KIND_TEXT[k].example.split('. ')[0]!.replace(/^[^:]+: /, ''))))))];
  };
  const covers = el('div', { class: 'covers' }, ...coverColumn(TEXT.coversHidden, 'always'), ...coverColumn(TEXT.coversMention, 'mention'), ...coverColumn(TEXT.coversShown, 'off'));

  const ordinary = el('select', { ariaLabel: ORDINARY_TEXT.name });
  ordinary.dataset.example = 'ordinary';
  ordinary.dataset.key = 'strictness';
  for (const m of ['light', 'medium', 'strict'] as const) ordinary.append(el('option', { value: m, selected: m === s.strictness }, ORDINARY_TEXT.options[m]));
  ordinary.addEventListener('change', () => commit({ strictness: ordinary.value as Settings['strictness'] }).then(render));
  const ordinaryRow = el('div', { class: 'kinds' }, el('h3', {}, 'Names that look like everyday words'), el('label', { class: 'kind' }, el('span', {}, el('b', {}, ORDINARY_TEXT.name), el('span', { class: 'help' }, ORDINARY_TEXT.help)), ordinary));
  const rare = el('select', { ariaLabel: RARE_TEXT.name });
  rare.dataset.example = 'rare';
  rare.dataset.key = 'rareNames';
  // Unusual names keep their own rule (the post or the page), so their middle choice says so.
  for (const m of ['always', 'mention', 'off'] as const) rare.append(el('option', { value: m, selected: m === s.rareNames }, m === 'mention' ? RARE_TEXT.mention : KIND_MODE_TEXT[m]));
  rare.addEventListener('change', () => commitProtect({ rareNames: rare.value as CategoryMode }).then(render));
  const rareRow = el('div', { class: 'kinds' }, el('h3', {}, RARE_TEXT.heading), el('label', { class: 'kind' }, el('span', {}, el('b', {}, RARE_TEXT.name), el('span', { class: 'help' }, RARE_TEXT.help)), rare));

  const check = (value: boolean, name: string, help: string, patch: (v: boolean) => Partial<Settings>) => {
    const input = el('input', { type: 'checkbox', checked: value });
    // The setting it sets, for a jump from the "Current settings" panel.
    const keys = Object.keys(patch(value));
    if (keys.length === 1) input.dataset.key = keys[0]!;
    input.addEventListener('change', () => commit(patch(input.checked)).then(render));
    return choiceRow(input, name, help);
  };

  const lookCard = (input: HTMLInputElement, name: string, help: string, look: Parameters<typeof preview>[0]) =>
    el('label', { class: 'look' }, el('span', { class: 'look-head' }, input, name), preview(look), el('span', { class: 'help' }, help));
  const PRESET_LOOK = { casual: 'light', careful: 'medium', blackout: 'gone' } as const;
  const presetCards = (Object.keys(PRESET_LOOK) as (keyof typeof PRESET_LOOK)[]).map((k) => {
    const input = el('input', { type: 'radio', name: 'preset', value: k, checked: s.preset === k });
    input.dataset.key = 'preset';
    input.addEventListener('change', async () => {
      s = applyPreset(await loadSettings(), k);
      await saveSettings(s);
      await render();
    });
    return lookCard(input, PRESET_TEXT[k].name, PRESET_TEXT[k].help, PRESET_LOOK[k]);
  });
  const looks = (label: string, cards: HTMLElement[]) => {
    const box = el('div', { class: 'looks', ariaLabel: label }, ...cards);
    box.setAttribute('role', 'radiogroup');
    return box;
  };
  const HIDE_LOOK = { blur: 'medium', collapse: 'line', remove: 'gone' } as const;
  const hideCards = (Object.keys(HIDE_LOOK) as (keyof typeof HIDE_LOOK)[]).map((k) => {
    const input = el('input', { type: 'radio', name: 'hide', value: k, checked: s.hideMode === k });
    input.dataset.key = 'hideMode';
    input.addEventListener('change', () => commit({ hideMode: k }).then(render));
    return lookCard(input, HIDE_MODE_TEXT[k].name, HIDE_MODE_TEXT[k].help, HIDE_LOOK[k]);
  });

  const partRows = PAGE_PARTS.map((p) => check(s.parts[p], PART_TEXT[p].name, PART_TEXT[p].help, (v) => ({ parts: { ...s.parts, [p]: v } })));

  // One row per site that has its own settings, plus a box to add a site.
  const siteBox = el('input', { type: 'text', placeholder: 'Type a site such as youtube.com', ariaLabel: 'Site to add', maxLength: 80, value: drafts.get('site') ?? '' });
  siteBox.addEventListener('input', () => drafts.set('site', siteBox.value));
  const siteAdd = el('button', {}, 'Add site');
  const siteNote = el('p', { class: 'msg help', role: 'status' }, '');
  const addSite = async () => {
    const host = normalizeHost(siteBox.value);
    if (!host) siteNote.textContent = siteBox.value.trim() ? TEXT.siteBadAddress : '';
    else if (s.sites[host]) siteNote.textContent = TEXT.siteAlreadyThere;
    else {
      drafts.delete('site');
      await commit({ sites: { ...s.sites, [host]: {} } });
      await render();
    }
  };
  siteAdd.addEventListener('click', () => void addSite());
  siteBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void addSite();
    }
  });
  // One card for a site, or for a group of sites (the same controls, saved to settings.siteGroups).
  const overrideCard = (o: SiteOverride, title: string, key: string, save: (next: SiteOverride) => Promise<void>, del?: HTMLElement, group = false) => {
    const set = (patch: SiteOverride) => save({ ...o, ...patch }).then(render);
    const strict = el('select', {}, el('option', { value: '' }, 'Same as everywhere'), ...(['light', 'medium', 'strict'] as const).map((k) => el('option', { value: k, selected: o.strictness === k }, STRICTNESS_TEXT[k].name)));
    strict.dataset.example = 'siteStrict';
    strict.addEventListener('change', () => set({ strictness: (strict.value || undefined) as SiteOverride['strictness'] }));
    const style = el('select', {}, el('option', { value: '' }, 'Same as everywhere'), ...(['blur', 'collapse', 'remove'] as const).map((k) => el('option', { value: k, selected: o.hideMode === k }, HIDE_MODE_TEXT[k].name)));
    style.dataset.example = 'siteHide';
    style.addEventListener('change', () => set({ hideMode: (style.value || undefined) as SiteOverride['hideMode'] }));
    // Off here: same as everywhere, never hide anything here, or (a site only) hide here even when its group is switched off.
    // The values are the siteOff example's choices: 'on' is "never hide" (off: true), 'off' is off: false.
    const offNow = o.off === true ? 'on' : o.off === false ? 'off' : '';
    const off = el('select', {}, el('option', { value: '' }, 'Same as everywhere'), el('option', { value: 'on', selected: offNow === 'on' }, SITE_OFF),
      ...(group ? [] : [el('option', { value: 'off', selected: offNow === 'off' }, TEXT.sitePictures.siteOffNo)]));
    off.dataset.example = 'siteOff';
    off.addEventListener('change', () => set({ off: off.value === 'on' ? true : off.value === 'off' ? false : undefined }));
    const parts = PAGE_PARTS.map((p) => {
      const c = el('input', { type: 'checkbox', checked: o.parts?.[p] ?? s.parts[p] });
      c.addEventListener('change', () => set({ parts: { ...o.parts, [p]: c.checked } }));
      return el('label', { class: 'chip' }, c, ` ${PART_TEXT[p].name}`);
    });
    // Pictures: each picture setting can differ here; "Same as everywhere" (no value) follows the Pictures and comments tab.
    const onOff: [string, string][] = [['on', TEXT.sitePictures.on], ['off', TEXT.sitePictures.off]];
    const named = <K extends string>(names: Record<K, { name: string }>) => (Object.keys(names) as K[]).map((k) => [k, names[k].name] as [string, string]);
    const pictureRows = ([
      ['hideImages', 'siteHideImages', TEXT.hideImages.name, onOff],
      ['hideMediaPosts', 'siteHideMediaPosts', TEXT.hideMediaPosts.name, onOff],
      ['mediaNearGame', 'siteMediaNear', TEXT.mediaNearGame, named(MEDIA_NEAR_TEXT)],
      ['reactionGifs', 'siteReactionGifs', TEXT.reactionGifs, named(REACTION_GIF_TEXT)],
      ['replyGifs', 'siteReplyGifs', TEXT.replyGifs, named(REPLY_GIF_TEXT)],
      ['replyPhotos', 'siteReplyPhotos', TEXT.replyPhotos, named(REPLY_PHOTO_TEXT)],
      ['thumbsOnly', 'siteThumbsOnly', TEXT.thumbsOnly.name, onOff],
    ] as const).map(([field, id, label, choices]) => {
      const now = o[field];
      const value = typeof now === 'boolean' ? (now ? 'on' : 'off') : now ?? '';
      const pick = el('select', {}, el('option', { value: '' }, TEXT.sitePictures.same), ...choices.map(([v, text]) => el('option', { value: v, selected: v === value }, text)));
      pick.dataset.example = id;
      pick.addEventListener('change', () => {
        const v = pick.value;
        void set({ [field]: v === '' ? undefined : v === 'on' ? true : v === 'off' ? false : v });
      });
      return el('div', { class: 'site-pic' }, el('label', {}, `${label}: `, pick));
    });
    const picKey = `pictures:${key}`;
    const pictures = el('details', { class: 'site-pictures', open: opened.has(picKey), ariaLabel: TEXT.sitePictures.group }, el('summary', {}, TEXT.sitePictures.group),
      el('p', { class: 'help' }, TEXT.sitePictures.groupHelp), ...(s.blackoutDays ? [el('p', { class: 'help' }, TEXT.sitePictures.blackout)] : []), ...pictureRows);
    pictures.addEventListener('toggle', () => (pictures.open ? opened.add(picKey) : opened.delete(picKey)));
    const card = el('div', { class: 'card' });
    card.append(el('h3', {}, title), el('label', {}, 'Spoiler blocking here: ', off), el('br'), el('label', {}, 'How careful: ', strict), el('br'), el('label', {}, 'What hiding looks like: ', style), el('div', { class: 'chips' }, ...parts), pictures, ...(del ? [del] : []));
    return card;
  };
  const siteRows = Object.entries(s.sites).map(([host, o]) => {
    const del = el('button', { title: `Remove ${host}`, ariaLabel: `Remove ${host}` }, 'Remove');
    del.addEventListener('click', async () => {
      const { [host]: _gone, ...rest } = s.sites;
      await commit({ sites: rest });
      await render();
    });
    const card = overrideCard(o, host, host, (next) => commit({ sites: { ...s.sites, [host]: next } }), del);
    card.dataset.site = host;
    return card;
  });
  // The groups come first: a site's own card below beats its group.
  const groupRows = SITE_GROUPS.map((g) => {
    const card = overrideCard(s.siteGroups[g] ?? {}, TEXT.sitePictures.groups[g], `group:${g}`, (next) => commit({ siteGroups: { ...s.siteGroups, [g]: next } }), undefined, true);
    card.dataset.siteGroup = g;
    return card;
  });

  // Off keeps the times for later. On with no time set yet just opens the two boxes.
  const timerOn = !s.timerOff && (!!s.startDate || !!s.endDate || opened.has('timer'));
  if (timerOn) opened.add('timer');
  const timer = el('input', { type: 'checkbox', checked: timerOn });
  timer.addEventListener('change', async () => {
    if (timer.checked) opened.add('timer');
    else opened.delete('timer');
    await commit({ timerOff: !timer.checked });
    await render();
  });
  const timeNote = el('p', { class: 'warn', role: 'status' }, s.startDate && s.endDate && timeOf(s.endDate) <= timeOf(s.startDate) ? TEXT.timer.backwards : '');
  // Saved when the box is left, not per key: this box reports a half-typed year as a real date, and year 2 would stop all hiding at once.
  const timeBox = (label: string, value: string, patch: (v: string) => Partial<Settings>) => {
    const shown = value && !value.includes('T') ? `${value}T00:00` : value;
    const box = el('input', { type: 'datetime-local', value: shown });
    box.addEventListener('blur', () => {
      if (box.value === shown) return;
      if (box.value && Number(box.value.slice(0, 4)) < 2020) {
        box.value = shown;
        timeNote.textContent = TEXT.timer.tooEarly;
        return;
      }
      void commit(patch(box.value)).then(render);
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') box.blur();
    });
    return el('label', {}, label, box);
  };
  const timerBoxes = timerOn ? [el('div', { class: 'times' }, timeBox(TEXT.timer.start, s.startDate, (v) => ({ startDate: v })), timeBox(TEXT.timer.end, s.endDate, (v) => ({ endDate: v }))), timeNote] : [];
  const pauseNote = s.pausedUntil > Date.now() ? [el('p', { class: 'help' }, `Paused until ${new Date(s.pausedUntil).toLocaleString()}.`)] : [];

  const blackout = el('select', { ariaLabel: BLACKOUT_TEXT.name });
  blackout.dataset.example = 'blackout';
  for (const n of [0, 3, 7, 14, -1] as const) blackout.append(el('option', { value: String(n), selected: n === s.blackoutDays }, BLACKOUT_TEXT.options[n]));
  blackout.addEventListener('change', () => commit({ blackoutDays: Number(blackout.value) as Settings['blackoutDays'] }).then(render));
  const zonePick = el('select', { ariaLabel: BLACKOUT_TEXT.zone }, el('option', { value: '' }, BLACKOUT_TEXT.zoneYours), ...Intl.supportedValuesOf('timeZone').map((z) => el('option', { value: z, selected: z === s.blackoutZone }, z.replaceAll('_', ' '))));
  zonePick.addEventListener('change', () => commit({ blackoutZone: zonePick.value }).then(render));

  const sel = el('select', { ariaLabel: TEXT.updates.name });
  sel.dataset.key = 'updateEvery';
  for (const k of Object.keys(UPDATE_TEXT) as (keyof typeof UPDATE_TEXT)[]) {
    sel.append(el('option', { value: k, selected: k === s.updateEvery }, UPDATE_TEXT[k]));
  }
  sel.addEventListener('change', () => commit({ updateEvery: sel.value as Settings['updateEvery'] }));
  const msg = el('p', { class: 'msg help', role: 'status' }, updateMsg);
  const upBtn = el('button', {}, TEXT.updates.button);
  upBtn.addEventListener('click', async () => {
    upBtn.disabled = true;
    msg.textContent = 'Checking for new spoilers...';
    try {
      const r = (await chrome.runtime.sendMessage({ type: 'updateNow' })) as { text: string };
      updateMsg = r.text;
    } catch {
      updateMsg = 'Could not check right now.';
    }
    await render();
  });
  const checked = meta.checkedAt ? `Last checked ${new Date(meta.checkedAt).toLocaleString()}.` : 'Not checked yet.';
  const when = meta.failedAt && meta.failure ? `${checked} ${TEXT.updateFailed(new Date(meta.failedAt).toLocaleString(), meta.failure)}` : checked;

  const panelId = (name: string) => `panel-${TABS.indexOf(name as (typeof TABS)[number])}`;
  const tabId = (name: string) => `tab-${TABS.indexOf(name as (typeof TABS)[number])}`;
  const panel = (name: (typeof TABS)[number], flat: boolean, ...kids: Node[]) => {
    const p = el('div', { class: flat ? 'panel flat' : 'panel', hidden: tab !== name, id: panelId(name), role: 'tabpanel' }, ...kids);
    p.setAttribute('aria-labelledby', tabId(name));
    return p;
  };
  const pickTab = (name: (typeof TABS)[number], keys: boolean) => {
    tab = name;
    void render().then(() => {
      window.scrollTo(0, 0);
      if (keys) document.getElementById(tabId(name))?.focus();
    });
  };
  const tabs = el('div', { class: 'tabs', role: 'tablist', ariaLabel: 'Settings sections' }, ...TABS.map((name, i) => {
    const b = el('button', { class: tab === name ? 'on' : '', role: 'tab', id: tabId(name), tabIndex: tab === name ? 0 : -1 }, name);
    b.setAttribute('aria-selected', String(tab === name));
    b.setAttribute('aria-controls', panelId(name));
    b.addEventListener('click', () => pickTab(name, false));
    b.addEventListener('keydown', (e) => {
      const to = { ArrowRight: (i + 1) % TABS.length, ArrowLeft: (i - 1 + TABS.length) % TABS.length, Home: 0, End: TABS.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      pickTab(TABS[to]!, true);
    });
    return b;
  }));
  const link = (href: string, text: string) => el('a', { href, target: '_blank', rel: 'noreferrer noopener' }, text);

  app.replaceChildren(
    el('h1', {}, TEXT.settingsTitle),
    el('p', { class: 'help' }, TEXT.settingsIntro),
    tabs,
    panel('Basics', false,
      ...(fromGithub ? [el('p', { class: 'help install-note' }, TEXT.installedFromGithub)] : []),
      masterCard(el('label', { class: 'row master' }, el('span', {}, el('b', {}, TEXT.masterToggle), el('span', { class: 'help' }, blockingStatus(s, Date.now()).text)), master)),
      el('section', { class: 'card' }, choiceRow(timer, TEXT.timer.name, TEXT.timer.help), ...timerBoxes, ...pauseNote),
      section(TEXT.protect.name, TEXT.protect.help, protectButtons, el('p', {}, PROTECT_TEXT[s.protect].help), covers,
        fold(TEXT.protect.fine, s.protect === 'custom', ...kindGrid, ordinaryRow, rareRow, check(s.allowTrailers, TEXT.allowTrailers.name, TEXT.allowTrailers.help, (v) => ({ allowTrailers: v })), check(s.allowStores, TEXT.allowStores.name, TEXT.allowStores.help, (v) => ({ allowStores: v })))),
      el('section', { class: 'card support' }, el('div', {}, el('h2', {}, TEXT.donate.name), el('p', { class: 'help' }, TEXT.donate.help)), el('div', { class: 'support-links' }, link(DONATE_URL, TEXT.donate.link), link(WIKI_URL, TEXT.donate.site), link(MAKER_URL, TEXT.donate.own))),
      section(TEXT.looksTitle, TEXT.looksHelp, looks(TEXT.looksTitle, presetCards), ...(s.preset === 'custom' ? [el('p', { class: 'help' }, `${PRESET_TEXT.custom.name}: ${PRESET_TEXT.custom.help}`)] : []),
        fold(TEXT.looksOwn, false, looks(TEXT.looksOwn, hideCards))),
      section(BLACKOUT_TEXT.name, BLACKOUT_TEXT.help, blackout, ...(s.blackoutDays ? [el('div', { class: 'times' }, timeBox(BLACKOUT_TEXT.start, s.blackoutFrom, (v) => ({ blackoutFrom: v })), el('label', {}, BLACKOUT_TEXT.zone, zonePick)), el('p', { class: 'help' }, BLACKOUT_TEXT.startHelp)] : [])),
      section(TEXT.resetName, TEXT.resetHelp, resetBtn, el('p', { class: 'msg help', role: 'status' }, resetDone ? TEXT.resetDone : '')),
    ),
    panel('Pictures and comments', true,
      section(TEXT.picturesTitle, TEXT.picturesHelp, choiceRow(imgs, TEXT.hideImages.name, TEXT.hideImages.help), mediaRow, check(s.thumbsOnly, TEXT.thumbsOnly.name, TEXT.thumbsOnly.help, (v) => ({ thumbsOnly: v })), el('p', {}, el('b', {}, TEXT.mediaNearGame)), ...radioGroup('mediaNear', TEXT.mediaNearGame, s.mediaNearGame, MEDIA_NEAR_TEXT, (v) => commit({ mediaNearGame: v })), el('p', {}, el('b', {}, TEXT.reactionGifs)), ...radioGroup('reactionGifs', TEXT.reactionGifs, s.reactionGifs, REACTION_GIF_TEXT, (v) => commit({ reactionGifs: v })), el('p', {}, el('b', {}, TEXT.replyGifs)), ...radioGroup('replyGifs', TEXT.replyGifs, s.replyGifs, REPLY_GIF_TEXT, (v) => commit({ replyGifs: v })), el('p', {}, el('b', {}, TEXT.replyPhotos)), ...radioGroup('replyPhotos', TEXT.replyPhotos, s.replyPhotos, REPLY_PHOTO_TEXT, (v) => commit({ replyPhotos: v }))),
      section(TEXT.repliesTitle, TEXT.repliesHelp, ...radioGroup('replies', TEXT.repliesTitle, (s.hideReplies ? 'all' : 'own') as 'all' | 'own', REPLIES_TEXT, (v) => commit({ hideReplies: v === 'all' }))),
      section(TEXT.soundTitle, TEXT.soundHelp, check(s.pauseVideo, TEXT.pauseVideo.name, TEXT.pauseVideo.help, (v) => ({ pauseVideo: v })), check(s.muteAudio, TEXT.muteAudio.name, TEXT.muteAudio.help, (v) => ({ muteAudio: v }))),
    ),
    panel('My lists', true,
      wordList(TEXT.customWords, s.customWords, (v) => v.trim(), (next) => commit({ customWords: next }).then(render)),
      // The game's own name is refused here as on the right-click menu; one saved before is shown as ignored (the matcher skips it).
      wordList(TEXT.allowWords, s.allowWords, (v) => v.trim(), (next) => commit({ allowWords: next }).then(render), {
        refuse: (v) => (allowDropsGameName(v, list.terms) ? TEXT.allowWords.refused : null),
        ignored: (v) => (allowDropsGameName(v, shaped) ? TEXT.allowWords.ignored : null),
        notice: refusedAt !== null && Date.now() - refusedAt < REFUSAL_SHOWN_MS ? refusalNotice() : undefined,
      }),
      section(TEXT.spoilerAccounts.name, TEXT.spoilerAccounts.help, check(s.spoilerAccounts, `Hide ${SPOILER_ACCOUNTS.map((a) => a.name).join(', ')}`, TEXT.spoilerAccounts.check, (v) => ({ spoilerAccounts: v }))),
      // A bare @name could be any site's: asking for the link beats quietly saving a YouTube handle for someone's X account.
      wordList(TEXT.blockedAccounts, s.blockedAccounts, (v) => (v.trim().startsWith('@') ? '' : parseAccount(v) ?? ''), (next) => commit({ blockedAccounts: next }).then(render), { badText: TEXT.blockedAccounts.bad }),
      wordList(TEXT.allowAccounts, s.allowAccounts, (v) => (v.trim().startsWith('@') ? '' : parseAccount(v) ?? ''), (next) => commit({ allowAccounts: next }).then(render), { badText: TEXT.allowAccounts.bad }),
      siteList(TEXT.allowSites, s.allowSites, (next) => commit({ allowSites: next }).then(render)),
      siteList(TEXT.blockSites, s.blockSites, (next) => commit({ blockSites: next }).then(render)),
    ),
    panel('Advanced', true,
      section(TEXT.updates.name, TEXT.updates.help, el('div', { class: 'add' }, sel), upBtn, msg, el('p', { class: 'help' }, `List version ${list.v}. ${when} ${TEXT.updates.privacyNote}`)),
      section(TEXT.categories.name, TEXT.categories.help, ...catRows),
      section(TEXT.blurTitle, TEXT.blurHelp, ...radioGroup('blur', TEXT.blurTitle, s.blur, BLUR_TEXT, (v) => commit({ blur: v }), (k) => el('span', { class: `pv-cover pv-${k}` }, el('span', { class: 'pv-text' }, TEXT.previewPost)))),
      section(TEXT.labelTitle, TEXT.labelHelp, check(s.showReason, TEXT.showReason.name, TEXT.showReason.help, (v) => ({ showReason: v })), ...(DEBUG_WHY ? [check(s.debugWhy, 'Debug: show why (shows spoilers)', 'Hover a cover to see the rule and the matched words. This reveals the spoiler list. Dev builds only.', (v) => ({ debugWhy: v }))] : []), el('p', {}, el('b', {}, TEXT.revealTitle)), ...radioGroup('reveal', TEXT.revealTitle, s.revealMode, REVEAL_TEXT, (v) => commit({ revealMode: v })), check(s.rememberReveals, TEXT.rememberReveals.name, TEXT.rememberReveals.help, (v) => ({ rememberReveals: v }))),
      section(TEXT.partsTitle, TEXT.partsHelp, ...partRows),
      section(TEXT.sitesTitle, TEXT.sitesHelp, el('h3', {}, TEXT.sitePictures.groups.title), el('p', { class: 'help' }, TEXT.sitePictures.groups.help), ...groupRows, ...siteRows, el('div', { class: 'add' }, siteBox, siteAdd), siteNote),
      wordList(TEXT.hintWords, s.hintWords, (v) => v.trim(), (next) => commit({ hintWords: next }).then(render), { maxLength: 40 }),
      section(TEXT.toolbarTitle, TEXT.toolbarHelp, check(s.showBadge, TEXT.showBadge.name, TEXT.showBadge.help, (v) => ({ showBadge: v }))),
    ),
  );
  attachExamples(app, s);
  showSummary();
  window.scrollTo(0, y);
  restoreFocus(app, focus);
}

void render().then(takeJump);
try {
  // The options page is already open when a cover asks: the same jump, at once.
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.optionsAnchor?.newValue !== undefined) void takeJump(); });
} catch {
  /* no storage events here */
}
window.addEventListener('hashchange', () => void takeJump());

