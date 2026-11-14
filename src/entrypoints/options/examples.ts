import './examples.css';
import { el } from '../../ui/dom';
import { labelFor } from '../../matcher';
import { CATEGORY_TEXT, EXAMPLE_TEXT as T, KIND_MODE_TEXT, MEDIA_NEAR_TEXT, PART_TEXT, RARE_TEXT, STRICTNESS_TEXT, TEXT } from '../../text';
import { DEFAULT_SETTINGS, PRESETS, normalizeSettings, picturesFor, presetKindModes, settingsForGroup, settingsForUrl, type PagePart, type Settings, type SiteGroup } from '../../settings';
import { KINDS, KIND_BASE_LEVEL, KIND_CATEGORY, KIND_GROUP, type Category, type Kind } from '../../types';

// A small made-up example under each choice that changes what gets covered: what that choice covers and what stays visible.
// Plain boxes with invented posts, drawn from the table below, so a new option only needs a new row here (a unit test checks
// that every option on the page has one for each of its choices). The table says what a choice covers with everything else
// at its default; `letThrough` then uncovers what the person's other settings let through, and the cover is drawn in their look.

export type Look = 'shown' | 'covered';
export type Bit = keyof typeof T.bits;
export interface Card {
  where: keyof typeof T.where;
  bits: [Bit, Look][];
  /** For the bits of any kind (kindName): the kind of name they show. */
  kind?: Kind;
}
/** The cards for one choice. An empty list means there is nothing fixed to show (Custom). */
export type Model = Card[];

/**
 * What each piece of a mock post is, for `letThrough`. pic: a picture (near: covered only for being near the game's name).
 * judged: covered only by the rules that judge a post as a whole, which Light turns off. kind: the kind of name in it.
 * weak: that name needs the game mentioned nearby (Medium) unless the setting is Strict. named: the post itself names the game.
 * anyKind: a name of the card's kind. rare: an unusual name, which follows its own row. leak: says that name leaked.
 */
interface Info { pic?: true; near?: true; judged?: true; kind?: Kind; topic?: Category; weak?: true; named?: true; anyKind?: true; rare?: true; leak?: true; trailer?: true; store?: true; part?: PagePart }
const BITS: Record<Bit, Info> = {
  words: {}, spoilerWords: { judged: true, topic: 'story' }, storyName: { kind: 'lead', weak: true }, sideName: { kind: 'side', weak: true },
  mission: { kind: 'heist' }, city: { kind: 'setting' }, trailerName: { kind: 'cast', weak: true, trailer: true },
  picture: { pic: true, near: true }, spoilerPicture: { pic: true, kind: 'heist' }, clipOnly: { pic: true },
  libraryGif: { pic: true, near: true }, spoilerGif: { pic: true, near: true, judged: true }, replyGif: { pic: true, near: true }, replyPhoto: { pic: true, near: true },
  // A reply that only hints is covered with the comment above it, so it goes by that comment's topic.
  comment: { kind: 'heist', part: 'comments' }, hintReply: { topic: 'story', part: 'comments' }, nameReply: { kind: 'heist', part: 'comments' },
  videoTitle: { kind: 'heist', part: 'titles' }, searchResult: { kind: 'heist', part: 'search' }, sidebarItem: { kind: 'heist', part: 'sidebar' },
  newsText: { kind: 'heist', part: 'news' }, channelPost: {},
  // Any list entry of a kind may be weak, so a kind's name is only ever shown as covered where a weak one would be.
  kindName: { anyKind: true, weak: true }, kindNameGame: { anyKind: true, weak: true, named: true },
  everydayName: { kind: 'lead', weak: true }, everydayNameGame: { kind: 'lead', weak: true, named: true },
  storePost: { kind: 'cast', weak: true, store: true },
  rareName: { rare: true }, leakName: { rare: true, leak: true }, trailerPost: { judged: true, topic: 'trailers', trailer: true },
};
/** Each piece with its topic: the kind's topic for a name. */
const INFO: Record<Bit, Info> = Object.fromEntries(
  Object.entries(BITS).map(([b, i]) => [b, { ...i, topic: i.topic ?? (i.kind ? KIND_CATEGORY[i.kind] : undefined) }]),
) as Record<Bit, Info>;

const game = (...bits: [Bit, Look][]): Card => ({ where: 'game', bits });
const other = (...bits: [Bit, Look][]): Card => ({ where: 'other', bits });
/** A checkbox that covers one thing when on and leaves it alone when off. */
const toggle = (card: (look: Look) => Card) => ({ on: [card('covered')], off: [card('shown')] });
const part = (bit: Bit) => toggle((l) => game([bit, l]));

