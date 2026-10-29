import { hostMatches } from '../settings';

/**
 * A site adapter says which element is "one post" on that site, so the whole card
 * (title, thumbnail, comments) is hidden together instead of a single line of text.
 * Sites change their markup often; when a selector stops matching, the scanner falls
 * back to the generic rules, so a stale adapter degrades instead of breaking.
 */
export interface Adapter {
  name: string;
  hosts: string[];
  /** Only on addresses whose path matches (a part of a site that works differently, such as YouTube's live-chat frame). Wins over the host's other rule. */
  path?: RegExp;
  /** CSS selector for one post/card/message. The nearest match around matching text is hidden. */
  containers: string;
  /** Regions hidden as one piece when anything in them matches, even though they hold smaller cards. */
  panels?: string;
  /** Messages are a flat list with no nesting: a game mention also covers the next few messages. */
  chat?: boolean;
  /**
   * Comments whose element also holds the replies under them. Only these can be hidden "own content
   * only" (the reply option); every other card is always hidden whole, because a card that merely
   * contains another card (a search result holding list items) must never be opened up.
   */
  threads?: string;
  /** Areas and buttons inside a thread that belong to its replies ("more replies"), never hidden with the comment. */
  replyAreas?: string;
  /**
   * The main post of a thread page, for sites whose replies are not nested but follow it as separate
   * posts. A reply to a main post that names the game counts as being about it, and hiding the main post
   * hides the replies after it too (the reply option). Never set together with `threads`.
   */
  main?: string;
  /** Pattern whose first group identifies the thread in the address; `main` counts only on a matching address. */
  threadKey?: RegExp;
  /**
   * The page's own post (a video's watch page): `owner` is every place its author's link sits. When that author is a
   * spoiler account, the post around the link is hidden if it is one of `parts` (one short in a feed of shorts),
   * else everything matching `page` (the watch page's title and description, player and description panel); any
   * video inside is paused.
   */
  ownPage?: { owner: string; parts?: string; page: string };
}

// Instagram, read from a live opened post (replies loaded): every comment and reply links to its own
// address (/c/…). Comments are a run of sibling blocks; each block holds the comment's own row and,
// under it, a list of its replies. A block is recognised as one of at least three such siblings in a
// row, which leaves out the two-part inside of a single comment (its row and its replies area).
// ":has" cannot sit inside another ":has", so the following-sibling halves spell their link out.
const IG_LINK = 'a[href*="/c/"]';
const IG_COMMENT = [
  `div:has(${IG_LINK}):has(+ div + div ${IG_LINK})`,
  `div:has(${IG_LINK}) + div:has(${IG_LINK}):has(+ div ${IG_LINK})`,
  `div:has(${IG_LINK}) + div:has(${IG_LINK}) + div:has(${IG_LINK})`,
].join(', ');

// Facebook: the block around one comment and the replies under it.
const FB_COMMENT = 'div:has(> div:first-child > [role="article"]:only-child)';
// ...and a post that holds its own comments: a cell of a feed (group or page), a post article, or the
// dialog a post opens in. Read from a group feed, a group post page and a page post page: a post's own
// words are not an article there, but each comment is, and carries a label. That label is the mark of a
// comment (its words differ by language, its presence does not).
const FB_HAS_COMMENTS = ':has([role="article"][aria-label])';
const FB_POST = `[role="feed"] > div${FB_HAS_COMMENTS}, [role="article"]:not([aria-label])${FB_HAS_COMMENTS}, [role="dialog"]${FB_HAS_COMMENTS}`;

