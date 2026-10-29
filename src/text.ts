// Every label and explanation shown in the popup and settings lives here, so the wording
// stays plain and consistent. Rule: someone should understand each option without reading docs.

export const STRICTNESS_TEXT = {
  light: {
    name: 'Light: only obvious spoilers',
    help: 'Hides only things that clearly give away the story. Fewest mistakes, but vague posts can slip through.',
  },
  medium: {
    name: 'Medium: recommended',
    help: 'Also hides character and place names when the post, its thread, or the page mentions GTA 6, when a post contains two such names, or when a name sits next to a hint word like "mission" or "hate". Hides posts that name GTA 6 with a spoiler word such as "ending", and picture or video posts on pages about the game. A good balance.',
  },
  strict: {
    name: 'Strict: hide anything suspicious',
    help: 'Hides anything containing a known name or term, even if the post never mentions GTA 6. Safest, but it will sometimes hide unrelated things.',
  },
} as const;

export const HIDE_MODE_TEXT = {
  blur: {
    name: 'Blur it, click to reveal',
    help: 'The spoiler is blurred with a short label such as "Hidden: story spoiler". Click to show it. Best if you want to peek later.',
  },
  collapse: {
    name: 'Collapse it to a small line',
    help: 'The spoiler is taken out of the page and a small grey line such as "Hidden: story spoiler" is left in its place. Click the line to show it. Keeps feeds tidy.',
  },
  remove: {
    name: 'Remove it completely',
    help: 'The spoiler disappears from the page with no trace. Best if you never want to see that something was hidden.',
  },
} as const;

export const PRESET_TEXT = {
  casual: { name: 'Casual', help: 'Light filtering, a gentle blur. Only obvious spoilers; pictures are left alone unless their own words give something away.' },
  careful: { name: 'Careful (default)', help: 'Medium filtering with the usual blur. A good balance.' },
  blackout: { name: 'Total blackout', help: 'Strict filtering, solid boxes, and anything hidden is removed with no label. For people who want to see nothing.' },
  custom: { name: 'Custom', help: 'You have changed something below. Pick a preset to start again from one.' },
} as const;

export const BLUR_TEXT = {
  light: { name: 'Light blur', help: 'You can still make out shapes and colours.' },
  medium: { name: 'Medium blur', help: 'Text and pictures are unreadable. The usual choice.' },
  heavy: { name: 'Heavy blur', help: 'A thick smear. Nothing can be made out.' },
  solid: { name: 'Solid box', help: 'A plain dark box. Nothing of the content shows through at all.' },
} as const;

export const REVEAL_TEXT = {
  click: { name: 'One click', help: 'Click the label to show it.' },
  twice: { name: 'Click twice', help: 'Click the label, then click again to confirm. Stops accidental reveals.' },
  hold: { name: 'Hold to peek', help: 'The content is shown only while you hold the label down. Works with blur; other styles use one click.' },
} as const;

export const CATEGORY_MODE_TEXT = {
  always: 'Always (follows how careful it is)',
  mention: 'Only when the page is about GTA 6',
  off: 'Never hide this kind',
} as const;

export const PROTECT_TEXT = {
  big: { name: 'Only the big stuff', help: 'Hides only the biggest moments: how missions go, deaths, twists and the ending. Everything else is left alone.' },
  story: { name: 'Main story (recommended)', help: 'Also hides the main characters, the groups in the story and the main missions. Side characters, small places and secrets are left alone.' },
  all: { name: 'Everything', help: 'Hides everything on the list that could give the story away, including side characters, secrets and collectibles.' },
  custom: { name: 'Custom', help: 'You changed one of the choices below. The rows you did not change still work as the button you started from, so a side character who turns out to matter stays hidden. Pick one of the other buttons to start again from it.' },
} as const;

export const KIND_MODE_TEXT = {
  always: 'Hide',
  mention: 'Only with game mention',
  off: 'Show',
} as const;