/** The made-up name shown for a kind: one per group of kinds. */
export const kindName = (k: Kind): string => T.kindNames[KIND_GROUP[k]];
/**
 * A kind's row or a topic: on a page about the game, and in a post elsewhere that names the game. The middle choice counts only
 * on the page (levels.ts makes it page-only). Brands, cities and towns mostly only mark a post as about the game: never a cover.
 */
function names(k: Kind) {
  const quiet = KIND_BASE_LEVEL[k] === 0;
  const m = (a: Look, b: Look): Model => [
    { where: 'game', kind: k, bits: [['kindName', quiet ? 'shown' : a]] },
    { where: 'other', kind: k, bits: [['kindNameGame', quiet ? 'shown' : b]] },
  ];
  return { always: m('covered', 'covered'), mention: m('covered', 'shown'), off: m('shown', 'shown') };
}
/** Leak and trailer posts go by words: the topic is on or off (the page offers no middle choice for them). */
const words = (bit: Bit) => ({ always: [other([bit, 'covered'])], off: [other([bit, 'shown'])] });
const TOPIC_KIND = { story: 'heist', characters: 'lead', map: 'storyplace', gameplay: 'secret' } as const;
const kindRows = Object.fromEntries(KINDS.map((k) => [`kind.${k}`, names(k)])) as Record<`kind.${Kind}`, ReturnType<typeof names>>;
/** How careful: the same name on a page about the game, in a post naming the game elsewhere, and alone elsewhere. */
const strictness = {
  light: [game(['everydayName', 'shown'], ['spoilerWords', 'shown']), other(['everydayNameGame', 'shown'], ['everydayName', 'shown'])],
  medium: [game(['everydayName', 'covered'], ['spoilerWords', 'covered']), other(['everydayNameGame', 'covered'], ['everydayName', 'shown'])],
  strict: [game(['everydayName', 'covered'], ['spoilerWords', 'covered']), other(['everydayNameGame', 'covered'], ['everydayName', 'covered'])],
};
const hideLooks = [game(['words', 'shown'], ['spoilerWords', 'covered'])];
const blackoutOn = [{ where: 'blackoutGame', bits: [['words', 'covered']] }, { where: 'blackoutOther', bits: [['words', 'covered']] }] satisfies Model;

/** The picture settings, on the Pictures and comments tab and again in each site's own settings. */
const PICTURES = {
  hideImages: toggle((l) => other(['spoilerPicture', l])),
  // A bare clip is also covered by "Pictures next to the name of the game", so `letThrough` decides it from both settings.
  hideMediaPosts: toggle((l) => game(['words', 'shown'], ['clipOnly', l])),
  thumbsOnly: {
    on: [game(['spoilerWords', 'shown'], ['spoilerPicture', 'covered'])],
    off: [game(['spoilerWords', 'covered'], ['spoilerPicture', 'covered'])],
  },
  mediaNear: {
    off: [game(['words', 'shown'], ['picture', 'shown'], ['spoilerPicture', 'covered']), other(['words', 'shown'], ['picture', 'shown'])],
    page: [game(['words', 'shown'], ['picture', 'covered'], ['spoilerPicture', 'covered']), other(['words', 'shown'], ['picture', 'shown'])],
    post: [game(['words', 'shown'], ['picture', 'covered'], ['spoilerPicture', 'covered']), other(['words', 'shown'], ['picture', 'covered'])],
  },
  reactionGifs: {
    label: [game(['words', 'shown'], ['libraryGif', 'shown'], ['spoilerGif', 'covered'])],
    picture: [game(['words', 'shown'], ['libraryGif', 'covered'], ['spoilerGif', 'covered'])],
  },
  replyGifs: {
    show: [game(['words', 'shown'], ['picture', 'covered'], ['replyGif', 'shown'])],
    cover: [game(['words', 'shown'], ['picture', 'covered'], ['replyGif', 'covered'])],
  },
  replyPhotos: {
    show: [game(['words', 'shown'], ['picture', 'covered'], ['replyPhoto', 'shown'])],
    cover: [game(['words', 'shown'], ['picture', 'covered'], ['replyPhoto', 'covered'])],
  },
};

