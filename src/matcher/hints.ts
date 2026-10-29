/**
 * Words that suggest a post is talking about a game's story or reacting to it. Ordinary language,
 * not spoilers. A weak list term near one of these is treated as being about the game.
 * The user can edit this list in the options page.
 */
export const REACTION_EMOJI: Record<string, string> = {
  '💀': 'emojiskull',
  '😭': 'emojisob',
  '🔥': 'emojifire',
  '🐐': 'emojigoat',
  '😱': 'emojiscream',
  '🤯': 'emojimindblown',
  '💔': 'emojibrokenheart',
};

export const DEFAULT_HINTS: string[] = [
  // gaming
  'mission', 'heist', 'cutscene', 'ending', 'story mode', 'playthrough', 'walkthrough', 'boss', 'spoiler', 'chapter',
  'protagonist', 'Rockstar', 'trailer', 'leak', 'gameplay', 'side quest', 'final mission',
  // feelings and fates
  'hate', 'love', 'died', 'dies', 'dead', 'death', 'killed', 'kills', 'murdered', 'betrayed', 'betrays', 'shot', 'cried',
  'crying', 'saddest', 'favorite', 'worst', 'best character', 'deserved',
  // swearing and strong reactions
  'fuck', 'fucking', 'wtf', 'shit', 'holy shit', 'damn', 'bitch', 'bastard', 'asshole', 'hell', 'omg', 'bruh', 'no way',
  'cannot believe', "can't believe", 'insane', 'crazy', 'wild',
  // praise and put-downs
  'awesome', 'amazing', 'incredible', 'goated', 'goat', 'peak', 'fire', 'banger', 'masterpiece', 'legend', 'iconic',
  'carried', 'clutch', 'W', 'L', 'mid', 'trash', 'overrated', 'underrated',
  // current slang
  'rizz', 'aura', 'unc', '6-7', 'skibidi', 'cracked', 'clapped', 'choke', 'cooked', 'cooking', 'glazing', 'glaze', 'based',
  'cringe', 'no cap', 'cap', 'slaps', 'bussin', 'ate', 'slay', 'goes hard', 'hits different', 'sus', 'lowkey', 'highkey',
  'fr', 'ong', 'ngl', 'istg', 'bro',
  // reaction emoji
  ...Object.keys(REACTION_EMOJI),
];

/** A weak term counts as hinted when a hint word is within this many words of it. */
export const HINT_REACH = 15;

/**
 * Words that make a post a spoiler when it also names the game, with no listed name needed:
 * "GAME all endings explained". Kept narrow on purpose. Praise, slang and swearing are not here,
 * so hype ("GAME is going to be peak") is left alone. Grouped by the category switch that controls them.
 */
export const SPOILER_WORDS = {
  story: [
    'ending', 'endings', 'final mission', 'finale', 'dies', 'died', 'death', 'deaths', 'killed', 'kills', 'betrayal', 'betrays', 'betrayed',
    'twist', 'spoiler', 'spoilers', 'cutscene', 'cutscenes', 'secret ending', 'all missions', 'full story', 'walkthrough', 'playthrough',
    'boss fight', 'explained',
  ],
  trailers: ['trailer', 'trailers', 'teaser'],
  leaks: ['leak', 'leaks', 'leaked'],
} as const;

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