// Short, plain labels for each kind of list entry. The examples are invented names, never real ones.
export const KIND_TEXT = {
  lead: { name: 'Main characters', example: 'Example: the hero, "Dax Orrel"' },
  cast: { name: 'Other story characters', example: 'Example: a gang leader, "Mina Holt"' },
  side: { name: 'Side characters', example: 'Example: a shopkeeper you meet twice, "Pip Varga"' },
  minor: { name: 'Walk-on characters', example: 'Example: a taxi driver in one scene' },
  group: { name: 'Gangs and groups', example: 'Example: "the Northside Crew"' },
  brand: { name: 'Brands and businesses', example: 'Example: a made-up burger chain' },
  setting: { name: 'Cities and regions', example: 'Example: "Port Valmere"' },
  area: { name: 'Towns, streets and landmarks', example: 'Example: "Old Dock Street"' },
  storyplace: { name: 'Places that matter to the story', example: 'Example: a secret hideout' },
  mission: { name: 'Story missions', example: 'Example: "The Harbour Swap"' },
  heist: { name: 'Heists', example: 'Example: "The Glass Tower Job"' },
  chapter: { name: 'Chapters and acts', example: 'Example: "Chapter 4"' },
  final: { name: 'Last missions and epilogue', example: 'Example: the very last mission' },
  sidejob: { name: 'Side missions and strangers', example: 'Example: a favour for a stranger' },
  fate: { name: 'Deaths and fates', example: 'Example: who lives and who dies' },
  twist: { name: 'Twists and story choices', example: 'Example: a hidden betrayal' },
  secret: { name: 'Secrets and easter eggs', example: 'Example: a hidden room' },
  myth: { name: 'Myths and rumours', example: 'Example: a legend fans swear is true' },
  unlock: { name: 'Unlocks and rewards', example: 'Example: a car you earn' },
  collect: { name: 'Collectibles', example: 'Example: hidden packages' },
  other: { name: 'New or other things', example: 'Example: a new kind of thing the game adds' },
} as const;

export const KIND_GROUP_TEXT = {
  people: 'People',
  groups: 'Groups and brands',
  places: 'Places',
  missions: 'Missions',
  moments: 'Big moments',
  gameplay: 'Gameplay',
  other: 'Other',
} as const;

/** Names for the popup's "what was hidden here" line: the kind groups plus hides that are not list names. */
export const HIDDEN_GROUP_TEXT = {
  ...KIND_GROUP_TEXT,
  words: 'Spoiler words',
  media: 'Pictures and video',
  custom: 'Your own words',
  accounts: 'Spoiler accounts',
} as const;

export const RARE_TEXT = {
  heading: 'Made-up names',
  name: 'Rare made-up names',
  help: 'Side characters with an unusual invented name, like "Wendel Trusk". Such a name almost never turns up outside the game, so seeing one also tells the extension a post is about GTA 6.',
} as const;

export const ORDINARY_TEXT = {
  name: 'Ordinary-sounding names',
  help: 'Names that are also everyday words or first names. They are easy to hide by mistake, so pick how much to trust them.',
  options: { light: 'Never hide them', medium: 'Only with game mention', strict: 'Always hide them' },
} as const;

export const PART_TEXT = {
  titles: { name: 'Headlines, titles and thumbnails', help: 'Video and post titles and headings.' },
  comments: { name: 'Comments and replies', help: 'The comment sections under posts and videos.' },
  search: { name: 'Search results pages', help: 'Pages that list the results of a search.' },
  sidebar: { name: 'Sidebars and recommended', help: 'Side columns, "up next" and related lists.' },
  news: { name: 'News articles', help: 'The text of articles on news sites.' },
} as const;

export const REPLIES_TEXT = {
  all: {
    name: 'Hide the replies under it too',
    help: 'The comment and every reply under it are hidden behind one label. Replies to a spoiler usually repeat it. One hidden comment can blank a long chain of harmless replies; one click on the label shows them all.',
  },
  own: {
    name: 'Hide only that comment',
    help: 'Each reply under it is checked on its own: a spoiler reply gets its own label, a clean one stays readable. A reply that repeats the spoiler without a listed name or the name of the game will show.',
  },
} as const;

