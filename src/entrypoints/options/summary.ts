// The "Current settings" panel of the options page: what is on, what differs from the defaults, the exceptions and the pause.
// Read from the same settings the page saves, so it can't drift from them. The lines are built here without the page, so tests can.
import { el } from '../../ui/dom';
import { BLACKOUT_TEXT, BLUR_TEXT, HIDE_MODE_TEXT, KIND_MODE_TEXT, MEDIA_NEAR_TEXT, PRESET_TEXT, PROTECT_TEXT, RARE_TEXT, REACTION_GIF_TEXT, REPLIES_TEXT, REPLY_GIF_TEXT, REPLY_PHOTO_TEXT, REVEAL_TEXT, STRICTNESS_TEXT, TEXT, UPDATE_TEXT } from '../../text';
import { DEFAULT_SETTINGS, SITE_PICTURE_FIELDS, blockingStatus, timeOf, type Settings, type SiteOverride } from '../../settings';
import { ANCHOR_TAB, type SettingAnchor } from '../../reason-settings';
import { noEffectBecause, type NoEffectReason } from './examples';

const S = TEXT.summary;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (all, k: string) => String(values[k] ?? all));

/** The cards of the options page a line can jump to: the ones a cover can open, and a few more that only this panel links to. */
export type PageAnchor = SettingAnchor | 'master' | 'looks' | 'blur' | 'sound' | 'updates' | 'toolbar';
export const PAGE_ANCHOR_TAB: Record<PageAnchor, (typeof ANCHOR_TAB)[SettingAnchor]> = {
  ...ANCHOR_TAB,
  master: 'Basics',
  looks: 'Basics',
  sound: 'Pictures and comments',
  blur: 'Advanced',
  updates: 'Advanced',
  toolbar: 'Advanced',
};

/** The settings compared with the defaults, in the order they are listed, with the card each one is on. */
const DIFF = {
  preset: 'looks',
  hideMode: 'looks',
  protect: 'protect',
  kindModes: 'protect',
  strictness: 'protect',
  rareNames: 'protect',
  allowTrailers: 'protect',
  allowStores: 'protect',
  hideImages: 'pictures',
  hideMediaPosts: 'pictures',
  thumbsOnly: 'pictures',
  mediaNearGame: 'pictures',
  reactionGifs: 'pictures',
  replyGifs: 'pictures',
  replyPhotos: 'pictures',
  hideReplies: 'replies',
  pauseVideo: 'sound',
  muteAudio: 'sound',
  spoilerAccounts: 'accounts',
  updateEvery: 'updates',
  categoryModes: 'topics',
  blur: 'blur',
  showReason: 'label',
  revealMode: 'label',
  rememberReveals: 'label',
  parts: 'parts',
  showBadge: 'toolbar',
} as const satisfies Partial<Record<keyof Settings, PageAnchor>>;
export type DiffKey = keyof typeof DIFF;
export const DIFF_KEYS = Object.keys(DIFF) as DiffKey[];
/** Not in "Differs from default": the status line (on/off), shown under Exceptions or Pause, worked out from another setting, or not a choice on the page. */
export const NOT_COMPARED: (keyof Settings)[] = [
  'enabled', 'categories', 'customBase', 'storyFinished', 'debugWhy',
  'sites', 'siteGroups', 'customWords', 'allowWords', 'hintWords', 'blockedAccounts', 'allowAccounts', 'allowSites', 'blockSites',
  'pausedUntil', 'startDate', 'endDate', 'timerOff', 'blackoutDays', 'blackoutFrom', 'blackoutZone',
];
/** Settings inside a fold of their card, which a jump opens. */
export const KEY_FOLD: Partial<Record<DiffKey, string>> = { hideMode: TEXT.looksOwn };

/** The name each choice is shown with on the page. */
const NAMES: Partial<Record<keyof Settings, Record<string, { name: string } | string>>> = {
  strictness: STRICTNESS_TEXT, hideMode: HIDE_MODE_TEXT, preset: PRESET_TEXT, protect: PROTECT_TEXT, blur: BLUR_TEXT,
  mediaNearGame: MEDIA_NEAR_TEXT, reactionGifs: REACTION_GIF_TEXT, replyGifs: REPLY_GIF_TEXT, replyPhotos: REPLY_PHOTO_TEXT,
  revealMode: REVEAL_TEXT, updateEvery: UPDATE_TEXT, rareNames: { ...KIND_MODE_TEXT, mention: RARE_TEXT.mention }, blackoutDays: BLACKOUT_TEXT.options,
};