export const ADAPTERS: Adapter[] = [
  {
    name: 'YouTube',
    hosts: ['youtube.com'],
    containers: [
      'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer', 'ytd-grid-video-renderer',
      'ytd-reel-item-renderer', 'ytd-playlist-renderer', 'ytd-channel-renderer', 'ytd-comment-thread-renderer',
      'yt-lockup-view-model', 'ytm-shorts-lockup-view-model',
    ].join(', '),
    // Read from a live video page: a reply is itself a comment thread, nested in its parent's replies area.
    threads: 'ytd-comment-thread-renderer',
    replyAreas: 'ytd-comment-replies-renderer',
    // Read from a saved watch page: the video's channel shows in the owner row under the title, in the description's
    // channel card, and in the header of the description panel beside the video. A Shorts player page holds each
    // short's channel row inside that short's own block (its player too). Only channel rows count: a comment's
    // author inside a short is not the short's owner.
    ownPage: {
      owner: 'ytd-video-owner-renderer, ytd-video-description-infocards-section-renderer, ytd-video-description-header-renderer #channel-info, ytd-reel-player-overlay-renderer #channel-info, ytd-reel-player-overlay-renderer ytd-channel-name, ytm-slim-owner-renderer',
      parts: 'ytd-reel-video-renderer',
      page: 'ytd-watch-metadata, #player, #player-full-bleed-container, ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-structured-description"], ytm-slim-video-metadata-section-renderer',
    },
  },
  {
    // A stream's live chat runs in its own frame (youtube.com/live_chat, and live_chat_replay for a past stream's chat). Each
    // message is one chat line, judged like Kick and Twitch: a game mention also covers the next few messages. Element names from
    // YouTube's public page structure.
    name: 'YouTube live chat',
    hosts: ['youtube.com'],
    path: /^\/live_chat(_replay)?\b/,
    containers: 'yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer, yt-live-chat-paid-sticker-renderer, yt-live-chat-membership-item-renderer',
    chat: true,
  },
  {
    name: 'Reddit',
    hosts: ['reddit.com'],
    containers: [
      'shreddit-post', 'shreddit-comment', '[data-testid="post-container"]', '.thing', '.search-result',
      // Search page: one result card, and the suggested-search chips above the results.
      // Reddit serves two layouts of this page; both wrappers are named so either is hidden as one card.
      '[data-testid="search-post-with-content-preview"]', '[data-testid="search-sdui-post"]', '[data-testid="search-sdui-query-suggestion-wrapper"]',
    ].join(', '),
    threads: 'shreddit-comment, .thing.comment',
    replyAreas: 'faceplate-partial[slot="children"], a[slot="more-comments-permalink"], .thing.morechildren',
  },
  {
    name: 'X',
    hosts: ['x.com', 'twitter.com'],
    containers: 'article[data-testid="tweet"], [data-testid="trend"], [data-testid="UserCell"]',
    // On a tweet's own page the main tweet is the one the page focuses (tabindex -1); replies follow it.
    main: 'article[data-testid="tweet"][tabindex="-1"]',
    threadKey: /\/status\/(\d+)/,
  },
  {
    name: 'Google',
    hosts: ['google.com'],
    containers: '.MjjYud, div.g, g-card, .SoaBEf, li.sbct, [role="listitem"]',
    // The side column about a person or game: all of it is about the same subject.
    panels: '#rhs, .kp-wholepage',
  },
  // The rules below were written from each site's live page structure (read-only, structure only).
  {
    name: 'Bluesky',
    hosts: ['bsky.app'],
    // A post in a feed or search, and each post in an opened thread. Replies are siblings, not nested.
    containers: '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]',
    // In an opened thread the replies are links (role="link"); the main post is not.
    main: '[data-testid^="postThreadItem-by-"]:not([role="link"])',
    threadKey: /\/post\/([^/]+)/,
  },
  {
    name: 'Threads',
    hosts: ['threads.com', 'threads.net'],
    // Read from a live profile and a post page (2026-10-29, logged out, structure only): every post and every reply is one
    // pressable block, side by side in the page (replies are not nested inside the post they answer).
    containers: 'div[data-pressable-container]',
  },
  {
    name: 'Bing',
    hosts: ['bing.com'],
    containers: 'li.b_algo, li.b_ans, .b_vidAns, .news-card',
    panels: '#b_context',
  },
  {
    name: 'DuckDuckGo',
    hosts: ['duckduckgo.com'],
    // Every kind of result (web, news, video) is one list item.
    containers: 'li[data-layout]',
    panels: '.react-results--sidebar',
  },
  {
    name: 'Steam Community',
    hosts: ['steamcommunity.com'],
    // A topic in a discussion list, the opening post, each reply, and a review card.
    containers: '.forum_topic, .forum_op, .commentthread_comment, .apphub_Card',
    main: '.forum_op',
    threadKey: /\/discussions\/\d+\/(\d+)/,
  },
  {
    name: 'Instagram',
    hosts: ['instagram.com'],
    // A post in the feed, a tile on a search or profile grid, each comment on an opened post, and each
    // reply in the list under a comment. Class names are machine-made and change, so the rule goes by structure.
    containers: `article, a[href*="/p/"]:not([href*="/c/"]), a[href*="/reel/"], main ul > li, main ul > div, ${IG_COMMENT}`,
    threads: IG_COMMENT,
    replyAreas: 'main ul',
  },
  {
    name: 'Kick',
    hosts: ['kick.com'],
    // A stream card, and each line of chat.
    containers: '[data-testid="livestream-results-card"], #chatroom-messages [data-index], article',
    chat: true,
  },
  {
    name: 'Twitch',
    hosts: ['twitch.tv'],
    // A stream card, the title of the stream being watched, and each chat line.
    containers: 'article, [data-a-target="stream-title"], .chat-line__message, [data-a-target="chat-line-message"]',
    chat: true,
  },
  {
    name: 'Facebook',
    hosts: ['facebook.com'],
    // Search results are plain children of the feed, with no article role of their own.
    // Comments, read from a live comments panel with replies opened: a comment's block has two parts,
    // the comment itself (an article alone in its wrapper) and, after it, the area holding its replies
    // (each an article among other things). The block is the unit for a comment, so its replies sit inside it.
    containers: `[role="article"]:not(:only-child), ${FB_COMMENT}, ${FB_POST}, [data-pagelet^="FeedUnit"], [role="feed"] > div`,
    // A post is a thread of its own (its comments are its replies), and so is each comment.
    threads: `${FB_COMMENT}, ${FB_POST}`,
    replyAreas: `${FB_COMMENT} > div:nth-child(n+2)`,
  },
  {
    name: 'Discord',
    hosts: ['discord.com'],
    // Read from the live page: messages are flat <li> items in one list, each holding its own reply
    // preview and link previews. Class names end in a suffix that changes per release, hence the stems.
    containers: 'li[id^="chat-messages-"], [class*="messageListItem"], [data-list-item-id^="channels___"], [class*="searchResult"]',
    chat: true,
  },
  {
    name: 'Gmail',
    hosts: ['mail.google.com'],
    // Read from the live inbox: one <tr class="zA"> per conversation (sender, subject, preview).
    // The open-conversation parts (subject heading, each message) are from public documentation, not read live.
    containers: 'tr.zA, div.adn, h2.hP',
  },
];

export function adapterFor(host: string, path = '/'): Adapter | null {
  // A rule for this part of the site first; then the most specific host: mail.google.com must not get the Google search adapter.
  const hits = ADAPTERS.filter((a) => hostMatches(host, a.hosts) && (!a.path || a.path.test(path)));
  return hits.sort((a, b) => Number(!!b.path) - Number(!!a.path) || longest(b) - longest(a))[0] ?? null;
}

const longest = (a: Adapter) => Math.max(...a.hosts.map((h) => h.length));