export const MEDIA_NEAR_TEXT = {
  off: {
    name: 'Do not blur pictures just for being near the name',
    help: 'A picture or video is only hidden when its own caption or file name gives something away, or by the two options above.',
  },
  page: {
    name: 'On pages about GTA 6: recommended',
    help: 'On a page that is about the game, such as a search for it, a fan community or a news story, every large picture and video is blurred. The extension cannot see inside a picture, so it cannot tell a spoiler from anything else: official art, trailer thumbnails and memes on those pages are blurred too. The words beside the picture stay readable. One click on the label shows the picture. Only works on Medium and Strict, and only while the first box above is ticked.',
  },
  post: {
    name: 'Anywhere GTA 6 is named beside the picture',
    help: 'Everything in the choice above. Also, on any page, a large picture or video is blurred when GTA 6 is named in its caption, in the link around it, or in the post it belongs to. This catches the most, and blurs the most harmless pictures: official art, trailer thumbnails and memes in your everyday feeds too. The words beside the picture stay readable. One click on the label shows the picture.',
  },
} as const;

export const CATEGORY_TEXT = {
  story: { name: 'Story and missions', help: 'Plot points, mission names, and endings.' },
  characters: { name: 'Characters', help: 'Names of characters and who they are.' },
  map: { name: 'Map and locations', help: 'Places and areas in the game world.' },
  gameplay: { name: 'Gameplay and secrets', help: 'New features, side activities, collectibles, and hidden secrets.' },
  leaks: { name: 'Leaks and rumors', help: 'Leaked footage, insider claims, and unconfirmed details.' },
  trailers: { name: 'Trailers and reveals', help: 'Trailer breakdowns and official reveal coverage.' },
} as const;

export const UPDATE_TEXT = {
  hourly: 'Every hour (recommended): new spoilers get hidden within the hour',
  '6h': 'Every 6 hours',
  daily: 'Once a day',
  manual: 'Only when I press "Update spoiler list now"',
} as const;

