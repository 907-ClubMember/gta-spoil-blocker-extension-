/**
 * Words that suggest a post is talking about a game's story or reacting to it. Ordinary language,
 * not spoilers. A weak list term near one of these is treated as being about the game.
 * The user can edit this list in the options page.
 */
// Not default hints any more, since they say nothing about a game; a person can still add one in the settings.
export const REACTION_EMOJI: Record<string, string> = {
  '💀': 'emojiskull',
  '😭': 'emojisob',
  '🔥': 'emojifire',
  '🐐': 'emojigoat',
  '😱': 'emojiscream',
  '🤯': 'emojimindblown',
  '💔': 'emojibrokenheart',
};

// "boss" and "dead" are left out: on real fan posts they fired mostly on ordinary game talk and unrelated text.
export const DEFAULT_HINTS: string[] = [
  // the game and its story
  'mission', 'final mission', 'last mission', 'heist', 'cutscene', 'story mode', 'playthrough', 'walkthrough', 'final boss', 'boss fight',
  'chapter', 'side quest', 'protagonist', 'villain', 'antagonist', 'spoiler', 'spoilers', 'leak', 'leaked', 'trailer', 'gameplay', 'Rockstar',
  // how it ends
  'ending', 'endings', 'true ending', 'good ending', 'bad ending', 'secret ending', 'post credits', 'credits scene', 'epilogue', 'finale', 'twist', 'plot twist',
  // who lives and who dies
  'dies', 'died', 'death', 'dying', 'killed', 'kills', 'murdered', 'survives', 'survived', 'sacrifice', 'funeral', 'rip',
  // who turns on whom, and what comes out
  'betrayed', 'betrays', 'betrayal', 'traitor', 'snitch', 'double cross', 'backstab', 'turns out', 'all along', 'the whole time', 'behind it all', 'mastermind',
  'real identity', 'revealed',
];

/** A weak term counts as hinted when a hint word is within this many words of it. */
export const HINT_REACH = 15;

/**
 * Hint words that say nothing about the story. A real person's name (Term.p) needs a story word beside it, so these do not count for
 * it: an announcement or news about the game ("will appear in the trailer") is not a plot detail.
 */
export const NOT_STORY_HINTS: readonly string[] = ['trailer', 'leak', 'leaked', 'gameplay', 'Rockstar', 'spoiler', 'spoilers'];

/**
 * More story words, for a real person's name (Term.p) only: common in plot talk about a character and rare in ordinary news (a count of
 * the practice games' character pages against news and social text, 2026-11-06). Exact forms only, no other endings.
 * Not "shot" or "arrested": both are everyday news words. They never count for other names, and the user's own hint list does not
 * change them.
 */
export const PERSON_STORY_WORDS: readonly string[] = [
  'ambush', 'ambushed', 'shootout', 'hostage', 'kidnapped', 'rescued', 'betrayed', 'betrays', 'betraying', 'betrayal', 'traitor',
  'informant', 'accomplice', 'murdered', 'revenge', 'confronts', 'spared',
];

/**
 * Words that make a post a spoiler when it also names the game, with no listed name needed:
 * "GAME all endings explained". Kept narrow on purpose. Praise, slang and swearing are not here,
 * so hype ("GAME is going to be peak") is left alone. Grouped by the category switch that controls them.
 */
// "playthrough" is a hint word only: as a spoiler word it hid stream and video titles.
export const SPOILER_WORDS = {
  story: [
    'ending', 'endings', 'final mission', 'finale', 'dies', 'died', 'death', 'deaths', 'killed', 'kills', 'betrayal', 'betrays', 'betrayed',
    'twist', 'spoiler', 'spoilers', 'cutscene', 'cutscenes', 'secret ending', 'all missions', 'full story', 'walkthrough',
    'boss fight', 'explained',
    // Seen on a shared list of words to mute on X. A leak of the story, unlike a plain "leak" (news), is a spoiler with the game.
    'last mission', 'story leak', 'story leaks', 'story leaked', 'plot leak', 'plot leaks', 'plot leaked',
  ],
  trailers: ['trailer', 'trailers', 'teaser'],
  leaks: ['leak', 'leaks', 'leaked'],
} as const;

/**
 * What happens at a place, in plain words. They only count next to the name of a place that matters to the story, so they can be
 * wider than SPOILER_WORDS: "great shot" alone means nothing. "get" and "finally" are left out: "how do I get to" is a normal question.
 */
export const PLACE_EVENT_WORDS = [
  'shot', 'shoots', 'shootout', 'gunned', 'falls apart', 'fall apart', 'is where', 'was where', 'happens', 'happened', 'showdown', 'ambush', 'ambushed',
  'massacre', 'body', 'bodies', 'blows up', 'blown up', 'explodes', 'arrested', 'captured', 'kidnapped', 'rescued', 'goes wrong', 'went wrong', 'last stand', 'confrontation',
] as const;

/**
 * Very common given names. Two of these in one post ("Michael and Jordan") say nothing about a game,
 * so the two-names rule needs at least one name that is not on this list.
 */
export const COMMON_FIRST_NAMES = new Set(`
james john robert michael william david richard joseph thomas charles christopher daniel matthew anthony mark donald steven paul andrew joshua
kenneth kevin brian george timothy ronald edward jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott brandon benjamin
samuel gregory alexander frank patrick raymond jack dennis jerry tyler aaron jose adam nathan henry douglas zachary peter kyle ethan walter noah
jeremy christian keith roger terry austin sean gerald carl harold dylan arthur lawrence jordan jesse bryan billy bruce gabriel joe logan alan juan
albert willie elijah wayne randy vincent mason roy ralph bobby russell bradley philip eugene louis harry howard fred carlos martin eddie pete phil
ron dave mike jim jimmy tom tommy bill bob rob ben dan sam alex max luke liam owen ian neil clark blake graham lloyd jerome wade barry trevor
jackson danny isaac pablo franklin lamar lester floyd devin norman nigel percy otis melvin derrick rodney forrest dale leon nolan
mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret sandra ashley kimberly emily donna michelle
carol amanda dorothy melissa deborah stephanie rebecca sharon laura cynthia kathleen amy angela shirley anna brenda pamela emma nicole helen
samantha katherine christine debra rachel carolyn janet catherine maria heather diane ruth julie olivia joyce virginia victoria kelly lauren
christina joan evelyn judith megan andrea cheryl hannah jacqueline martha gloria teresa ann sara madison frances kathryn janice jean abigail alice
judy sophia grace denise amber doris marilyn danielle beverly isabella theresa diana natalie brittany charlotte marie kayla alexis lori jane tina
tracey tracy juliet rosalind miranda casey nikki chastity debra tanisha molly paige ursula
`.trim().split(/\s+/));
