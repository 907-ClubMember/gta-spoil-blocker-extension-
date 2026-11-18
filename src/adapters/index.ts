import { hostMatches } from '../settings';
import { GOOGLE_HOSTS } from './official';

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
  /**
   * Parts of the page that are other things than the page's subject (recommended videos, "more like this" shelves, bundles,
   * a sidebar). On a page about the game their pictures are not covered for that reason: each is judged on its own words
   * (its title, caption or link), as on a page that is not about the game.
   */
  apart?: string;
  /** Regions hidden as one piece when anything in them matches, even though they hold smaller cards. */
  panels?: string;
  /**
   * Card selector -> its direct children (matched by this selector) that stay in view when the card is covered for its words: its header row (community, author, time, menu)
   * and action row (votes, comments, share). Everything else in the card (title, text, media, parts added later) stays covered, and a match
   * inside a kept row covers the whole card.
   */
  keepParts?: Record<string, string>;
  /** Panels (a part of `panels`) that are no panel when they hold two or more cards: they hold results, not one subject. */
  panelSplit?: string;
  /** The cards counted for panelSplit (default: subCards, else containers). */
  splitCards?: string;
  /** Cards that can be blocks of several units of one kind (siblings with the same tag and class): the unit holding a match is the card. */
  subCards?: string;
  /** Containers named by a bare generic tag (an <article>, a list item): such a card longer than a post is not covered whole. */
  cardCap?: string;
  /** Only the host itself (and www.), never a subdomain: Google search, whose subdomains are other products (docs, news, maps). */
  exactHost?: boolean;
  /** Picture layers the player lays over its video (a poster, end-screen tiles): covered whenever the video is. */
  playerLayers?: { player: string; layers: string; play?: string; preview?: string };
  /** Messages are a flat list with no nesting (a chat). */
  chat?: boolean;
  /** A fast chat's message rows (a part of containers): each is judged on its own words at Strict, and a mention covers no later line. */
  chatLines?: string;
  /**
   * Comments whose element also holds the replies under them. Only these can be hidden "own content
   * only" (the reply option); every other card is always hidden whole, because a card that merely
   * contains another card (a search result holding list items) must never be opened up.
   */
  threads?: string;
  /** Which of `threads` are replies (default: all of them). null: none (no reply pictures on this site). */
  replies?: string | null;
  /** Pictures that stand for a post (its thumbnail): covered with the post's other pictures whatever their size. */
  thumbs?: string;
  /** The piece whose arrival makes a box a post, when the post rule needs it inside (a :has()): the post is then read whole. */
  postMaker?: string;
  /** Media a site's own GIF picker inserts, with no library address in it. Reddit, Discord, Bluesky and Facebook are not set: their Giphy/Tenor/Klipy GIFs are caught by host. */
  gifs?: string;
  /** Areas and buttons inside a thread that belong to its replies ("more replies"), never hidden with the comment. */
  replyAreas?: string;
  /**
   * The main post of a thread page, for sites whose replies are not nested but follow it as separate
   * posts. A reply to a main post that names the game counts as being about it, and hiding the main post
   * hides the replies after it too (the reply option; not with `ownReplies`/`ownRepliesOf`: X, Bluesky, Reddit). With `threads` (Reddit, Instagram, Facebook): comments that sit inside the main post
   * (Instagram, Facebook) are covered with it as well, see Scanner `inMain`.
   */
  main?: string;
  /** The page's own post, where comments sit beside it, not inside it (new Reddit): when it is covered for its words, their reply pictures are too. */
  primaryPost?: string;
  /** Links that are only a picture's own link (Facebook photo links): a link of this kind with no words and no label is not a quoted post. */
  picLinks?: string;
  /** Dialogs on this site that are photo viewers (Facebook's): a large covered picture in one makes every cover in it one group, with one bar. */
  viewers?: boolean;
  /** A picture-only post on a page about the game: only its pictures are covered, so its author row stays (Facebook, q14). */
  mediaPostPictures?: boolean;
  /**
   * Per container selector: the part of it that is covered when the container is (an inbox row's subject and preview, not the whole row: the
   * checkbox, star, sender and date stay usable and the row still opens).
   */
  coverParts?: Record<string, string>;
  /**
   * Containers that are covered only for a strong listed name by itself (a Discord channel-list entry: channel names are navigation, so never a
   * weak name, a spoiler word, the game's name, or the chat around it).
   */
  strongOnly?: string;
  /**
   * Pattern whose first group (or whole match) identifies the thread in the address; `main` counts only on a matching address. Tested on the
   * path, and on the path with its query only when the pattern names a "?" (Facebook's permalink.php).
   */
  threadKey?: RegExp;
  /**
   * The replies of a thread page are never covered with its main post (X: a conversation's replies are separate posts by other people,
   * often about something else): each is judged on its own words, the main post naming the game still counting as their context.
   */
  ownReplies?: boolean;
  /** Main posts (a part of `main`) whose replies are judged as with ownReplies, where the site's other main posts keep theirs covered with them. */
  ownRepliesOf?: string;
  /**
   * Comments (a part of `threads`) whose replies are judged on their own words when one is covered, whatever the reply option: each reply
   * under a covered one reads as on a page about the game (replyContext) and gets its own cover and label (Reddit, as X's ownReplies).
   * The comment's own cover must leave its replies out: give it a coverParts entry (the part may sit deep inside the comment).
   */
  ownThreads?: string;
  /** The site's own header (a community's banner, name and tabs): its words are never read, so nothing in it is covered for them. Its pictures: keepClear. */
  siteChrome?: string;
  /** Blocks that end a thread page's replies, whatever they hold (Reddit's "more posts" feed): see Scanner `threadEnd`. */
  threadEnd?: string;
  /** People's names and handles (display names, author lines): never matched against the list. `people`: person cards (their text is not read), except their `bio`, which only a high-risk signal covers. */
  names?: string;
  /** What is never covered as a picture or video: a live stream's player (the owner's rule: its title or card is covered, the player is not), or the site's own artwork (Reddit's sign-up panel). */
  keepClear?: string;
  /**
   * Paths of a feed that mixes everything (a home page, r/all): never about the game as a whole, whatever its title, heading or tags
   * say. Each post there is judged by its own words.
   */
  feeds?: RegExp;
  /**
   * The site moves between its pages without a reload and leaves the first page's description tags in place (Reddit): they count only
   * while the path or the title is still the one they changed with. Not set: a site's tags count on every page (a fan site's tags name the game on all of them).
   */
  staleTags?: boolean;
  /** Addresses where keepClear does not apply (recorded broadcasts, clips). */
  keepClearNot?: RegExp;
  /**
   * The site's own signs that its player (keepClear) is live: in the player, or on the page outside every card and side bar. They win over a
   * finite duration (a live player can hold one for a while), and one that arrives late releases a player covered before it came.
   */
  liveMarks?: string;
  /**
   * The site's own search page (its path): a list of results, each judged on its own words. What was searched for (the address's query, and
   * its echo in the title, heading or description) does not make the page about the game. A search engine's results page is not one.
   */
  searchPath?: RegExp;
  /** Pictures and videos laid over a card from a layer of their own elsewhere in the page (a hover preview): judged and covered with the card under them. */
  overCards?: boolean;
  /** A category's or game's box art (official cover art, the owner's rule): never covered as a picture. Known by structure: its link or its file's address. */
  boxArt?: string;
  people?: string;
  bio?: string;
  /**
   * The comments of a thread page sit inside the main post (Instagram, Facebook): these blocks are its replies, nothing after it. Covered with
   * it (Scanner `inMain`), or with `ownReplies` (both sites from 0.1.8) left out of its cover and judged on their own words (Scanner `ownMain`).
   */
  commentsInside?: string;
  /** Cards that count only on a thread page (where `threadKey` matches the address), never on a feed. See Scanner `syncCards`. */
  threadCards?: string;
  /** Where the main post sits on a thread page whose post holds its comments, before its first comment makes it one. See Scanner `refreshMain`. */
  mainBlock?: string;
  /** Blurred covers take their own clicks and stop them: none reaches the site's own handler under a covered picture. */
  swallowClicks?: boolean;
  /**
   * A post's own pictures that are cards of their own (Instagram's carousel slides): judged with the post around them (its caption names the
   * game, so they are next to it), and one press shows them with it. A comment is never one (`commentsInside`).
   */
  slides?: string;
  /**
   * The page's own post (a video's watch page): `owner` is every place its author's link sits. When that author is a
   * spoiler account, the post around the link is hidden if it is one of `parts` (one short in a feed of shorts),
   * else everything matching `page` (the watch page's title and description, player and description panel); any
   * video inside is paused.
   */
  ownPage?: { owner: string; parts?: string; page: string };
  /** Discord: link previews (embeds) and attachments, judged with the server and channel the message is in. See src/content/discord-embeds.ts. */
  embeds?: boolean;
}

