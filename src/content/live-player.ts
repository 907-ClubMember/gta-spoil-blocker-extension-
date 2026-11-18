// A site's player that is kept clear while it shows a live stream (the adapter's keepClear, owner rule f06 A), and covered like any video near the
// game when it plays something recorded (an offline channel's past broadcast). Two states, read from two signals: the site's own live signal
// (the adapter's liveMarks: Twitch's LIVE pill, viewer count, stream timer) and the media's duration (a live stream has no end).

/** What a kept-clear player shows. */
export type PlayerState = 'live' | 'recorded';

/**
 * The player's state. The site saying live wins: a live channel's player can hold a finite duration for a while (it loads late for a logged-out
 * viewer). Without that signal a finite duration is a recording, and no duration yet (nothing loaded) or one with no end is live, as before.
 */
export function playerState(recorded: boolean, liveMark: boolean): PlayerState {
  return liveMark || !recorded ? 'live' : 'recorded';
}

/** What a change of state does to the player's picture cover: 'judge' it again (it may be covered near the game), 'release' it, or nothing. */
export type PlayerStep = 'none' | 'judge' | 'release';

/** Every transition. live -> recorded: judged again (scanner watchDuration). recorded -> live: its cover comes off (scanner releaseLive). */
export const PLAYER_STEPS: Readonly<Record<PlayerState, Readonly<Record<PlayerState, PlayerStep>>>> = {
  live: { live: 'none', recorded: 'judge' },
  recorded: { live: 'release', recorded: 'none' },
};

export function playerStep(from: PlayerState, to: PlayerState): PlayerStep {
  return PLAYER_STEPS[from][to];
}

/** First path parts that are the site's own pages, not a channel (twitch.tv/directory, /search, /videos/...). */
const NOT_CHANNELS = new Set(['directory', 'search', 'videos', 'settings', 'downloads', 'jobs', 'turbo', 'prime', 'p', 'subscriptions', 'inventory', 'wallet', 'drops', 'friends', 'messages', 'login', 'signup', 'team', 'moderator', 'popout', 'u', 'store', 'following', 'bits', 'clip', 'clips']);

/** The channel a path names (/name, /name/...), lower case; '' when it names none. */
export function channelOf(path: string): string {
  const n = /^\/([A-Za-z0-9_]{2,25})(?:\/|$)/.exec(path)?.[1]?.toLowerCase() ?? '';
  return NOT_CHANNELS.has(n) ? '' : n;
}