/** A site's own picture choice (its drop-down's data-example id): the setting it sets, and the example it shares with it. */
const SITE_PICTURES = {
  siteHideImages: ['hideImages', 'hideImages'],
  siteHideMediaPosts: ['hideMediaPosts', 'hideMediaPosts'],
  siteMediaNear: ['mediaNearGame', 'mediaNear'],
  siteReactionGifs: ['reactionGifs', 'reactionGifs'],
  siteReplyGifs: ['replyGifs', 'replyGifs'],
  siteReplyPhotos: ['replyPhotos', 'replyPhotos'],
  siteThumbsOnly: ['thumbsOnly', 'thumbsOnly'],
} as const satisfies Record<string, [keyof Settings, keyof typeof PICTURES]>;
type SitePictureId = keyof typeof SITE_PICTURES;
/** For tests: each site picture drop-down's id and the setting it sets. */
export const SITE_PICTURE_EXAMPLES: Record<string, string> = Object.fromEntries(Object.entries(SITE_PICTURES).map(([id, [field]]) => [id, field]));
const isSitePicture = (id: string): id is SitePictureId => id in SITE_PICTURES;
/** A setting's value as the name of its choice: a switch is 'on' or 'off'. */
const choiceFor = (v: unknown) => (v === true ? 'on' : v === false ? 'off' : String(v));
/** "Same as everywhere" is drawn as the choice the settings have everywhere. */
const sitePictureRows = <I extends SitePictureId>(id: I) => {
  const [field, base] = SITE_PICTURES[id];
  return { same: (PICTURES[base] as Record<string, Model>)[choiceFor(DEFAULT_SETTINGS[field])]!, ...PICTURES[base] };
};

/** Option id (the radio group's name, or the id given to a checkbox below) -> choice -> what the example shows. */
export const EXAMPLES = {
  protect: {
    big: [game(['mission', 'covered'], ['storyName', 'shown'], ['sideName', 'shown'], ['city', 'shown'])],
    story: [game(['mission', 'covered'], ['storyName', 'covered'], ['sideName', 'shown'], ['city', 'shown'])],
    all: [game(['mission', 'covered'], ['storyName', 'covered'], ['sideName', 'covered'], ['city', 'shown'])],
    custom: [],
  },
  allowTrailers: { on: [game(['trailerName', 'shown'])], off: [game(['trailerName', 'covered'])] },
  allowStores: { on: [game(['storePost', 'shown'])], off: [game(['storePost', 'covered'])] },
  preset: {
    casual: [game(['mission', 'covered'], ['spoilerWords', 'shown'], ['storyName', 'shown']), other(['storyName', 'shown'])],
    careful: [game(['mission', 'covered'], ['spoilerWords', 'covered'], ['storyName', 'covered']), other(['storyName', 'shown'])],
    blackout: [game(['mission', 'covered'], ['spoilerWords', 'covered'], ['storyName', 'covered']), other(['storyName', 'covered'])],
  },
  hide: {
    blur: [game(['words', 'shown'], ['spoilerWords', 'covered'])],
    collapse: [game(['words', 'shown'], ['spoilerWords', 'covered'])],
    remove: [game(['words', 'shown'], ['spoilerWords', 'covered'])],
  },
  ...PICTURES,
  replies: {
    all: [game(['comment', 'covered'], ['hintReply', 'covered'], ['nameReply', 'covered'])],
    own: [game(['comment', 'covered'], ['hintReply', 'shown'], ['nameReply', 'covered'])],
  },
  spoilerAccounts: toggle((l) => other(['channelPost', l])),
  'parts.titles': part('videoTitle'),
  'parts.comments': part('comment'),
  'parts.search': part('searchResult'),
  'parts.sidebar': part('sidebarItem'),
  'parts.news': part('newsText'),
  // The drop-downs, known by their data-example id.
  ...kindRows,
  'topic.story': names(TOPIC_KIND.story),
  'topic.characters': names(TOPIC_KIND.characters),
  'topic.map': names(TOPIC_KIND.map),
  'topic.gameplay': names(TOPIC_KIND.gameplay),
  'topic.leaks': words('leakName'),
  'topic.trailers': words('trailerPost'),
  ordinary: strictness,
  // A site's own choices. "Same as everywhere" is drawn with the settings as they are.
  siteStrict: { same: strictness.strict, ...strictness },
  siteHide: { same: hideLooks, blur: hideLooks, collapse: hideLooks, remove: hideLooks },
  // "Same as everywhere" draws as hiding on: the site's group may switch it off, which the site card cannot know.
  siteOff: { same: [game(['spoilerWords', 'covered'], ['mission', 'covered'])], on: [game(['spoilerWords', 'shown'], ['mission', 'shown'])], off: [game(['spoilerWords', 'covered'], ['mission', 'covered'])] },
  siteHideImages: sitePictureRows('siteHideImages'),
  siteHideMediaPosts: sitePictureRows('siteHideMediaPosts'),
  siteMediaNear: sitePictureRows('siteMediaNear'),
  siteReactionGifs: sitePictureRows('siteReactionGifs'),
  siteReplyGifs: sitePictureRows('siteReplyGifs'),
  siteReplyPhotos: sitePictureRows('siteReplyPhotos'),
  siteThumbsOnly: sitePictureRows('siteThumbsOnly'),
  // An unusual name follows its own row: Hide covers it anywhere; the middle choice needs the game named in the post or the page.
  rare: {
    always: [game(['rareName', 'covered']), other(['rareName', 'covered'])],
    mention: [game(['rareName', 'covered']), other(['rareName', 'covered'])],
    off: [game(['rareName', 'shown']), other(['rareName', 'shown'])],
  },
  // The blackout covers only between its start and end (settings.ts blackoutOn), so its cards say so.
  blackout: { 0: [game(['words', 'shown']), other(['words', 'shown'])], 3: blackoutOn, 7: blackoutOn, 14: blackoutOn, '-1': blackoutOn },
} satisfies Record<string, Record<string, Model>>;
export type OptionId = keyof typeof EXAMPLES;