// Instagram, read from a live opened post (replies loaded): every comment and reply links to its own
// address (/c/…). Comments are a run of sibling blocks; each block holds the comment's own row and,
// under it, a list of its replies. A block is recognised as one of at least three such siblings in a
// row, which leaves out the two-part inside of a single comment (its row and its replies area).
// ":has" cannot sit inside another ":has", so the following-sibling halves spell their link out. Siblings, not next siblings: the bar of a
// covered comment goes in front of it, and must not break the run (the comments around it would fall to the post as their card).
const IG_LINK = 'a[href*="/c/"]';
const IG_COMMENT = [
  `div:has(${IG_LINK}):has(~ div ~ div ${IG_LINK})`,
  `div:has(${IG_LINK}) ~ div:has(${IG_LINK}):has(~ div ${IG_LINK})`,
  `div:has(${IG_LINK}) ~ div:has(${IG_LINK}) ~ div:has(${IG_LINK})`,
].join(', ');
// A comment of a post dialog's list even when it is the only one (read from a saved post dialog: article > … > ul > div[role=button] > li,
// the li holding the comment's /c/ link; the caption entry has none). IG_COMMENT needs a run of them, so a lone comment was no card: its
// words counted as the post's, and a press on the post's tile showed it with the post (0.1.10).
const IG_LONE = `article ul > div:has(> li ${IG_LINK})`;
// An opened post as the live site builds it (read from post pages, at /p/<id>/ and /<user>/p/<id>/): no article and no list. The main
// holds one wrapper: the post (its pictures and the comments side; the comments are plain blocks each with its comment link), a line, and
// a grid of the author's other posts. The post is the wrapper's block with the comment links, so the grid is never covered with it.
// A post with no comment yet holds no comment link, and has nothing to cover under it. Never a block that holds articles (a feed) or a
// post dialog.
const IG_POST = `main > div > div:has(${IG_LINK}):not(:has(article, [role="dialog"]))`;

