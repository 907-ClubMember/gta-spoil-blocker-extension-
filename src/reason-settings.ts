// Why a cover is there (the reason codes of the scanner), and which setting of the options page decides that kind of cover: the cover's
// "Change this" opens the options page at that setting. Pure data, shared by the page script, the background and the options page.
import { SOURCE_ANCHOR, type Source } from './cover-source';

/** Every reason a cover can have. A new one needs a line in REASON_ANCHOR (the compiler and a unit test say so). */
export const WHY_CODES = ['alone', 'mention', 'page', 'two-names', 'hint', 'reply', 'chat', 'spoiler-word', 'media', 'near-game', 'heading', 'account'] as const;
export type Why = (typeof WHY_CODES)[number];

/** The places of the options page a cover can send the person to (a card each; see anchors in options/main.ts). */
export const SETTING_ANCHORS = ['protect', 'pictures', 'replies', 'topics', 'parts', 'accounts', 'label', 'hint-words', 'words'] as const;
export type SettingAnchor = (typeof SETTING_ANCHORS)[number];

/** The tab of the options page each anchor sits on. */
export const ANCHOR_TAB: Record<SettingAnchor, 'Basics' | 'Pictures and comments' | 'My lists' | 'Advanced'> = {
  protect: 'Basics',
  pictures: 'Pictures and comments',
  replies: 'Pictures and comments',
  topics: 'Advanced',
  parts: 'Advanced',
  accounts: 'My lists',
  label: 'Advanced',
  'hint-words': 'Advanced',
  words: 'My lists',
};

/**
 * The setting that decides each kind of cover:
 *  - a listed name, a name with the game, two names, or a page about the game: how much to protect (Basics) (a word the person added: My own words),
 *  - a hint word beside a name: the words that show a post is about the game (Advanced),
 *  - a spoiler word beside the game: the topics (Hide by topic),
 *  - a picture or video (next to the game, or in a post about it): Pictures and video,
 *  - a reply (a weak name in a reply under a post about the game): how much to protect, like the post itself,
 *  - a message in a chat after a mention: how much to protect,
 *  - a heading about the game: how much to protect,
 *  - a spoiler account: Hide known spoiler accounts.
 */
export const REASON_ANCHOR: Record<Why, SettingAnchor> = {
  alone: 'protect',
  mention: 'protect',
  page: 'protect',
  'two-names': 'protect',
  hint: 'hint-words',
  reply: 'protect',
  chat: 'protect',
  'spoiler-word': 'topics',
  media: 'pictures',
  'near-game': 'pictures',
  heading: 'protect',
  account: 'accounts',
};

/**
 * Where "Change this" goes for a cover: the setting that made it (cover-source.ts), else its reason's setting. A word the person added
 * goes to their own words only when it alone made the cover: beside a list name (which covers anyway) it is how much to protect.
 */
export const anchorFor = (why: Why, source?: Source | null): SettingAnchor => (source && SOURCE_ANCHOR[source]) || REASON_ANCHOR[why];

/** Is this a place of the options page we know (the background checks what a page's script sends)? */
export const isSettingAnchor = (v: unknown): v is SettingAnchor => typeof v === 'string' && (SETTING_ANCHORS as readonly string[]).includes(v);