/** The settings as they would be with this choice picked. */
export function effective(id: OptionId, choice: string, s: Settings): Settings {
  const on = choice === 'on';
  const after = id.slice(id.indexOf('.') + 1);
  const patch: Partial<Settings> =
    id === 'protect' ? (choice === 'custom' ? {} : { protect: choice as Settings['protect'] })
    // Changing a kind's row makes What to hide Custom, as on the page.
    : id.startsWith('kind.') ? { protect: 'custom', kindModes: { ...s.kindModes, [after]: choice } }
    : id.startsWith('topic.') ? { categoryModes: { ...s.categoryModes, [after]: choice } }
    : id === 'ordinary' ? { strictness: choice as Settings['strictness'] }
    : id === 'siteStrict' ? (choice === 'same' ? {} : { strictness: choice as Settings['strictness'] })
    : id === 'siteHide' ? (choice === 'same' ? {} : { hideMode: choice as Settings['hideMode'] })
    : id === 'rare' ? { rareNames: choice as Settings['rareNames'] }
    : id === 'blackout' || id === 'siteOff' ? {}
    : id === 'preset' ? (PRESETS[choice as keyof typeof PRESETS] ?? {})
    : id === 'hide' ? { hideMode: choice as Settings['hideMode'] }
    : id === 'mediaNear' ? { mediaNearGame: choice as Settings['mediaNearGame'] }
    : id === 'reactionGifs' ? { reactionGifs: choice as Settings['reactionGifs'] }
    : id === 'replyGifs' ? { replyGifs: choice as Settings['replyGifs'] }
    : id === 'replyPhotos' ? { replyPhotos: choice as Settings['replyPhotos'] }
    : id === 'replies' ? { hideReplies: choice === 'all' }
    : isSitePicture(id) ? { [SITE_PICTURES[id][0]]: choice === 'on' ? true : choice === 'off' ? false : choice }
    : id.startsWith('parts.') ? { parts: { ...s.parts, [id.slice(6)]: on } }
    : { [id]: on };
  return { ...s, ...patch };
}


const isOn = (name: string) => T.isOn.replace('{name}', name);
const isOff = (name: string) => T.isOff.replace('{name}', name);
const picked = (name: string) => T.picked.replace('{name}', name);

/** Why a setting changes nothing: a key of text.noEffect in extension-text.json. */
export type NoEffectReason = keyof typeof TEXT.noEffect;
type NoEffectRule = [NoEffectReason, (s: Settings) => boolean];
/** Each setting's reasons, most specific first: the first that holds is the one given. Add a setting by adding its rules. */
const NO_EFFECT: Record<'hideMediaPosts', NoEffectRule[]> = {
  // Mirrors the scanner's mediaPost(): pictures are read only with hideImages on (so it comes first), the rule judges a post as a
  // whole, which Light turns off (matcher judgesPosts), and it acts only on a page about the game, where nearGame() in 'page' and
  // in 'post' mode already blurs every big picture and clip. It then only covers the post's few words with it on some sites.
  hideMediaPosts: [
    ['hideImagesOff', (s) => !s.hideImages],
    ['casual', (s) => s.strictness === 'light'],
    ['mediaNearOn', (s) => s.mediaNearGame !== 'off'],
  ],
};
/** The reason under the global settings alone, as on a site with no entry of its own (what the example cards draw). */
function globalNoEffect(setting: keyof typeof NO_EFFECT, s: Settings): NoEffectReason | undefined {
  return NO_EFFECT[setting].find(([, holds]) => holds(s))?.[0];
}