// Facebook: the block around one comment and the replies under it.
const FB_COMMENT = 'div:has(> div:first-child > [role="article"]:only-child)';
// A comment for the reply-picture rule: the same block, but only when its article carries a label (live: every comment does, a
// post's own article never does). A post whose article is alone in a wrapper, with no comments loaded, is then not taken for a reply.
// A feed cell, a dialog or a pagelet is where a post lives, so it is never a comment block, and an article with aria-posinset, or one in a
// wrapper with it, is a feed post.
const FB_REPLY = 'div:not([role="feed"] > div):not([role="dialog"]):not([data-pagelet]):has(> div:first-child:not([aria-posinset]) > [role="article"][aria-label]:not([aria-posinset]):only-child)';
// ...and a post that holds its own comments: a cell of a feed (group or page), a post article, or the
// dialog a post opens in. Read from a group feed, a group post page and a page post page: a post's own
// words are not an article there, but each comment is, and carries a label. That label is the mark of a
// comment (its words differ by language, its presence does not).
const FB_HAS_COMMENTS = ':has([role="article"][aria-label])';
const FB_POST = `[role="feed"] > div${FB_HAS_COMMENTS}, [role="article"]:not([aria-label])${FB_HAS_COMMENTS}, [role="dialog"]${FB_HAS_COMMENTS}`;
// The post of a post's own page (B-035): its article (no label; a comment's and a reply's carry one), the outermost one, whether its comments
// have loaded or not. A dialog that holds one (a post opened over the feed at its address) leaves out what is under it. It must hit once: a page
// with more than one post box (or none) has no main post, and is judged as a feed.
const FB_TOP = '[role="article"]:not([aria-label]):not([role="article"] *)';
const FB_MAIN = `[role="dialog"] ${FB_TOP}, body:not(:has([role="dialog"] ${FB_TOP})) ${FB_TOP}`;
// A post's own address: /<page>/posts/<id>, /groups/<group>/posts/<id> (or /permalink/<id>), /permalink.php?story_fbid=<id>. Never a feed, a
// search, a photo or a video. The key is the whole match, or the story id for permalink.php; the query counts only here (the pattern names a "?").
const FB_THREAD = /^\/(?:groups\/[^/]+\/(?:posts|permalink)\/[^/?#]+|(?!groups\/|permalink\.php)[^/]+\/posts\/[^/?#]+|permalink\.php\?(?:[^#]*&)?story_fbid=([^&#]+))/;


export const ADAPTERS: Adapter[] = [
  {
    name: 'YouTube',
    hosts: ['youtube.com'],
    containers: [
      'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer', 'ytd-grid-video-renderer',
      'ytd-reel-item-renderer', 'ytd-playlist-renderer', 'ytd-channel-renderer', 'ytd-comment-thread-renderer',
      'yt-lockup-view-model', 'ytm-shorts-lockup-view-model',
      // The player's autoplay card at a video's end ("Up next in 5"): another video, judged on its own title and channel (0.1.10).
      '.ytp-autonav-endscreen-upnext-container',
    ].join(', '),
    // Its thumbnail is a box painted with a background picture, filled in and laid out only when the video ends: named, it is a picture
    // whatever its size then.
    thumbs: '.ytp-autonav-endscreen-upnext-thumbnail',
    // Its cover is the part with the thumbnail, title and channel: Cancel and Play now beside it stay pressable.
    coverParts: { '.ytp-autonav-endscreen-upnext-container': ':is(a, div):has(.ytp-autonav-endscreen-upnext-thumbnail):has(.ytp-autonav-endscreen-upnext-title):not(:has(.ytp-autonav-endscreen-upnext-cancel-button, .ytp-autonav-endscreen-upnext-play-button))' },
    // Read from a live video page: a reply is itself a comment thread, nested in its parent's replies area.
    threads: 'ytd-comment-thread-renderer',
    replyAreas: 'ytd-comment-replies-renderer',
    // A person's display name or handle is never matched against the list (0.1.8 audit, as on X): a name written as a spoiler is still caught.
    names: '#author-text',
    // Only the watch page's recommendations and its shorts shelf: not #secondary as a whole (the chapters and description panels
    // there are this video), and not a shorts shelf on a search or channel page (there the shorts are what the page is about).
    apart: '#related, ytd-watch-next-secondary-results-renderer, ytd-watch-flexy ytd-reel-shelf-renderer, .ytp-autonav-endscreen-upnext-container',
    // With autoplay off the player shows a poster over the video (not the video), and at the end other videos' tiles and cards.
    // The progress bar's frame preview and the up-next tile are named from memory, not read from a saved page (unverified).
    // The hover player of search and home results is mounted once in the page and laid over the card under the pointer (0.1.10).
    playerLayers: { player: '.html5-video-player', layers: '.ytp-cued-thumbnail-overlay-image, .ytp-endscreen-content, .ytp-videowall-still, .ytp-ce-element, .ytp-tooltip-bg, .ytp-autonav-endscreen-upnext-thumbnail', play: '.ytp-large-play-button', preview: 'ytd-video-preview, #video-preview' },
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
    // message is one chat line, judged like Kick and Twitch: on its own words at Strict. Element names from
    // YouTube's public page structure.
    name: 'YouTube live chat',
    hosts: ['youtube.com'],
    path: /^\/live_chat(_replay)?\b/,
    containers: 'yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer, yt-live-chat-paid-sticker-renderer, yt-live-chat-membership-item-renderer',
    chat: true,
    chatLines: 'yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer, yt-live-chat-paid-sticker-renderer, yt-live-chat-membership-item-renderer',
    // A person's display name or handle is never matched against the list (0.1.8 audit, as on X): a name written as a spoiler is still caught.
    names: '#author-name',
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
    // A person's display name or handle is never matched against the list (0.1.8 audit, as on X): a name written as a spoiler is still caught.
    // Old Reddit's author link (not the flair, which is free text); new Reddit's author links in a post's or comment's header.
    names: '.tagline a.author, [slot="commentMeta"] a[href*="/user/"], [slot="credit-bar"] a[href*="/user/"], rs-timeline-event-hovercard',
    primaryPost: 'shreddit-post, #siteTable .thing.link',
    // A post page: the post is the one main post; its comments follow it in the page, not inside it.
    main: 'shreddit-post[view-context="CommentsPage"], #siteTable .thing.link',
    threadKey: /\/comments\/(\w+)/,
    // Old Reddit (0.1.7 report), and new Reddit (0.1.8): the comments were covered with a covered post, one blur down the whole column with
    // one label at the top. Each comment is judged on its own words, so every cover is one post or one comment with its own label.
    ownRepliesOf: '.thing.link, shreddit-post',
    // ...and a covered comment never holds its replies under its one label: its cover is its own part (old Reddit's .entry: tagline, words,
    // buttons; new Reddit's words, slot "comment"), never its replies, and each reply is judged on its own words as a reply of it (the reply
    // option does not apply).
    ownThreads: '.thing.comment, shreddit-comment',
    // (A bar takes the slot of what it covers, so it is never the part.)
    coverParts: { '.thing.comment': ':scope > .entry', 'shreddit-comment': '[slot="comment"]:not(.gsb-bar)' },
    // New Reddit (0.1.8 report): a post covered for its words keeps its header row and its action row (where it is a child of the post,
    // as in the test copies; drawn inside the post's shadow root it is never covered anyway) in view.
    keepParts: { 'shreddit-post': '[slot="credit-bar"], [data-testid="action-row"]' },
    // The "more posts" feed after the comments is not part of the thread.
    threadEnd: '#mosaic-pdp-feed',
    thumbs: '.thing a.thumbnail img, shreddit-post [slot="thumbnail"] img, shreddit-post img[slot="thumbnail"], faceplate-img[data-testid="search_post_thumbnail"]',
    replyAreas: 'faceplate-partial[slot="children"], a[slot="more-comments-permalink"], .thing.morechildren',
    // A picture-only post on a page about the game: the picture is covered, not the post (its author row, title, votes and comments stay).
    mediaPostPictures: true,
    // The logged-out sign-up panel beside the feed and threads (read from a saved page): Reddit's own artwork behind "Join ...", never a spoiler.
    // Old Reddit: a subreddit's header (its banner picture, its style's banner, its name and tabs) is the subreddit's own branding (0.1.7 report).
    keepClear: 'faceplate-tracker[noun="static_left_rail_banner"], #header',
    // ...and its words (a custom tab "Spoiler megathread"): never covered either.
    // ...and the Chats window's room header, typing line and composer (0.1.10 report: the window was covered as one). The thread list's
    // previews and the room's pinned banners are other people's words: read like messages.
    siteChrome: '#header, rs-app-window-controls, rs-room-typing-banner, rs-message-composer',
    // In the Chats window each message (rs-timeline-event) is judged on its own, the viewer's own too: the window gives no unique id for the
    // signed-in user to match a sender by, and a display name can be copied.
    // The home feed (both layouts, each sort) and r/all, r/popular: a mix of every community.
    // Moving from a thread to the feed in place leaves the thread's tags in the head.
    staleTags: true,
    feeds: /^\/(?:(?:best|hot|new|top|rising|controversial)\/?)?$|^\/r\/(?:all|popular)(?:\/(?:best|hot|new|top|rising|controversial)?\/?)?$/i,
  },
  {
    name: 'X',
    hosts: ['x.com', 'twitter.com'],
    containers: 'article[data-testid="tweet"], [data-testid="trend"], [data-testid="UserCell"]',
    names: '[data-testid="User-Name"], [data-testid="UserName"], [data-testid="socialContext"]',
    people: '[data-testid="UserCell"], [data-testid="HoverCard"]',
    bio: '[data-testid="UserDescription"]',
    // On a tweet's own page the main tweet is the one the page focuses (tabindex -1); replies follow it.
    main: 'article[data-testid="tweet"][tabindex="-1"]',
    threadKey: /\/status\/(\d+)/,
    // A covered main post does not cover the conversation (0.1.5 report: every reply covered, none with a label): each reply is judged on its own words.
    ownReplies: true,
    gifs: 'video[src*="/tweet_video/"]',
    // Search's media tab is a grid of post pictures outside any post (read from the live site): in a narrow window each tile is
    // 119 px, under the size floor for pictures. Each tile is a picture of a post, so it counts whatever its size.
    thumbs: 'li[role="listitem"] a[href*="/status/"][href*="/photo/"] img, li[role="listitem"] a[href*="/status/"][href*="/video/"] img',
    // The right-hand column (trends, who to follow, news cards) is not what a search is about: its pictures go by their own words.
    apart: '[data-testid="sidebarColumn"]',
    // A picture-only post: the picture is covered, not the post (the User-Name and the action row stay).
    mediaPostPictures: true,
    // A post covered for its words keeps its author row (avatar, name, handle, time, menu) and its action bar in view (0.1.7 report); a post
    // quoted in it is covered. The rows are kept only when they name nothing on the list (a name written as a spoiler covers them).
    keepParts: { 'article[data-testid="tweet"]': '[data-testid="Tweet-User-Avatar"], [data-testid="User-Name"], [data-testid="caret"], div[role="group"]' },
  },
  {
    name: 'Google',
    hosts: GOOGLE_HOSTS,
    // A related search is a plain <li> in a generic wrapper (read from the live site): the wrapper holding one row is its unit.
    containers: '.MjjYud, div.g, g-card, .SoaBEf, li.sbct, [role="listitem"], .WYczDe:has(> li)',
    // The side column about a person or game: all of it is about the same subject. The entity layout's .kp-wholepage can also hold the
    // tabs and the whole results column (0.1.8 audit): then (the results column, or several results in it) it is no panel, and each
    // result is its own card.
    panels: '#rhs, .kp-wholepage:not(:has(#rso)):not(:has(#search))',
    panelSplit: '.kp-wholepage',
    // Only results split it, never a panel's own news cards (g-card): as at 0.1.8, also while units are off.
    splitCards: '.MjjYud',
    cardCap: '[role="listitem"]',
    exactHost: true,
    // A result block can hold several units of one kind (0.1.8 reports: "People also ask" rows with their answers, "What people are saying"
    // post cards and topic rows): each is its own card. Found by structure (siblings of one kind), not read from a live page.
    subCards: '.MjjYud',
  },
  // The rules below were written from each site's live page structure (read-only, structure only).
  {
    name: 'Bluesky',
    hosts: ['bsky.app'],
    // A post in a feed or search, and each post in an opened thread. Replies are siblings, not nested. Search results carry
    // neither test id (read from the live site): there a post is the link box that holds its own like button.
    containers: '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"], div[role="link"]:has([data-testid="likeBtn"])',
    // The like button can arrive after the words and pictures: only then is the box a post.
    postMaker: '[data-testid="likeBtn"]',
    // In an opened thread the replies are links (role="link"); the main post is not.
    main: '[data-testid^="postThreadItem-by-"]:not([role="link"])',
    // A covered main post does not cover the replies after it (0.1.8, as on X): each reply is judged on its own words, with its own label.
    ownReplies: true,
    // The author (handle or DID, a leading @ left out) and the post's record key: a record key is unique per author only, so the key is both.
    // A handle on one side and the DID on the other only fails toward covering. (Instagram shortcodes, X status ids, Reddit post ids and
    // Steam topic ids are unique across the site: their keys are the id alone.)
    threadKey: /\/profile\/@?([^/?#]+\/post\/[^/?#]+)/,
    // A post's pictures sit in its own picture buttons, which open the photo viewer: a covered picture takes the click itself, only its bar
    // shows it (q22).
    swallowClicks: true,
  },
  {
    name: 'Threads',
    hosts: ['threads.com', 'threads.net'],
    // Read from a live profile and a post page: every post and every reply is one
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
    // A person's display name or handle is never matched against the list (0.1.8 audit, as on X): a name written as a spoiler is still caught.
    names: '.commentthread_author_link, .forum_op_author',
    main: '.forum_op',
    threadKey: /\/discussions\/\d+\/(\d+)/,
    // 0.1.8: a covered opening post does not cover the replies after it (one blur, no label of their own): each is judged on its own words, as on X.
    ownReplies: true,
  },
  {
    name: 'Steam store',
    hosts: ['store.steampowered.com'],
    // Read from a saved logged-out app page. The store's own lists have machine-made class names; its stable hooks are the
    // data-featuretarget names and ids. A review is the classless block that holds one reviewer's avatar (the avatar carries
    // data-status-position), found by structure: the innermost such block.
    containers: '[data-featuretarget="appreviews"] div:not([class]):has([data-status-position]):not(:has(div:not([class]) [data-status-position]))',
    // The app's own pictures (header capsule, #game_highlights player and strip, description) are not listed here, so a page about the
    // game covers them. Other games' capsules, bundles, curators and the site header are judged on their own words.
    // The reviews are about this game, so they are not listed: on its store page a review with a spoiler word is still hidden.
    apart: '[data-featuretarget="storeitems-carousel"], .game_area_purchase_game, .steam_curators_block, #global_header',
  },
  {
    name: 'Instagram',
    hosts: ['instagram.com'],
    // A post in the feed, a tile on a search or profile grid, each comment on an opened post, and each
    // reply in the list under a comment. Class names are machine-made and change, so the rule goes by structure.
    containers: `article, a[href*="/p/"]:not([href*="/c/"]), a[href*="/reel/"], main ul > li, main ul > div, ${IG_COMMENT}, ${IG_LONE}`,
    // The live post page's whole post (IG_POST) is a card too, its caption next to its picture: on a post's address only, never on a feed.
    threadCards: IG_POST,
    // Where that post box sits (IG_POST without its conditions): the one block tried when a node lands in a post with no comment yet.
    mainBlock: 'main > div > div',
    // A post's pictures sit in its own buttons and links (read live): a double-click there likes the post. A covered picture takes the
    // click itself; only its bar shows it.
    swallowClicks: true,
    threads: `${IG_COMMENT}, ${IG_LONE}`,
    replyAreas: 'main ul',
    // An opened post (its own page, or a dialog over the feed or a profile, at the post's address): the one post article. Its comments sit
    // inside it (from 0.1.8 judged on their own words: ownReplies below). The feed and profile pages are not thread pages; a feed behind a post dialog is not the main post.
    // The live post page (IG_POST) when no dialog holds a post.
    main: `[role="dialog"] article, body:not(:has([role="dialog"] article)) main article, body:not(:has([role="dialog"] :is(article, ${IG_LINK}))) ${IG_POST}`,
    // /p/<id>/ and /reel/<id>/, also under the author's name (/<user>/p/<id>/).
    threadKey: /\/(?:p|reel)\/([\w-]+)/,
    // A comment there: a block of the comment run, two blocks side by side (two comments make no run; inside one comment this can also
    // take its row and its replies area, which only covers the same comment twice), or any list entry with a comment link. A picture of
    // the post's carousel (a list entry with no comment link) is not one. A lone comment on the live page is not told apart.
    commentsInside: `${IG_COMMENT}, div:has(${IG_LINK}):has(~ div ${IG_LINK}), div:has(${IG_LINK}) ~ div:has(${IG_LINK}), ul > div:has(${IG_LINK}), ul > li:has(${IG_LINK})`,
    // A slide of a post's carousel (feed or opened post): a list entry in the post with no comment link.
    slides: `article ul > li:not(:has(${IG_LINK}))`,
    // 0.1.8: a covered post does not cover its comments (one blur, no label of their own): its cover is its own content, and each comment is
    // judged on its own words as a reply of it, with its own cover and label (as on X). See Scanner ownMain.
    ownReplies: true,
  },
  {
    name: 'Kick',
    hosts: ['kick.com'],
    // A category tile's box art (a picture in a /category/ link): official cover art, never covered. The address shape is the one the
    // live structure reads open (kick.com/category/<slug>, scripts/read-structure.js); the tile's own markup has no saved page yet.
    boxArt: 'a[href^="/category/"] img, a[href^="https://kick.com/category/"] img',
    // A stream card, and each line of chat.
    containers: '[data-testid="livestream-results-card"], #chatroom-messages [data-index], article',
    cardCap: 'article',
    // The live player (read live: #injected-channel-player holds the <video id="video-player">): never covered, muted or paused. Recorded media is not live.
    keepClear: '#injected-channel-player, #video-player',
    keepClearNot: /\/(?:video|videos|clips?)\/|[?&]clip=/,
    chat: true,
    chatLines: '#chatroom-messages [data-index]',
  },
  {
    name: 'Twitch',
    hosts: ['twitch.tv'],
    // twitch.tv/search?term=...: a search for the game is not a page about it; each card is judged on its own title, category and tags.
    searchPath: /^\/search\/?$/,
    // The hover preview of a card can be mounted outside the card, laid over it: it goes with that card.
    overCards: true,
    // Box art (read from the saved directory page: ttv-boxart pictures, category links): official cover art, never covered.
    boxArt: 'img[src*="/ttv-boxart/"], a[href*="/directory/category/"] img, a[href*="/directory/game/"] img',
    // A stream card, the title of the stream being watched, and each chat line.
    containers: 'article, [data-a-target="stream-title"], .chat-line__message, [data-a-target="chat-line-message"]',
    cardCap: 'article',
    keepClear: '[data-a-target="video-player"]',
    // Recorded media: a broadcast, a clip, and an embedded player of one (player.twitch.tv/?video=, ?clip=, ?collection=).
    keepClearNot: /^clips\.twitch\.tv|\/videos\/|\/clip\/|[?&](?:video|clip|collection)=/,
    // A live channel's LIVE pill, viewer count and stream timer (0.1.10 report, logged out: they can come after the player). The saved directory
    // page has the same pill on every live card, inside its <article> (a card, so it never counts for a player).
    liveMarks: '.tw-channel-status-text-indicator, [data-a-target="animated-channel-viewers-count"], .live-time',
    chat: true,
    chatLines: '.chat-line__message, [data-a-target="chat-line-message"]',
    // A person's display name or handle is never matched against the list (0.1.8 audit, as on X): a name written as a spoiler is still caught.
    names: '.chat-line__username, .chat-author__display-name',
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
    // Read from live public Page posts: a comment's block (see FB_REPLY). Posts, shared posts, galleries and videos keep the usual rule.
    replies: FB_REPLY,
    picLinks: 'a[href*="/photo.php?"], a[href*="/photo/?"], a[href*="/photos/"]',
    viewers: true,
    mediaPostPictures: true,
    replyAreas: `${FB_COMMENT} > div:nth-child(n+2)`,
    // On a post's own page the comments sit inside the post (B-035; from 0.1.8 each is judged on its own words as a reply of it, ownReplies
    // below). A comment's block (it holds its replies), and a labelled article with siblings (a reply that is a post box of its own).
    main: FB_MAIN,
    threadKey: FB_THREAD,
    commentsInside: `${FB_REPLY}, [role="article"][aria-label]:not(:only-child)`,
    // 0.1.8: as on Instagram, each comment is judged on its own words as a reply of the covered post, with its own cover and label.
    ownReplies: true,
  },
  {
    name: 'Discord',
    hosts: ['discord.com'],
    // Read from the live page: messages are flat <li> items in one list, each holding its own reply
    // preview and link previews. Class names end in a suffix that changes per release, hence the stems.
    containers: 'li[id^="chat-messages-"], [class*="messageListItem"], [data-list-item-id^="channels___"], [class*="searchResult"]',
    chat: true,
    chatLines: 'li[id^="chat-messages-"], [class*="messageListItem"]',
    // A person's display name or handle is never matched against the list (0.1.8 audit, as on X): a name written as a spoiler is still caught.
    names: '[class^="username_"], [class*=" username_"]',
    // A channel-list entry is covered only for a strong listed name by itself (answer f02).
    strongOnly: '[data-list-item-id^="channels___"]',
    // Link previews and attachments: covered out of caution in a game server or channel, read to their end, judged as on their own site.
    embeds: true,
  },
  {
    name: 'Gmail',
    hosts: ['mail.google.com'],
    // Read from the live inbox: one <tr class="zA"> per conversation (sender, subject, preview).
    // The open-conversation parts (subject heading, each message) are from public documentation, not read live.
    containers: 'tr.zA, div.adn, h2.hP',
    // Only the subject and preview of a row are covered (answer f03): the checkbox, star, sender and date stay usable, the row opens.
    coverParts: { 'tr.zA': 'div.xS' },
  },
];

export function adapterFor(host: string, path = '/'): Adapter | null {
  // A rule for this part of the site first; then the most specific host: mail.google.com must not get the Google search adapter.
  const hits = ADAPTERS.filter((a) => hostMatches(host, a.hosts) && appHost(host, a) && (!a.path || a.path.test(path)));
  return hits.sort((a, b) => Number(!!b.path) - Number(!!a.path) || longest(b) - longest(a))[0] ?? null;
}

// A site's own pages that are not its app (a blog, help centre, docs, developer or business pages): ordinary articles, read with the
// general rules. A site rule there would take a whole long article for one post (blog.twitch.tv: every <article> is a Twitch card).
const NON_APP = /(?:^|\.)(?:blog|help|about|support|developers?|dev|docs|business|status|press|newsroom|careers|jobs|investors?|safety|transparency|engineering|brand|legal|policies|ads)$/;

/** Is `host` the site's app, not one of its other pages? (The rule's own host entries always are: mail.google.com is Gmail's.) */
function appHost(host: string, a: Adapter): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  const entry = a.hosts.find((e) => h === e || h.endsWith('.' + e));
  if (!entry || h === entry) return true;
  const sub = h.slice(0, -(entry.length + 1));
  return !a.exactHost && !NON_APP.test(sub);
}

const longest = (a: Adapter) => Math.max(...a.hosts.map((h) => h.length));