export const TEXT = {
  masterOn: 'Spoiler blocking is ON. Spoilers on the pages you visit are being hidden.',
  masterOff: 'Spoiler blocking is OFF. Nothing is being hidden.',
  masterToggle: 'Turn spoiler blocking on or off everywhere',
  hideImages: {
    name: 'Also hide spoiler pictures and video thumbnails',
    help: 'Hides an image when its caption, alt text, or file name gives something away. It cannot see inside the picture itself, so a spoiler shown only in the image can still get through.',
  },
  hideMediaPosts: {
    name: 'Hide picture and video posts on pages about GTA 6',
    help: 'The extension cannot see inside a picture or a video. On a page that is about the game, such as a search for it or a fan community, a post that is only a picture or clip with almost no words is hidden, in case it shows a spoiler. This also hides harmless clips on those pages. It never applies on pages that are not about the game, and it only works on Medium and Strict. Turn it off if too much is hidden.',
  },
  mediaNearGame: 'Pictures next to the name of the game',
  customWords: {
    name: 'My own words to hide',
    help: 'Anything you add here is hidden on every page, at every strictness level. One word or phrase at a time. You can also select text on a page, right-click, and choose "Hide this on every page".',
    placeholder: 'Type a word or phrase, then press Add',
  },
  spoilerAccounts: {
    name: 'Hide known spoiler accounts',
    help: 'Some channels and accounts post endings and big moments the moment they can. Everything they post is hidden on every site, whatever it says, and so is any post that links to them or names them. The built-in list starts with Shirrako (YouTube and X).',
  },
  blockedAccounts: {
    name: 'My own accounts to hide',
    help: 'Paste a link to the account\'s page, such as youtube.com/@name, x.com/name, reddit.com/user/name, tiktok.com/@name, instagram.com/name, twitch.tv/name or kick.com/name. A bare @name is read as a YouTube handle. Everything that account posts is hidden on every site.',
    placeholder: 'Paste a link to an account, then press Add',
  },
  allowWords: {
    name: 'Words never to hide',
    help: 'If the list hides something you actually want to see, add the word here and it will be left alone.',
    placeholder: 'Type a word or phrase, then press Add',
  },
  hintWords: {
    name: 'My hint words',
    help: 'On Medium, a character or place name is hidden in a post when one of these words is close to it, such as "the mission with X" or "i hate X". Add new slang here, or remove a word that makes it hide too much. Only used on social and search sites.',
    placeholder: 'Type a word, phrase or emoji, then press Add',
  },
  allowSites: {
    name: 'Safe places (nothing is ever hidden)',
    help: 'Spoiler blocking is switched off in these places. A place can be a whole website, part of a website, or one page.',
    placeholder: 'Paste a web address or type a site',
    examples: [
      ['Whole site', 'rockstargames.com', 'the site and every page on it'],
      ['Part of a site', 'reddit.com/r/reddeadredemption', 'that part and everything under it'],
      ['One page', 'youtube.com/watch?v=abc123', 'only that exact page'],
    ],
  },
  blockSites: {
    name: 'Places that always use Strict',
    help: 'In these places the strictest filtering is used, whatever you chose above. Good for places where spoilers show up a lot. A place can be a whole website, part of a website, or one page. A Safe place wins if an address is in both lists.',
    placeholder: 'Paste a web address or type a site',
    examples: [
      ['Whole site', 'reddit.com', 'the site and every page on it'],
      ['Part of a site', 'reddit.com/r/gaming', 'that part and everything under it'],
      ['One page', 'youtube.com/watch?v=abc123', 'only that exact page'],
    ],
  },
  siteKind: { site: 'Whole site', prefix: 'Part of site', page: 'One page' },
  siteChoice: { site: 'Whole site', prefix: 'Everything under', page: 'Just this page' },
  siteChoiceIntro: 'How much should this cover? Pick one to add it.',
  siteBadAddress: 'That does not look like a web address. Try something like rockstargames.com.',
  siteAlreadyThere: 'That one is already in the list.',
  siteCoveredBy: (label: string) => `Already covered by ${label}.`,
  siteEmpty: 'Nothing here yet.',
  categories: {
    name: 'Whole groups of spoilers',
    help: 'A switch for a whole group at once, on top of "What to protect" above. Leaks and trailers are only here. Example: choose "Never hide this kind" for "Trailers and reveals" if you are happy to see trailer news.',
  },
  protect: {
    name: 'What to protect',
    help: 'Pick how much to hide. Each name on the list says how much it gives away, and this decides which ones are hidden. The choices below show what each pick does, and you can change any of them.',
  },
  protectNow: (protect: keyof typeof PROTECT_TEXT) => `Protecting: ${PROTECT_TEXT[protect].name}`,
  donate: {
    name: 'Support GTA Wiki',
    help: 'The spoiler list is built from the work of GTA Wiki\'s editors. Tips go to GTA Wiki on Ko-fi, not to this extension, which never takes payment itself.',
    link: 'Tip GTA Wiki',
  },
  updates: {
    name: 'Keeping the spoiler list up to date',
    help: 'The list of spoilers grows as new details come out. The extension downloads the newest list on this schedule. It only ever downloads the list; nothing about your browsing is sent anywhere.',
    button: 'Update spoiler list now',
    privacyNote: 'The list itself is stored scrambled and is never shown, so updating can not spoil you.',
  },
  hidden: (n: number) => (n === 0 ? 'Nothing hidden on this page yet.' : `${n} ${n === 1 ? 'item' : 'items'} hidden on this page.`),
  revealAll: 'Show everything hidden on this page',
  safeWhy: (kind: 'site' | 'prefix' | 'page', label: string) =>
    kind === 'site' ? `Safe: all of ${label}` : kind === 'prefix' ? `Safe: everything under ${label}` : 'Safe: this page only',
  safeResume: 'Resume',
  safeResumeHelp: 'Nothing is hidden here until you resume.',
  markSafe: 'Mark as safe',
  markSafeHelp: 'Stop hiding here. Pick how much.',
  strictHere: (label: string) => `Always Strict: ${label}`,
  strictInOptions: 'To always use Strict somewhere, open all settings.',
} as const;