/**
 * Why `setting` does nothing with the settings `s`, or undefined when it does something somewhere. A site or group entry can set
 * pictures, how careful or pictures next to the name of its own (picturesFor, settingsForUrl), and the Strict list makes a site
 * Strict: the global box still counts there unless the same reason holds on those sites too.
 */
export function noEffectBecause(setting: keyof typeof NO_EFFECT, s: Settings): NoEffectReason | undefined {
  const why = globalNoEffect(setting, s);
  if (!why) return undefined;
  const entries = [...Object.values(s.sites ?? {}), ...Object.values(s.siteGroups ?? {})];
  const places: Settings[] = [
    ...entries.filter(Boolean).map((o) => ({ ...s, hideImages: o.hideImages ?? s.hideImages, strictness: o.strictness ?? s.strictness, mediaNearGame: o.mediaNearGame ?? s.mediaNearGame })),
    ...(s.blockSites?.length ? [{ ...s, strictness: 'strict' as const }] : []),
  ];
  return places.every((p) => globalNoEffect(setting, p) === why) ? why : undefined;
}

/**
 * Covered by the table, but let through by another setting? Mirrors the checks in the content scanner and the matcher.
 * Why a piece stays visible: '' when the table shows it anyway, the setting that lets it through, or undefined when covered.
 */
function letThrough(bit: Bit, look: Look, where: Card['where'], e: Settings, kind?: Kind): string | undefined {
  const i: Info = INFO[bit].anyKind && kind ? { ...INFO[bit], kind, topic: KIND_CATEGORY[kind] } : INFO[bit];
  const onGame = where === 'game';
  // A bare clip: hidden as a picture post on a page about the game, or blurred as a big picture near the game's name.
  if (bit === 'clipOnly') {
    // Both rules judge a post as a whole, which Light turns off.
    const no = globalNoEffect('hideMediaPosts', e);
    if (no === 'hideImagesOff') return look === 'shown' ? '' : isOff(TEXT.hideImages.name);
    if (no === 'casual') return look === 'shown' ? '' : picked(STRICTNESS_TEXT.light.name);
    return e.hideMediaPosts || e.mediaNearGame !== 'off' ? undefined : '';
  }
  if (look === 'shown') return '';
  if (i.pic) {
    if (!e.hideImages) return isOff(TEXT.hideImages.name);
    if (i.near && e.strictness === 'light') return picked(STRICTNESS_TEXT.light.name);
    if (i.near && e.mediaNearGame === 'off') return picked(MEDIA_NEAR_TEXT.off.name);
    if (i.near && where === 'other' && e.mediaNearGame !== 'post') return picked(MEDIA_NEAR_TEXT.page.name);
  } else if (e.thumbsOnly) return isOn(TEXT.thumbsOnly.name); // pictures only: words are never covered
  if (i.part && !e.parts[i.part]) return isOff(PART_TEXT[i.part].name);
  if (i.rare) return rareThrough(i, onGame, e);
  const light = picked(STRICTNESS_TEXT.light.name);
  // "Only when the page mentions the game" makes a name wait for a page about the game (levels.ts), which the matcher counts only
  // on that page and never under Light (decide: onPage, strictness). Words judged with the post go by the topic being on at all.
  const waits = (mode: string) => mode === 'mention' && !i.judged && (!onGame || e.strictness === 'light');
  if (i.topic) {
    const mode = e.categoryModes[i.topic];
    if (mode === 'off' || (waits(mode) && !onGame)) return topicShown(i.topic);
    if (waits(mode)) return light;
  }
  if (i.judged && e.strictness === 'light') return light;
  if (i.kind) {
    const mode = (e.protect === 'custom' ? e.kindModes : presetKindModes(e.protect))[i.kind];
    if (mode === 'off' || (waits(mode) && !onGame)) return T.kindShown;
    if (waits(mode)) return light;
  }
  if (i.weak && (e.strictness === 'light' || (e.strictness === 'medium' && !onGame && !i.named))) return picked(STRICTNESS_TEXT[e.strictness].name);
  if (i.trailer && e.allowTrailers) return isOn(TEXT.allowTrailers.name);
  if (i.store && e.allowStores) return isOn(TEXT.allowStores.name);
  return undefined;
}