/** Entries of a group of choices that differ from the default one by one. */
function changedIn(now: unknown, was: object): number {
  const o = (now && typeof now === 'object' ? now : {}) as Record<string, unknown>;
  return Object.entries(was).filter(([k, v]) => o[k] !== undefined && o[k] !== v).length;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A value in short words: the choice's name before any ": more words", then "(default)" when it is the default. The names that
 * already say "(default)" lose it first, so it is said once, and only on the real default. `mark` false: no "(default)" at all.
 */
export function valueName<K extends keyof Settings>(key: K, value: Settings[K], mark = true): string {
  let text: string;
  if (key === 'hideReplies') text = REPLIES_TEXT[value ? 'all' : 'own'].name;
  else if (typeof value === 'boolean') text = value ? S.onValue : S.offValue;
  else if (value && typeof value === 'object') text = fill(S.changed, { count: changedIn(value, DEFAULT_SETTINGS[key] as object) });
  else {
    const o = NAMES[key]?.[String(value)];
    text = (typeof o === 'string' ? o : o?.name ?? String(value)).replace(' (default)', '').split(': ')[0]!;
  }
  return mark && same(value, DEFAULT_SETTINGS[key]) ? `${text} ${S.default}` : text;
}

export interface Diff { key: DiffKey; label: string; value: string; anchor: PageAnchor }

/** The settings that differ from the defaults. Groups of choices are one line with a count; the kinds of names count only in Custom. */
export function differsFromDefault(s: Settings): Diff[] {
  return DIFF_KEYS.filter((k) => {
    if (k === 'kindModes' && s.protect !== 'custom') return false;
    const d = DEFAULT_SETTINGS[k];
    return d && typeof d === 'object' ? changedIn(s[k], d) > 0 : s[k] !== undefined && !same(s[k], d);
  }).map((k) => ({ key: k, label: S.labels[k], value: valueName(k, s[k]), anchor: DIFF[k] }));
}

export interface Count { key: keyof typeof S.exceptions; label: string; count: number }

/** The lists and the per-site settings, as counts. Safe pages apart from safe sites; per-site picture choices as one number. */
export function exceptionCounts(s: Settings): Count[] {
  const allow = s.allowSites ?? [];
  const overrides = [...Object.values(s.sites ?? {}), ...Object.values(s.siteGroups ?? {})] as SiteOverride[];
  const set = (o: SiteOverride) => Object.values(o).some((v) => v !== undefined);
  const counts: [Count['key'], number][] = [
    ['safeSites', allow.filter((p) => p.kind !== 'page').length],
    ['safePages', allow.filter((p) => p.kind === 'page').length],
    ['strictSites', s.blockSites?.length ?? 0],
    ['ownWords', s.customWords?.length ?? 0],
    ['neverHide', s.allowWords?.length ?? 0],
    ['blocked', s.blockedAccounts?.length ?? 0],
    ['allowed', s.allowAccounts?.length ?? 0],
    ...(s.hintWords && !same([...s.hintWords].sort(), [...DEFAULT_SETTINGS.hintWords].sort()) ? [['hintWords', s.hintWords.length] as [Count['key'], number]] : []),
    ['siteSettings', overrides.filter((o) => o && set(o)).length],
    ['sitePictures', overrides.filter((o) => o && SITE_PICTURE_FIELDS.some((f) => o[f] !== undefined)).length],
  ];
  return counts.map(([key, count]) => ({ key, label: S.exceptions[key], count }));
}

/** Short words for each reason a setting does nothing (a new reason needs its words here). */
const NO_EFFECT_WORDS: Record<NoEffectReason, string> = S.noEffect;

export interface Line { key: keyof Settings; text: string; note?: string }
export interface Summary {
  /** Switched on (what would be hidden is listed). */
  on: boolean;
  /** Hiding right now: not paused, not before the start or after the end. */
  active: boolean;
  status: string;
  level: string;
  reason?: string;
  hidden: Line[];
  differs: Diff[];
  noEffect: { key: DiffKey; text: string }[];
  exceptions: Count[];
  paused: boolean;
  pause: string[];
  /** The one line shown while the panel is folded. */
  short: string;
}

const HIDDEN_KEYS = ['protect', 'hideImages', 'hideMediaPosts', 'mediaNearGame', 'reactionGifs', 'replyGifs', 'replyPhotos', 'hideReplies', 'thumbsOnly', 'hideMode', 'blur'] as const;
const when = (t: string | number) => new Date(t).toLocaleString();
const many = (n: number, words: { one: string; many: string; none?: string }) => (n === 0 && words.none ? words.none : n === 1 ? words.one : fill(words.many, { count: n }));

/** Everything the panel says, from the settings and the time now. */
export function buildSummary(s: Settings, now: number): Summary {
  const status = blockingStatus(s, now);
  const reason = status.on ? undefined : status.text;
  const paused = s.pausedUntil > now;
  const pause = [
    paused ? TEXT.pausedUntil(when(s.pausedUntil)) : S.notPaused,
    ...(!s.timerOff && (s.startDate || s.endDate)
      ? [s.startDate && s.endDate ? fill(S.timer.both, { start: when(s.startDate), end: when(s.endDate) }) : s.startDate ? fill(S.timer.start, { start: when(s.startDate) }) : fill(S.timer.end, { end: when(s.endDate) })]
      : []),
    ...(s.blackoutDays ? [fill(S.blackout, { choice: valueName('blackoutDays', s.blackoutDays, false) })] : []),
  ];
  const level = `${S.labels.strictness}: ${valueName('strictness', s.strictness)}`;
  // Switched off: nothing else is in effect.
  if (!s.enabled) return { on: false, active: false, status: S.off, level, reason, hidden: [], differs: [], noEffect: [], exceptions: [], paused, pause, short: S.off };

  // Only a setting that is on can add little or nothing.
  const mediaWhy = s.hideMediaPosts ? noEffectBecause('hideMediaPosts', s) : undefined;
  const noEffect = mediaWhy ? [{ key: 'hideMediaPosts' as const, text: NO_EFFECT_WORDS[mediaWhy] }] : [];
  const hidden: Line[] = HIDDEN_KEYS.map((k) => {
    const note = k === 'hideMediaPosts' ? noEffect[0]?.text : k === 'thumbsOnly' && s.thumbsOnly ? S.thumbsNote : undefined;
    // No "(default)" here: "Differs from default" says what changed.
    return { key: k, text: `${S.labels[k]}: ${valueName(k, s[k], false)}`, ...(note ? { note } : {}) };
  });
  const differs = differsFromDefault(s);
  const short = [many(differs.length, S.differCount), ...(noEffect.length ? [many(noEffect.length, S.noEffectCount)] : []), ...(paused ? [S.pausedShort] : [])].join(' · ');
  // The badge says what really happens: paused, or off before the start or after the end, even while switched on.
  const state = status.on ? S.on : paused ? S.pausedState : S.off;
  return { on: true, active: status.on, status: `${state} · ${valueName('preset', s.preset)}`, level, reason, hidden, differs, noEffect, exceptions: exceptionCounts(s), paused, pause, short };
}

/** The next time the panel's words change by themselves: the end of a pause, the timer's start or end, whichever is ahead first. */
export function nextChange(s: Settings, now: number): number | undefined {
  const times = [s.pausedUntil, ...(s.timerOff ? [] : [s.startDate, s.endDate].filter(Boolean).map((d) => timeOf(d)))];
  const ahead = times.filter((t) => Number.isFinite(t) && t > now);
  return ahead.length ? Math.min(...ahead) : undefined;
}

/** Longest wait for one timer (setTimeout overflows past about 24.8 days); a later change waits again from there. */
export const MAX_REDRAW_DELAY = 24 * 86_400_000;
let redrawTimer: ReturnType<typeof setTimeout> | undefined;

/** One timer that draws the page again when nextChange comes; each call replaces the last. */
export function scheduleRedraw(s: Settings, now: number, redraw: () => void) {
  clearTimeout(redrawTimer);
  redrawTimer = undefined;
  const at = nextChange(s, now);
  if (at !== undefined) redrawTimer = setTimeout(redraw, Math.min(at - now, MAX_REDRAW_DELAY));
}

/** A line of "What is hidden", with its note when the setting adds nothing. */
function hiddenLine(l: Line) {
  const li = el('li', {}, l.text, ...(l.note ? [el('span', { class: 'sum-note' }, ` · ${l.note}`)] : []));
  li.dataset.key = l.key;
  return li;
}

export interface PanelUi {
  /** Hidden with its Hide button (remembered by the page). */
  hidden: boolean;
  /** Opened on a narrow screen, where it starts as one line. */
  open: boolean;
  setHidden: (hidden: boolean) => void;
  toggleOpen: () => void;
  jump: (anchor: PageAnchor, key: DiffKey) => void;
  resume: () => void;
}

/** Where the keyboard goes when the button it was on is gone after a redraw (Hide becomes Show, Resume goes away). */
const FOCUS_NEXT: Record<string, string[]> = { hide: ['show'], show: ['hide'], resume: ['bar', 'hide'] };

/** Draws the panel into `box` (kept across the page's redraws, so the Hide and open choices stay), keeping the keyboard where it was. */
export function drawSummary(box: HTMLElement, s: Settings, now: number, ui: PanelUi) {
  const was = box.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.f : undefined;
  draw(box, s, now, ui);
  if (!was) return;
  for (const f of [was, ...(FOCUS_NEXT[was] ?? ['bar', 'hide'])]) {
    box.querySelector<HTMLElement>(`[data-f="${f}"]`)?.focus();
    if (document.activeElement !== document.body && box.contains(document.activeElement)) return;
  }
}

/** A button that the keyboard can come back to after a redraw. */
function button(f: string, cls: string, text: string, onClick: () => void) {
  const b = el('button', { class: cls, type: 'button' }, text);
  b.dataset.f = f;
  b.addEventListener('click', onClick);
  return b;
}

function draw(box: HTMLElement, s: Settings, now: number, ui: PanelUi) {
  box.classList.toggle('sum-hidden', ui.hidden);
  box.classList.toggle('open', ui.open);
  if (ui.hidden) {
    box.replaceChildren(button('show', 'sum-show', S.show, () => ui.setHidden(false)));
    return;
  }
  const sum = buildSummary(s, now);
  const hide = button('hide', 'sum-hide', S.hide, () => ui.setHidden(true));
  const bar = button('bar', 'sum-bar', `${sum.short} · ${ui.open ? S.tapToClose : S.tapToOpen}`, () => ui.toggleOpen());
  bar.setAttribute('aria-expanded', String(ui.open));
  const head = (text: string, ...more: (Node | string)[]) => el('h3', {}, text, ...more);

  const body: Node[] = [el('p', { class: `sum-status ${sum.active ? 'on' : 'off'}` }, sum.status), ...(sum.on ? [el('p', { class: 'help' }, sum.level)] : []), ...(sum.reason ? [el('p', { class: 'help' }, sum.reason)] : [])];
  if (sum.on) {
    body.push(head(S.hiddenTitle), el('ul', { class: 'sum-hidden-list' }, ...sum.hidden.map((l) => hiddenLine(l))));
    // Grey at 0, the accent colour once something differs.
    const badge = el('span', { class: sum.differs.length ? 'sum-count some' : 'sum-count' }, String(sum.differs.length));
    body.push(head(S.differTitle, ' ', badge));
    body.push(sum.differs.length
      ? el('ul', { class: 'sum-differs' }, ...sum.differs.map((d) => {
          const a = el('a', { href: `#setting=${d.anchor}` }, `${d.label}: ${d.value}`);
          a.dataset.key = d.key;
          a.dataset.f = `jump-${d.key}`;
          a.addEventListener('click', (e) => {
            e.preventDefault();
            ui.jump(d.anchor, d.key);
          });
          return el('li', {}, a);
        }))
      : el('p', { class: 'help' }, S.differNone));
    body.push(head(S.exceptionsTitle), el('p', { class: 'sum-exceptions' }, ...sum.exceptions.flatMap((c, i) => {
      const n = el('span', { class: 'sum-n' }, `${c.label}: `, el('b', {}, String(c.count)));
      n.dataset.count = c.key;
      return i ? [' · ', n] : [n];
    })));
  }
  const resume = button('resume', 'sum-resume', TEXT.pauseResume, () => ui.resume());
  body.push(head(S.pauseTitle), ...sum.pause.map((t) => el('p', { class: 'help' }, t)), ...(sum.paused ? [resume] : []));

  box.replaceChildren(el('div', { class: 'sum-head' }, el('h2', {}, S.title), hide), bar, el('div', { class: 'sum-body' }, ...body));
}