const topicShown = (c: Category) => T.topicShown.replace('{name}', CATEGORY_TEXT[c].name).replace('{section}', TEXT.categories.name);

/**
 * An unusual name (levels.ts): its own row, not its kind's. Hide makes it hide alone, at every strictness; a Characters topic on
 * "Only when..." turns that into the middle choice; Show, or the topic off, leaves it only a sign of the game. The middle choice
 * hides with the game named in the post or on the page, or anywhere on Strict, but a lone unusual name does not vouch for itself
 * on Medium (decide: selfMarked). A leak word beside it still covers the post there while the leaks topic is on (spoilerPost).
 */
function rareThrough(i: Info, onGame: boolean, e: Settings): string | undefined {
  const topic = e.categoryModes.characters;
  if (topic === 'off') return topicShown('characters');
  const mode = e.rareNames === 'always' && topic === 'mention' ? 'mention' : e.rareNames;
  if (mode === 'off') return T.setTo.replace('{name}', RARE_TEXT.name).replace('{choice}', KIND_MODE_TEXT.off);
  if (mode === 'always') return undefined;
  if (e.strictness === 'light') return picked(STRICTNESS_TEXT.light.name);
  if (e.strictness === 'strict' || onGame || i.named) return undefined;
  if (i.leak) return e.categoryModes.leaks === 'off' ? topicShown('leaks') : undefined;
  return picked(STRICTNESS_TEXT.medium.name);
}

/** How a cover is drawn, in the person's own look: blurred, light blur, one line, or gone. */
type Drawn = 'shown' | 'covered' | 'light' | 'line' | 'gone';
const drawnAs = (look: Look, e: Settings): Drawn =>
  look === 'shown' ? 'shown' : e.hideMode === 'collapse' ? 'line' : e.hideMode === 'remove' ? 'gone' : e.blur === 'light' ? 'light' : 'covered';

/** A site's own off switch (Advanced, a site's settings). */
export const SITE_OFF = 'Never hide anything here';

/** Checkboxes have no name on the page: each is known by the bold name (or the help line) of its row. */
const CHECKS: Partial<Record<OptionId, string>> = {
  allowTrailers: TEXT.allowTrailers.name,
  allowStores: TEXT.allowStores.name,
  hideImages: TEXT.hideImages.name,
  hideMediaPosts: TEXT.hideMediaPosts.name,
  thumbsOnly: TEXT.thumbsOnly.name,
  spoilerAccounts: TEXT.spoilerAccounts.check,
  'parts.titles': PART_TEXT.titles.name,
  'parts.comments': PART_TEXT.comments.name,
  'parts.search': PART_TEXT.search.name,
  'parts.sidebar': PART_TEXT.sidebar.name,
  'parts.news': PART_TEXT.news.name,
};
export function checkId(row: Element): OptionId | undefined {
  const words = [row.querySelector('b')?.textContent, row.querySelector('.help')?.textContent];
  return (Object.keys(CHECKS) as OptionId[]).find((id) => words.includes(CHECKS[id]));
}

const ORDER: Drawn[] = ['covered', 'light', 'line', 'gone', 'shown'];

/** One card in words, for the caption: "A page about ZZG 9. Covered: a, b. Stays visible: c." */
function sayCard(where: Card['where'], bits: [Bit, Drawn][]): string {
  const parts = ORDER.map((l) => [l, bits.filter(([, x]) => x === l).map(([b]) => T.bits[b].say)] as const).filter(([, b]) => b.length);
  return `${T.where[where]}. ${parts.map(([l, b]) => `${T.say[l]}: ${b.join(', ')}.`).join(' ')}`;
}

/** The label on a cover, as a real page words it (scanner reasonLabel): the piece's kind, never a name; "say why" off is a plain "Hidden". */
function pillText(bit: Bit, e: Settings, kind?: Kind): string {
  if (e.showReason === false) return 'Hidden';
  const topic = INFO[bit].anyKind && kind ? KIND_CATEGORY[kind] : INFO[bit].topic;
  return labelFor({ categories: topic ? [topic] : [], custom: false });
}

function drawBit([bit, look]: [Bit, Drawn], e: Settings, kind?: Kind): HTMLElement {
  const text = T.bits[bit].show.replace('{name}', kind ? kindName(kind) : '');
  const box = (cls: string, ...kids: (Node | string)[]) => {
    const d = el('div', { class: `ex-bit ${cls}` }, ...kids);
    d.dataset.bit = bit;
    return d;
  };
  if (look === 'gone') return box('gone', T.removed);
  if (look === 'line') return box('covered line', el('span', { class: 'ex-pill' }, pillText(bit, e, kind)));
  const body = INFO[bit].pic ? el('div', { class: 'ex-pic' }, el('span', { class: 'ex-art' }), el('span', { class: 'ex-cap' }, text)) : el('div', { class: 'ex-words' }, text);
  if (look === 'shown') return box('shown', body);
  return box(`covered ${look}`, el('div', { class: 'ex-under' }, body), el('span', { class: 'ex-pill' }, pillText(bit, e, kind)));
}

/** Pieces that show a list name, which the notes below are about. */
const NAMES = new Set<Bit>(['kindName', 'kindNameGame', 'everydayName', 'everydayNameGame', 'rareName', 'leakName']);

/**
 * The example for one choice, with the person's other settings `s`: a heading with the legend, the mock cards, and the same in
 * words. `site`: a site's own choice, drawn with that site's settings as the content script gets them (settingsForUrl and
 * picturesFor), or a group's, drawn with the group's own entry.
 */
export function drawExample(id: OptionId, picked: string, s: Settings, site?: SiteRef): HTMLElement[] {
  // A site's own picture choice left as "Same as everywhere" draws the choice the settings have everywhere.
  const own = isSitePicture(id) && picked !== 'same';
  const choice = isSitePicture(id) && !own ? choiceFor(s[SITE_PICTURES[id][0]]) : picked;
  const model = (EXAMPLES[id] as Record<string, Model>)[choice];
  if (!model) return [];
  const e = effective(id, choice, site ? settingsAt(s, site) : s);
  // Switched off on that site: nothing is covered there, whatever its other choices say.
  const off = !!site && !!(typeof site === 'string' ? s.sites[site] : s.siteGroups[site.group])?.off && id !== 'siteOff';
  const why = (b: Bit, l: Look, where: Card['where'], kind?: Kind) => (off ? (l === 'shown' ? '' : isOn(SITE_OFF)) : letThrough(b, l, where, e, kind));
  const cards = model.map((c) => ({ where: c.where, kind: c.kind, bits: c.bits.map(([b, l]) => [b, drawnAs(why(b, l, c.where, c.kind) === undefined ? 'covered' : 'shown', e)] as [Bit, Drawn]) }));
  // The caption says it all in words for a screen reader; the legend and the boxes repeat it for the eye.
  const legend = el('span', { class: 'ex-legend' }, el('span', { class: 'ex-key covered' }, T.legendCovered), el('span', { class: 'ex-key shown' }, T.legendShown));
  legend.setAttribute('aria-hidden', 'true');
  const drawn = el('div', { class: 'ex-cards' }, ...cards.map((c) => {
    const card = el('div', { class: 'ex-card' }, el('div', { class: 'ex-where' }, T.where[c.where]), ...c.bits.map((b) => drawBit(b, e, c.kind)));
    card.dataset.where = c.where;
    if (c.kind) card.dataset.kind = c.kind;
    return card;
  }));
  drawn.setAttribute('aria-hidden', 'true');
  // Nothing covered although this choice covers something: say which other setting lets it all through.
  const whys = model.flatMap((c) => c.bits.map(([b, l]) => why(b, l, c.where, c.kind)));
  const all = whys.every((w) => w !== undefined) ? whys.find((w) => w) : undefined;
  // What a made-up name cannot show: a name from the official trailers is only a sign of the game while trailer content is let
  // through (levels.ts), and a real person's name hides only beside a story word (levels.ts, matcher decide).
  const names = model.flatMap((c) => c.bits.filter(([b]) => NAMES.has(b)).map(([b]) => (INFO[b].anyKind ? c.kind : INFO[b].kind)));
  const notes = [
    ...(names.length && e.allowTrailers ? [T.trailerNote.replace('{name}', TEXT.allowTrailers.name)] : []),
    ...(names.some((k) => k && KIND_GROUP[k] === 'people') ? [T.peopleNote] : []),
    ...(own && site ? [T.siteOnly] : []),
    // A bare clip is covered by the near-game pictures setting too, whichever is picked here.
    ...((id === 'hideMediaPosts' || id === 'siteHideMediaPosts') && noEffectBecause('hideMediaPosts', e) === 'mediaNearOn' ? [T.alsoCovered.replace('{name}', TEXT.mediaNearGame)] : []),
  ];
  const said = cards.length ? [...cards.map((c) => sayCard(c.where, c.bits)), ...(all ? [T.because.replace('{setting}', all)] : []), ...notes].join(' ') : T.custom;
  return [el('div', { class: 'ex-head' }, el('span', { class: 'ex-title' }, T.title), legend), ...(cards.length ? [drawn] : []), el('figcaption', { class: 'ex-say' }, said)];
}

/** A site by its host, or a group of sites. */
export type SiteRef = string | { group: SiteGroup };
const settingsAt = (s: Settings, site: SiteRef): Settings =>
  typeof site === 'string' ? { ...settingsForUrl(s, `https://${site}/`), ...picturesFor(s, `https://${site}/`).values } : settingsForGroup(s, site.group);

/** Which choice a group shows now: the drop-down's value, the picked radio, a checkbox on or off, or the pressed button. */
function choiceOf(group: Element): string | undefined {
  // "Same as everywhere" has no value of its own.
  if (group instanceof HTMLSelectElement) return group.value || 'same';
  const radio = group.querySelector<HTMLInputElement>('input[type=radio]:checked');
  if (radio) return radio.value;
  const box = group.querySelector<HTMLInputElement>('input[type=checkbox]');
  if (box) return box.checked ? 'on' : 'off';
  return group.querySelector<HTMLButtonElement>('button[aria-pressed=true]')?.value;
}

// The settings the examples are drawn with, and how to draw each one again. Some choices save without the page being drawn
// again, so any saved change, from this page or elsewhere, redraws every example here.
let current: Settings | undefined;
let redraws: (() => void)[] = [];
let listening = false;
/** The kind row whose example shows (see live). */
let lastKind = 'kind.lead';
function listen() {
  if (listening) return;
  listening = true;
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings?.newValue) return;
      current = normalizeSettings(changes.settings.newValue);
      for (const r of redraws) r();
    });
  } catch {
    /* no storage events here: a change on this page still redraws its own example */
  }
}

/** An example after `place`, kept in step with the choice in `group` as it changes. */
function live(id: OptionId, group: Element, place: Element, site?: SiteRef) {
  const fig = el('figure', { class: 'ex' });
  const draw = () => {
    const choice = choiceOf(group) ?? '';
    const kids = drawExample(id, choice, current!, site);
    fig.dataset.choice = choice;
    // No choice picked (a look preset turned Custom): no example rather than an empty box. Of the kind rows, only the one
    // changed last shows its example: 21 nearly alike would make the list very long.
    fig.hidden = !kids.length || (id.startsWith('kind.') && id !== lastKind);
    fig.replaceChildren(...kids);
  };
  draw();
  group.addEventListener('change', () => {
    if (id.startsWith('kind.')) {
      lastKind = id;
      for (const r of redraws) r();
    } else draw();
  });
  redraws.push(draw);
  place.after(fig);
}

const known = (id: string): id is OptionId => id in EXAMPLES;
/** The site or group whose own settings a choice is in, if any. */
const siteOf = (e: Element): SiteRef | undefined => {
  const card = e.closest<HTMLElement>('[data-site], [data-site-group]');
  return card?.dataset.siteGroup ? { group: card.dataset.siteGroup as SiteGroup } : card?.dataset.site;
};

/** Adds the examples to a freshly drawn options page, for settings `s`. */
export function attachExamples(root: Element, s: Settings): void {
  listen();
  current = s;
  redraws = [];
  for (const group of root.querySelectorAll('fieldset, .looks')) {
    const id = group.querySelector<HTMLInputElement>('input[type=radio]')?.name ?? '';
    if (known(id)) live(id, group, group);
  }
  const seg = root.querySelector('.seg');
  if (seg) live('protect', seg, seg.parentElement?.querySelector('.covers') ?? seg);
  for (const row of root.querySelectorAll('label.row')) {
    const id = row.querySelector('input[type=checkbox]') ? checkId(row) : undefined;
    if (id) live(id, row, row, siteOf(row));
  }
  // A drop-down says which example it has; the example goes under its row.
  for (const pick of root.querySelectorAll<HTMLSelectElement>('select[data-example]')) {
    const id = pick.dataset.example!;
    if (known(id)) live(id, pick, pick.closest('label') ?? pick, siteOf(pick));
  }
}
