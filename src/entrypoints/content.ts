import { accountKeys, accountWords } from '../accounts';
import { Matcher, labelFor } from '../matcher';
import { Scanner, giveBackFilter, giveBackMedia, guardBars, shadowRoots, syncReaders } from '../content/scanner';
import { activeList, builtinList } from '../list/store';
import { CATEGORIES, type SpoilerList } from '../types';
import { shapeTerms } from '../levels';
import { adapterFor } from '../adapters';
import { staleRule } from '../adapters/stale';
import { BLACKOUT_WORDS, timerNextChange, addressChange, blackoutNextChange, blackoutOn, isSuspended, listVerdict, loadSettings, picturesFor, settingsChangedSince, settingsForUrl, siteDecisionKey, strictnessSource, type ListVerdict, type Settings } from '../settings';
import { isSearchPage, offSelector } from '../adapters/parts';
import { extensionAlive, keepLast } from '../keep-last';
import { DEBUG_WHY } from '../debug-flag';
import { BETA } from '../beta-flag';
import { createCountPort } from '../count-port';
import { readLastError } from '../last-error';
import { watchContextMenu } from '../beta/content';
import { BIG_READ, CLAIM_MAX, CLAIM_MAX_END, claimFor, EndFirst } from '../content/end-first';
import { ChangedPacer, JudgeCache, lineOf, MIGHT_MAX, oneSpace, pacingKey } from '../content/changed-pacer';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  // Frames with no address of their own (srcdoc, about:blank filled by the page's script) were never read.
  // Not a new permission: they run only inside pages the script already runs on.
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  runAt: 'document_start',
  async main() {
    const isTop = window === window.top;
    // Beta only, and first: a picking click (src/beta/pick.ts) is taken before guardBars, so picking a bar does not reveal it.
    if (BETA) watchContextMenu(isTop);
    // Before any page script adds its own: a click on one of our bars never reaches the page (see guardBars).
    guardBars(document);
    // Ad and tracker frames are tiny: not worth any work.
    const bigEnough = () => window.innerWidth >= 200 && window.innerHeight >= 100;
    /** Whether the top page is about the game, as told to this frame (sub-frames only). */
    let outer = false;
    /** What this top frame last told the background. */
    let reported: boolean | undefined;
    const send = (msg: object, onReply?: (r: unknown) => void) => {
      try {
        const p = chrome.runtime.sendMessage(msg) as Promise<unknown> | undefined;
        p?.then(onReply, () => {});
      } catch {
        /* extension reloaded: nothing to tell */
      }
    };
    const report = (about: boolean) => {
      if (!isTop || reported === about) return;
      reported = about;
      send({ type: 'pageAbout', about });
    };
    /**
     * The address the Safe and Strict lists are checked against: this page's own in the top frame, the tab's
     * page in a frame inside it (told by the background; `tabUrl` is the last answer).
     */
    let tabUrl: string | undefined;
    /** This address is read with the general rules: the site's own rule looked stale here (src/adapters/stale.ts). */
    let genericAt: string | null = null;
    let staleTimers: number[] = [];
    /** The Safe/Strict answer the running scan was started with, and the settings it was started from. */
    let verdict: ListVerdict = 'normal';
    let lastSaved: Settings | undefined;
    /** This page was left unread as a search page with that part switched off: moving to or from one starts again. */
    let searchSkipped = false;
    /** What the site entries and groups decided for the running scan (siteDecisionKey): a live page, say, can differ from the rest. */
    let decided = '';
    const skipsSearch = (saved: Settings, url: string) => !settingsForUrl(saved, url, location.hostname).parts.search && isSearchPage(location.pathname, location.search);
    /** Top frame: the last address seen, so an unchanged address costs one string compare. */
    let seenHref = '';
    const fallbackUrl = () => {
      // A blank or inline frame has no web address of its own: its parent's site is the best that is left.
      if (/^https?:$/.test(location.protocol)) return location.href;
      const top = location.ancestorOrigins?.[location.ancestorOrigins.length - 1];
      return top && top !== 'null' ? top : location.href;
    };
    const askTabUrl = () =>
      new Promise<string | undefined>((resolve) => {
        const timeout = setTimeout(() => resolve(undefined), 1500);
        const done = (u: unknown) => {
          clearTimeout(timeout);
          resolve(typeof u === 'string' && u ? u : undefined);
        };
        try {
          (chrome.runtime.sendMessage({ type: 'tabUrl' }) as Promise<{ url?: unknown } | undefined>).then((r) => done(r?.url), () => done(undefined));
        } catch {
          done(undefined); // extension reloaded: use the fallback
        }
      });
    /** The address to decide by right now (frames: the last known one). */
    const decisionUrl = () => (isTop ? location.href : tabUrl ?? fallbackUrl());
    /** The address changed without a reload: start again only if that changes the Safe/Strict answer, the search-page skip or a site's own choices. */
    const checkAddress = () => {
      if (isTop) {
        if (location.href === seenHref) return;
        seenHref = location.href;
        send({ type: 'pageUrl', url: location.href });
        // The next video on the same page: its reused parts are judged afresh (spoiler accounts).
        scanner?.addressChanged();
      }
      if (!lastSaved) return;
      const r = addressChange(lastSaved, verdict, decisionUrl());
      if (r.restart || skipsSearch(lastSaved, decisionUrl()) !== searchSkipped || siteDecisionKey(lastSaved, decisionUrl(), location.hostname) !== decided) void start();
    };
    let scanner: Scanner | null = null;
    /**
     * Items the user showed: kept across a list update on this page (only what the new list adds is covered), and
     * across every restart for the people who switched "remember reveals" on, as the running scan was started.
     */
    let keptReveals = new WeakSet<Element>();
    /**
     * The posts the user showed, by id: a post shown on a feed opens shown on its own page. Memory of this page only (a new page load starts
     * with none); kept through address changes inside the page, timers and list updates; dropped on a settings save unless "remember reveals" is on.
     */
    let shownThreads = new Set<string>();
    let remembering = false;
    // The port to the background that carries the count. A worker restart or the back/forward cache cuts it: lastError is read, the page closes
    // the port itself when it goes into the cache, and connects again with the count when it comes back (count-port.ts).
    const countPort = createCountPort({
      connect: () => chrome.runtime.connect({ name: 'gsb-count' }),
      payload: () => ({ count: scanner?.count ?? 0, groups: scanner?.groups ?? {} }),
      readLastError,
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id as number),
      addPageListener: (type, fn) => window.addEventListener(type, (e) => fn({ persisted: (e as PageTransitionEvent).persisted })),
    });
    const tellCount = countPort.tell;
    countPort.connect();
    let observer: MutationObserver | null = null;
    let queue = new Set<Node>();
    /**
     * Nodes the page added while earlier ones still waited in `queue` (0.1.11), in the order they came. The page watcher reads them in its own
     * callback, oldest first, for up to FRESH_BUDGET_MS; a pass (drain) reads `queue` first and then what is left of these.
     */
    let fresh = new Set<Node>();
    /**
     * Nodes the page added after load while a backlog still waits, in the order they came (leak hunt part 2, builder 3): read before the old
     * backlog, in the callbacks and in each pass (for at most NEWER_SHARE of the pass, so the old backlog keeps the rest: at 3/4 a feed of
     * 6000 waiting posts with 20-30 more a frame ended 40-77% later). Parts with elements in them only (see into). In `fresh` they
     * waited behind it, first in, first out: a unit appended 12 s after the saved Reddit thread was opened was covered 9.8 s later.
     */
    let newer = new Set<Node>();
    const NEWER_SHARE = 1 / 2;
    /**
     * The time spent reading `newer` and the old backlog (`queue`, `fresh`) while both wait: the share is by time (review rv12 of 40224450:
     * by the pass's clock alone, a heavy new unit (a Reddit comment: 5-30 ms) over the pass's budget ended the pass and the old backlog got
     * nothing; with 3 such units a frame it got 1% of the read time). Whichever has had less goes first in the next pass, as aheadRest's
     * turns (restMs, queueMs). Both start again when the old backlog is empty (not when `newer` is: a stream of single units empties it
     * every frame, and starting again each time gave `newer` the first read of every pass).
     */
    let newMs = 0;
    let oldMs = 0;
    /** `newer` goes first while its time is at most this share of the old backlog's (a heavy read overruns by up to its own length). */
    const NEW_RATIO = 0.6;
    /**
     * Nodes that are, hold or land inside a dialog ([role=dialog], dialog, [aria-modal=true]) while a backlog waits (0.1.13), in the order they
     * came: read first in the callbacks (the shared slice) and in each pass (for at most a quarter of its budget, so the backlog keeps the rest).
     */
    let urgent = new Set<Node>();
    /**
     * Text the page changed in an element it already had (0.1.15 changed text: a characterData change, or an element's text replaced) while a
     * backlog waits, in the order it came: looked at first in the callbacks (the shared slice) and in each pass (with `urgent`'s quarter of
     * the budget). What is on screen is read there; the rest goes to the front of `queue` (the backlog's own first: at the front of `fresh`,
     * read only once `queue` was, the last flair of the saved Reddit thread was covered 0.9-1.6 s after the change). At the end of `fresh` it
     * waited behind the whole backlog: on the saved Reddit thread a name written into the community widget was covered after 10 s.
     */
    let changed = new Set<Node>();
    /** At most this many changes of one callback are taken as `changed` (a ticker rewriting 500 texts at once: the rest as before). */
    const CHANGED_MAX = 16;
    /** ...and an element put in where others were taken out only with fewer elements than this inside (text with a link or two, not a post). */
    const CHANGED_ELEMENTS = 8;
    /** ...and none with a picture, a video or a frame in it (see the page watcher). */
    const MEDIA = 'img, picture, video, audio, svg, canvas, iframe, embed, object';
    /**
     * Changed text off screen goes to the front of `queue` at most once per this many ms (`frontAt`): a ticker after a feed that rewrote its
     * 500 lines every frame put the same 16 at the front each frame and held the feed's last named post up to 0.8 s later than base.
     */
    const CHANGED_AGAIN_MS = 1000;
    let frontAt = new WeakMap<Node, number>();
    /** Changed text that cannot match is read first at most CHANGED_RATE times a second (CHANGED_BURST at once): see readChanged. */
    const CHANGED_RATE = 120;
    const CHANGED_BURST = 30;
    /** Changed text this short with at most this many letters is ticker-like (a clock, a count, a score: '12:04', '3-1', '1.2K'): see readChanged. */
    const TICKER_CHARS = 32;
    const TICKER_LETTERS = 3;
    let changedTokens = CHANGED_BURST;
    let changedAt = 0;
    /** Changed text whose read threw once (see readChanged). */
    const rethrown = new WeakSet<Node>();
    /** Changed text read again at most once per CHANGED_READ_MS, the last change in the window read at its end (src/content/changed-pacer.ts). */
    const pacer = new ChangedPacer();
    let pacerTimer: number | undefined;
    /** The last verdict per changed text's key (see changeCould): bounded, emptied on stop. */
    const judged = new JudgeCache();
    /** The last 3 callbacks in which each element's text changed (see tickerLike): new on stop. */
    let changedTimes = new WeakMap<Node, number[]>();
    /** At most this many changed texts on screen read in one callback (the rest in a pass). */
    const CHANGED_SCREEN_CAP = 8;
    /** A changed element with elements inside is judged by at most this many units inside it (see readChanged), else read at once. */
    const NESTED_UNITS = 8;
    /**
     * Nodes moved ahead of the backlog once the parse is done (0.1.15, src/content/end-first.ts): waiting nodes on screen, in the footer and
     * at the end of the body. Each is taken out of `queue`/`fresh` and read here instead: the same reads, in another order.
     */
    let ahead = new Set<Node>();
    /**
     * The rest moved ahead (the parts from the end after the first look's): read in turns with the backlog, by time spent (each gets the first
     * place in a pass while it has used no more time than the other), so what the backlog reads first is not held up behind them all (0.1.15
     * review: a Fandom nav label, early in the backlog, 0.8 s later than base behind moved nodes).
     */
    let aheadRest = new Set<Node>();
    let restMs = 0;
    /**
     * The backlog's next HEAD_N nodes, refreshed before each end-first step: a text inside one of them is left to the backlog (moved in parts,
     * a Bing result list the backlog reads in one go about 0.1 s after DOMContentLoaded was read card by card, each read laying the page out
     * again: 0.45 s later than base).
     */
    const nearHead = new Set<Node>();
    const HEAD_N = 1000;
    let queueMs = 0;
    /** Moved nodes over BIG_READ elements: each is read at the start of a pass, alone (a long read is not made longer by others). */
    let bigAhead = new WeakSet<Node>();
    let endFirst: EndFirst | null = null;
    let timer: number | undefined;
    let confirmTimer: number | undefined;
    const CONFIRM_MS = 300;
    /** The whole pass (drain) of the running scan, for a look made without a change of the page; null when no scan runs. */
    let lookNow: (() => void) | null = null;
    /** A turn to "not about the game" waits for a second look: made here after a moment (a quiet page, or a frame told by the top page, brings no change to drive one). */
    const confirmSoon = (sc: { contextPending: boolean }) => {
      if (!sc.contextPending || confirmTimer !== undefined) return;
      confirmTimer = window.setTimeout(() => { confirmTimer = undefined; if (scanner && timer === undefined) lookNow?.(); }, CONFIRM_MS);
    };
    let pruneTimer: number | undefined;
    /** The next look for shadow roots that appeared unseen (custom elements defined late). */
    let lateFrame: number | undefined;
    /** Wakes the scanner when a pause or the end date passes. */
    let wake: number | undefined;
    /** Counts restarts, so a start overtaken by a newer one (two quick setting changes) gives up. */
    let generation = 0;
    /** Longest one pass may hold up the page, in milliseconds. */
    const BUDGET_MS = 8;
    const LOADING_BUDGET_MS = 40;
    /**
     * Shares while a backlog waits (0.1.11). A page watcher callback that brings at most FRESH_MAX_NODES nodes of the page's own (a few
     * nodes; our labels do not count) reads `fresh`, oldest first; any callback first reads `urgent` (what is, holds or lands inside a
     * dialog, 0.1.13), whatever came with it.
     * All callbacks of one task share one slice of FRESH_BUDGET_MS for these reads (given back when the task ends), the page judge not run
     * there. A bigger burst is not read in the callback (reading it there forced its layout inside the page's own frame: long tasks with
     * heavy posts); it waits in `fresh`. Each pass (drain) reads `urgent` for at most a quarter of its budget, then the older `queue`, then `fresh`,
     * oldest first in each, so none starves and no node waits behind one that came later on its side.
     */
    const FRESH_BUDGET_MS = 4;
    const FRESH_MAX_NODES = 8;
    /** Our own nodes in the page (a cover's bar, its tip and screen-reader text). */
    const OWN_NODES = '.gsb-bar, .gsb-tip, .gsb-sr';
    const DIALOGS = '[role="dialog"], dialog, [aria-modal="true"]';
    /** Only the first nodes of a callback are looked through for a dialog: 400 heavy posts cost 1.9 ms, these at most about 0.15 ms. */
    const DIALOG_CHECKS = 32;
    /** ...and the last nodes of each change (0.1.13: a dialog put in after 40 other nodes in the same callback). */
    const DIALOG_TAIL = 8;
    /**
     * What is left of this task's slice (see FRESH_BUDGET_MS). A message posted when the slice is opened gives it back after the task; so does
     * SLICE_TASK_MS since it opened (a frame can come before that message: a dialog read in one task, its tiles put in at the next frame).
     */
    let sliceLeft = FRESH_BUDGET_MS;
    let sliceOpen = false;
    let sliceAt = 0;
    const SLICE_TASK_MS = 50;
    /** Quiet time after the last scroll before what is on screen is looked for again (0.1.15). */
    const SCROLL_IDLE_MS = 150;
    const sliceEnd = new MessageChannel();
    sliceEnd.port1.onmessage = () => {
      sliceLeft = FRESH_BUDGET_MS;
      sliceOpen = false;
    };

    // A restart (new list or settings) clears every cover and then waits for storage before scanning again; the browser can draw
    // in between, so hidden posts flashed into view (1-4 frames each hourly list update). Old covers are kept
    // as a hold until the new scan has run, then lifted: what the new scan hides is covered again by then.
    const holdCovers = () => {
      for (const r of [document, ...shadowRoots()]) {
        r.querySelectorAll('[data-gsb]:not([data-gsb-peek])').forEach((e) => e.setAttribute('data-gsb-hold', e.getAttribute('data-gsb')!));
        r.querySelectorAll('[data-gsb-under]').forEach((e) => e.setAttribute('data-gsb-hold', e.getAttribute('data-gsb-under')!));
      }
    };
    const releaseHold = () => {
      for (const r of [document, ...shadowRoots()]) r.querySelectorAll('[data-gsb-hold]').forEach((e) => {
        e.removeAttribute('data-gsb-hold');
        // Not covered again by the new scan: an inline filter taken off it while covered goes back.
        if (!e.hasAttribute('data-gsb')) giveBackFilter(e);
      });
      syncReaders(document);
    };

    // The tab title is outside the page, so no cover reaches it: a spoiler headline stayed in the tab strip and in history.
    // It is judged like the page's own text and swapped for the label; the real title comes back when
    // it no longer counts (shown, paused, a Safe page, new settings). Top frame only.
    let realTitle: string | null = null;
    let shownTitle: string | null = null;
    let titleShown = false;
    const guardTitle = () => {
      if (!isTop) return;
      const cur = document.title;
      const ours = shownTitle !== null && cur === shownTitle;
      const source = ours ? realTitle! : cur;
      const r = scanner && !titleShown ? scanner.judgeText(source) : null;
      if (r) {
        realTitle = source;
        shownTitle = labelFor(r);
        if (cur !== shownTitle) document.title = shownTitle;
      } else {
        if (ours) document.title = realTitle!;
        realTitle = shownTitle = null;
      }
      // The page judge keeps reading the page's own title, not our label.
      scanner?.setRealTitle(realTitle, shownTitle);
    };

    const stop = (keepReveals = false, settingsSaved = false) => {
      observer?.disconnect();
      observer = null;
      clearTimeout(timer);
      timer = undefined;
      clearTimeout(pruneTimer);
      pruneTimer = undefined;
      clearTimeout(wake);
      if (lateFrame !== undefined) cancelAnimationFrame(lateFrame);
      lateFrame = undefined;
      for (const t of staleTimers) clearTimeout(t);
      staleTimers = [];
      if (confirmTimer !== undefined) clearTimeout(confirmTimer);
      confirmTimer = undefined;
      lookNow = null;
      queue = new Set();
      fresh = new Set();
      newer = new Set();
      newMs = oldMs = 0;
      urgent = new Set();
      changed = new Set();
      frontAt = new WeakMap();
      pacer.clear();
      judged.clear();
      changedTimes = new WeakMap();
      if (pacerTimer !== undefined) clearTimeout(pacerTimer);
      pacerTimer = undefined;
      ahead = new Set();
      aheadRest = new Set();
      restMs = queueMs = 0;
      bigAhead = new WeakSet();
      endFirst?.stop();
      endFirst = null;
      nearHead.clear();
      scanner?.clear();
      scanner = null;
      if (!keepReveals && !remembering) {
        // Forgotten here, not by the scanner: a start overtaken by this one may have kept them with no scanner left to clear.
        keptReveals = new WeakSet();
        for (const r of [document, ...shadowRoots()]) r.querySelectorAll('[data-gsb-revealed]').forEach((e) => e.removeAttribute('data-gsb-revealed'));
      }
      // The posts shown by id go only with a settings save: a restart for a new address inside the page (a feed to its post), a timer or a
      // list update keeps them, since moving to the post is what they are kept for. A new page load starts with none.
      if (settingsSaved && !remembering) shownThreads = new Set();
      tellCount();
    };

    // Read both every start, so a tab cut off by an update (even while paused) keeps what it last had.
    const keptSettings = keepLast<Settings>(loadSettings);
    const keptList = keepLast(activeList);
    // The last list that was read without error on this page (see start).
    let goodList: SpoilerList | undefined;
    const start = async (listUpdate = false, settingsSaved = false) => {
      if (!listUpdate) titleShown = false;
      holdCovers();
      stop(listUpdate, settingsSaved);
      reported = undefined; // a restart tells the background again, so no stale answer survives
      const mine = ++generation;
      try {
        await restart(mine);
      } catch (e) {
        // A start that fails half way (a damaged saved list) must not leave the page unread: start again on the last list that
        // worked here, or the built-in one.
        if (mine === generation) {
          console.warn('Spoiler Blocker: starting again with the last good list', (e as Error)?.name);
          stop(listUpdate);
          await restart(mine, goodList ?? builtinList()).catch((again) => console.warn('Spoiler Blocker: the fallback start failed too', (again as Error)?.name));
        }
      } finally {
        // A start overtaken by a newer one leaves the hold to it; otherwise every way out (paused, Safe page, scanned) lifts it.
        if (mine === generation) {
          releaseHold();
          guardTitle();
        }
      }
    };
    const restart = async (mine: number, fallback?: SpoilerList) => {
      const [saved, list] = await Promise.all([keptSettings(), fallback ?? keptList()]);
      const host = location.hostname;
      if (!isTop) {
        tabUrl = (await askTabUrl()) ?? tabUrl;
        // The top page may not have told the background its address yet: until it does, use the safe fallback
        // and ask again a few times, so a Safe page is still noticed.
        for (let i = 1; !tabUrl && i <= 4; i++) {
          const tries = i;
          window.setTimeout(async () => {
            if (mine !== generation || tabUrl) return;
            const u = await askTabUrl();
            if (u && !tabUrl && mine === generation) { tabUrl = u; checkAddress(); }
          }, tries * 700);
        }
      }
      if (mine !== generation) return;
      const url = decisionUrl();
      if (isTop) seenHref = url;
      lastSaved = saved;
      verdict = listVerdict(saved, url);
      decided = siteDecisionKey(saved, url, host);
      const s = settingsForUrl(saved, url, host);
      // Pictures follow the tab's site; during the launch-week blackout only a site's stricter picture choices count (picturesFor).
      const pics = picturesFor(saved, url, host, { blackout: blackoutOn(saved, list.release, Date.now()) });
      remembering = s.rememberReveals;
      searchSkipped = skipsSearch(saved, url);
      // Not hiding here (off for this site or page, paused, a skipped search page): the sound and play we took come back.
      const off = () => { giveBackMedia([document, ...shadowRoots()]); report(false); };
      if (!s.enabled) return void off();
      const now = Date.now();
      if (isSuspended(s, now)) {
        // Paused, past the end date, or the story is finished: look again when the pause ends.
        const ends = [s.pausedUntil, timerNextChange(s, now) ?? 0].filter((t) => t > now);
        if (ends.length) wake = window.setTimeout(() => void start(), Math.min(Math.min(...ends) - now + 1000, 2 ** 31 - 1));
        return void off();
      }
      // A search page counts as one part; when it is switched off nothing on it is read.
      if (searchSkipped) return void off();

      const here = location.host + location.pathname;
      const rule = adapterFor(host, location.pathname);
      const site = genericAt === here ? null : rule;
      // What to protect (levels and kinds), trailers and the per-category switches shape the list before matching.
      const terms = shapeTerms(list.terms, s);
      const accounts = accountKeys(s);
      const matcher = new Matcher({
        terms,
        strictness: s.strictness,
        categories: new Set(CATEGORIES.filter((c) => s.categories[c])),
        allowWords: s.allowWords,
        // A built-in spoiler account's name in a post hides it like one of the person's own words.
        // Launch-week blackout (optional, off by default): every post naming the game is hidden.
        // Three lists, so a cover can say which one made it.
        customWords: s.customWords,
        accountWords: accountWords(s, host),
        blackoutWords: blackoutOn(s, list.release, Date.now()) ? [...BLACKOUT_WORDS] : [],
        hintWords: s.hintWords,
        allowTrailers: s.allowTrailers,
      });
      matcher.debug = DEBUG_WHY && s.debugWhy;
      // A tab left open across the blackout's first or last day picks up the change by itself.
      const turn = [blackoutNextChange(s, list.release, Date.now()), timerNextChange(s, Date.now())].filter((t) => t !== undefined).sort((a, b) => a - b)[0];
      if (turn) wake = window.setTimeout(() => void start(), Math.min(turn - Date.now() + 1000, 2 ** 31 - 1));
      const watchOpts: MutationObserverInit = {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        // Discord's GIF video gets its aria-label after it is added: there only, a late label is read too.
        attributeFilter: ['src', 'srcset', 'alt', 'poster', ...(rule?.name === 'Discord' ? ['aria-label'] : []), ...(accounts.size ? ['href'] : [])],
      };
      const sc = new Scanner(document, matcher, { onShadowRoot: (r) => observer?.observe(r, watchOpts), hideMode: s.hideMode, blur: s.blur, showReason: s.showReason, debugWhy: DEBUG_WHY && s.debugWhy, revealMode: s.revealMode, keepRevealed: keptReveals, shownThreads, offParts: offSelector(host, s.parts), pauseVideo: s.pauseVideo, muteAudio: s.muteAudio, pictures: pics.values, gifs: site?.gifs, hideReplies: s.hideReplies, containers: site?.containers, panels: site?.panels, cardCap: site?.cardCap, keepParts: site?.keepParts, subCards: site?.subCards, panelSplit: site?.panelSplit, splitCards: site?.splitCards, chat: site?.chat, chatLines: site?.chatLines, threads: site?.threads, replies: site?.replies, thumbs: site?.thumbs, postMaker: site?.postMaker, allowTrailers: s.allowTrailers, allowStores: s.allowStores, primaryPost: site?.primaryPost, picLinks: site?.picLinks, viewers: site?.viewers, mediaPostPictures: site?.mediaPostPictures, coverParts: site?.coverParts, strongOnly: site?.strongOnly, apart: rule?.apart /* kept when the site rule went stale: its parts use stable hooks, not the post cards */, replyAreas: site?.replyAreas, main: site?.main, threadKey: site?.threadKey, threadEnd: site?.threadEnd, names: site?.names, nameplates: site?.nameplates, people: site?.people, bio: site?.bio, keepClear: rule?.keepClear, keepClearNot: rule?.keepClearNot, liveMarks: rule?.liveMarks, playerLayers: rule?.playerLayers, feeds: rule?.feeds, staleTags: rule?.staleTags, embeds: site?.embeds, searchPath: rule?.searchPath, overCards: rule?.overCards, boxArt: rule?.boxArt, ownReplies: site?.ownReplies, ownRepliesOf: site?.ownRepliesOf, ownThreads: site?.ownThreads, siteChrome: site?.siteChrome, commentsInside: site?.commentsInside, slides: site?.slides, threadCards: site?.threadCards, mainBlock: site?.mainBlock, swallowClicks: site?.swallowClicks, accounts, ownPage: site?.ownPage, coverSource: { strictness: strictnessSource(saved, url, host), ownAccounts: accountKeys({ spoilerAccounts: false, blockedAccounts: s.blockedAccounts }), globalPictures: pics.global } });
      scanner = sc;
      // A title swapped before this start (the tab shows our label): the new scan reads the page's own one.
      if (isTop && shownTitle !== null && document.title === shownTitle) sc.setRealTitle(realTitle, shownTitle);
      // Our stylesheet or a cover mark removed by the page or another extension is put back, at most once a second.
      staleTimers.push(window.setInterval(() => { if (scanner === sc) sc.repair(); }, 1000));
      if (!isTop) sc.setOuterContext(outer);
      report(sc.refreshPageContext());
      if (document.body) sc.scan(document.body);
      sc.holdPlaying();
      // Read the whole page without error: a later failed start falls back to this list.
      goodList = list;
      sc.quiet();
      syncReaders(document);
      let synced = sc.changes;
      guardTitle();
      tellCount();
      // A site that changed its layout overnight: once the page has filled in, check the rule still finds its posts.
      if (site && isTop) for (const ms of [3000, 10000]) staleTimers.push(window.setTimeout(() => {
        if (scanner !== sc || genericAt === here) return;
        if (staleRule(site, document)) {
          genericAt = here;
          void start();
        }
      }, ms));

      // New content is checked inside the observer callback, which runs before the browser paints it,
      // so a spoiler is hidden before it is ever shown. Work past the budget is put off so pages stay smooth.
      /** Reads `n` if it is still in the page. */
      const read = (n: Node, body: HTMLElement) => {
        // Inside a shadow root (Reddit's chat) body.contains says no, so the node's own root decides.
        if (n.isConnected && (n === body || body.contains(n) || (n.getRootNode() as ShadowRoot).host)) sc.scan(n);
      };
      /** Held changed text whose window ended goes back into `changed`, and a pass reads it (see pacer). */
      const wakePacer = () => {
        pacerTimer = undefined;
        if (scanner !== sc) return;
        for (const n of pacer.takeDue(performance.now())) changed.add(n);
        if (changed.size && timer === undefined) timer = window.setTimeout(drain, 0);
        armPacer();
      };
      const armPacer = () => {
        const at = pacer.next();
        if (at === undefined || pacerTimer !== undefined) return;
        pacerTimer = window.setTimeout(wakePacer, Math.max(0, at - performance.now()));
      };
      /**
       * Changed text (see `changed`): what is on screen is read now (until `over`, at most `cap` reads); the rest goes to the front of `queue`, in
       * the order it came. A node read less than CHANGED_READ_MS ago is held to its window's end (no layout read for it); the others' places are
       * read all at once before any read (a read puts covers in: a place read after it lays the page out again).
       */
      /**
       * Could a changed text match anything? Held (paced, or past the bucket to the backlog) only when every way it can be read says no
       * (review B of 7ff90bb7: each single reading missed a shape the scanner covers, one at a time): it is ticker-like (tickerLike), no
       * link, label, described picture or shadow root is in or around it, and none of these texts can match (mightMatch): the changed
       * node's own, its key's (pacingKey) as one text and with a space between its pieces, the unit the scanner reads it in (its joined
       * block or a site card's unit) as the scanner reads it and with spaces, else its line (lineOf). The last texts judged per key, and
       * the answer (Scanner.couldCover: the matcher and the scanner's text rules; review B of bfe60ffc: a story phrase in a chat line).
       * Anything else is read as it comes, as before the pacing.
       */
      const spaced = (el: Element) => {
        let out = '';
        const walker = document.createTreeWalker(el, 4 /* SHOW_TEXT */);
        for (let t = walker.nextNode(); t && out.length <= MIGHT_MAX; t = walker.nextNode()) out += ` ${t.nodeValue ?? ''}`;
        return out;
      };
      const textsCould = (n: Node, key: Node) => {
        const el = key.nodeType === 1 ? (key as Element) : key.parentElement;
        // Every unit the scanner reads it in (Scanner.readUnits: its joined block or card unit, a suggestion row, a bio, a name row, a
        // nameplate, a message's embeds, the post), each as read and with spaces between pieces; with no joined block, its line.
        const reads = el ? sc.readUnits(el) : [];
        const line = reads.some((r) => r.by === 'checkJoined') ? null : lineOf(key);
        const texts = [n.textContent ?? '', key.textContent ?? '', el ? spaced(el) : '', ...reads.flatMap((r) => [r.text, spaced(r.block)]), line?.textContent ?? '', line && line.nodeType === 1 ? spaced(line as Element) : ''];
        // A changed element with elements inside: also each unit the scanner reads its texts in (see nested).
        if (nested(n)) {
          const inner = innerTexts(n as Element);
          if (!inner) return true;
          texts.push(...inner);
        }
        // Each text with its spaces as one (oneSpace: ASCII spaces only): a key's text and its text with spaces between pieces are often
        // the same text.
        const all = [...new Set(texts.map(oneSpace).filter(Boolean))];
        // Keyed on the texts as they are (review B of badee39f: with numbers folded, 'Zorb 40777', which the matcher repairs to a listed
        // 'Zorb 4077', got the verdict of 'Zorb 4080': held, 78 frames).
        const seen = all.join('\u0001');
        const last = judged.get(key, seen);
        if (last !== undefined) return last;
        const could = all.some((text) => sc.couldCover(text));
        judged.set(key, seen, could);
        return could;
      };
      /**
       * The last 3 callbacks in which each element's text changed (a text's parent, the element nodes were swapped in), noted for every
       * change, also those past CHANGED_MAX (see tickerLike).
       */
      const noteChange = (at: Node | null, now: number) => {
        if (!at) return;
        const times = changedTimes.get(at);
        if (!times) changedTimes.set(at, [now]);
        else if (times[times.length - 1] !== now) {
          times.push(now);
          if (times.length > 3) times.shift();
        }
      };
      /**
       * Ticker-like: short with few letters (a clock, a count, a score: TICKER_CHARS, TICKER_LETTERS), or its key (or parent) changed 3
       * times within CHANGED_AGAIN_MS (a ticker's line).
       */
      const tickerLike = (n: Node, key: Node, now: number) => {
        const often = (x: Node | null) => {
          const times = x && changedTimes.get(x);
          return !!times && times.length === 3 && now - times[0]! <= CHANGED_AGAIN_MS;
        };
        if (often(key) || often(n.parentNode)) return true;
        const t = (n.textContent ?? '').trim();
        return t.length <= TICKER_CHARS && (t.match(/\p{L}/gu)?.length ?? 0) <= TICKER_LETTERS;
      };
      /**
       * A link, label, described picture or shadow root in or around the change or its key: read at once, never held (review A of
       * 6ee5976d: a link to a blocked account swapped into a small parent was held, its words can match nothing; the scanner reads links
       * and labels too. Review B of 7ff90bb7: a name in a shadow root swapped in, which no text above sees).
       */
      const linked = (n: Node, key: Node) => {
        const inside = (x: Node) => x.nodeType === 1 && ((x as Element).matches('[aria-label], img[alt]') || !!(x as Element).shadowRoot || !!(x as Element).querySelector('a[href], [aria-label], img[alt]') || [...(x as Element).getElementsByTagName('*')].some((c) => !!c.shadowRoot));
        const e = n.nodeType === 1 ? (n as Element) : n.parentElement;
        return !e || !!e.closest('a[href], [aria-label]') || inside(n) || (key !== n && inside(key));
      };
      /**
       * A changed element with an element inside is also judged by each unit the scanner reads a text of it in (review C of e8468104:
       * '<div><p><em>Zorb</em>lax Quux</p><p>wins</p></div>' swapped in: its text glues the blocks, its text with spaces splits the word,
       * the scanner reads the inner block joined: held, 70-76 frames; read at once instead, a ticker swapping '<span><b>..</b></span>'
       * drew 20% fewer frames). At most NESTED_UNITS units and MIGHT_MAX characters, else it could match (null).
       */
      const nested = (n: Node) => n.nodeType === 1 && (n as Element).firstElementChild !== null;
      const innerTexts = (el: Element): string[] | null => {
        const units = new Set<Element>();
        const parents = new Set<Element>();
        const out: string[] = [];
        let chars = 0;
        const walker = document.createTreeWalker(el, 4 /* SHOW_TEXT */);
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          const p = t.parentElement;
          if (!p || parents.has(p)) continue;
          parents.add(p);
          const reads: { text: string; block: Element }[] = sc.readUnits(p);
          if (!reads.some((r) => r.block.contains(p))) reads.push({ text: lineOf(t).textContent ?? '', block: lineOf(t) as Element });
          for (const { text, block } of reads) {
            if (units.has(block)) continue;
            units.add(block);
            if (units.size > NESTED_UNITS) return null;
            chars += text.length;
            if (chars > MIGHT_MAX) return null;
            out.push(text, block.nodeType === 1 ? spaced(block) : '');
          }
        }
        return out;
      };
      /** A change in a post or unit with a picture (Scanner.nearMedia): read at once, never held. */
      const media = (n: Node) => {
        const e = n.nodeType === 1 ? (n as Element) : n.parentElement;
        return !e || sc.nearMedia(e);
      };
      /** Could the change match anything (see judged)? A throw counts as could (review B of 7ff90bb7: it left the node in `changed`, every pass threw first). */
      const changeCould = (n: Node, key: Node, now: number) => {
        try {
          return !tickerLike(n, key, now) || linked(n, key) || media(n) || textsCould(n, key);
        } catch {
          return true;
        }
      };
      const readChanged = (body: HTMLElement, over: () => boolean, cap = Infinity) => {
        const later: Node[] = [];
        let stop = false;
        const now = performance.now();
        for (const n of pacer.takeDue(now)) changed.add(n);
        // A node leaves `changed` only once it is handed out (read, held by the pacer, or put in the backlog): a throw (a place read, a
        // read) leaves the rest there, and a pass reads them (review rv9 of ae6f8175: taken out first, a throw at the m-th place read left
        // m rewritten names uncovered). The node whose read threw goes to `fresh` once (a node that throws every time is dropped, as before).
        // The place of a node is read only while a read is left for it (undefined: not placed).
        const look: [Node, DOMRect | null | undefined, Node, boolean][] = [];
        let reading: Node | null = null;
        changedTokens = Math.min(CHANGED_BURST, changedTokens + ((now - changedAt) * CHANGED_RATE) / 1000);
        changedAt = now;
        let spare = changedTokens;
        try {
          for (const n of changed) {
            if (look.length >= cap) break;
            // Paced by the element the text (or a small element swapped in) is in, when that is small: a text replaced every frame is a
            // new node every frame (a ticker's textContent), and paced by node it was read every frame (65-126 ms tasks, 4% fewer frames);
            // a <b> swapped into a line every frame, the same (review 1 of d62f5a06). Held, the element is read at the window's end, with
            // whatever it then holds.
            const key = pacingKey(n, CHANGED_ELEMENTS);
            // Held only when its text cannot match (review 1 of d62f5a06: a name written into a line read 5-200 ms before was held to
            // the window's end, 3-15 frames on screen; base reads it in the callback). Pacing is for tickers, whose text is no name.
            // Every way it can be read (review rv12 of 40224450: 'Quux' changed beside 'Zorblax' in a line cannot match alone; judged
            // alone it was held, 115-118 frames on screen; review B of 7ff90bb7: see changeCould).
            const could = changeCould(n, key, now);
            if (!pacer.admit(key, now) && !could) {
              changed.delete(n);
              continue;
            }
            // Text that cannot match past the reads left goes to `fresh` below whatever its place: its place is not read (a ticker swapping
            // 500 lines: 8 places read a callback, the first laying the page out again, for 1-2 reads left; off screen it went to the front
            // of `queue`, which only orders text that cannot match).
            if (!could) {
              if (spare < 1) {
                look.push([n, undefined, key, could]);
                continue;
              }
              spare--;
            }
            const e = n.nodeType === 1 ? (n as Element) : n.parentElement;
            // A place read that throws (every time) hands the node to the backlog, and the rest go on (review A of 6ee5976d: thrown out of
            // readChanged ahead of every set, it kept the pass from the backlog: never covered in 12 s).
            let r: DOMRect | null = null;
            try {
              r = e?.isConnected ? e.getBoundingClientRect() : null;
            } catch {
              changed.delete(n);
              fresh.add(n);
              continue;
            }
            look.push([n, r, key, could]);
          }
          const h = window.innerHeight, w = window.innerWidth;
          for (const [n, r, key, could] of look) {
            if (stop) break;
            changed.delete(n);
            // Text that cannot match, past CHANGED_RATE reads a second: to the end of `fresh`, as before (a ticker rewriting 500 lines a
            // frame, each paced, was still read 2000 times a second: 6-7% fewer frames than base).
            if (!could && (changedTokens < 1 || r === undefined)) {
              fresh.add(n);
              continue;
            }
            // No box (display: contents, review B of 7ff90bb7: text that could match went to the queue, 19 frames): read now when it
            // could match, else as off screen.
            if (!r || (!r.width && !r.height ? !could : r.bottom <= 0 || r.top >= h || r.right <= 0 || r.left >= w)) {
              // Off screen and changed again within CHANGED_AGAIN_MS (a ticker): to the end of `fresh`, as before.
              if (now - (frontAt.get(key) ?? -Infinity) < CHANGED_AGAIN_MS) fresh.add(n);
              else {
                frontAt.set(key, now);
                later.push(n);
              }
            } else {
              pacer.read(key, now);
              if (!could) changedTokens--;
              reading = n;
              read(n, body);
              reading = null;
              stop = over();
            }
          }
        } finally {
          if (reading && !rethrown.has(reading)) {
            rethrown.add(reading);
            fresh.add(reading);
          }
          armPacer();
          if (later.length) {
            // In front, the same set (a pass holds it in its turns).
            const rest = [...queue];
            queue.clear();
            for (const n of later) queue.add(n);
            for (const n of rest) queue.add(n);
          }
          if ((changed.size || reading) && timer === undefined) timer = window.setTimeout(drain, 0);
        }
        return stop;
      };
      const drain = () => {
        timer = undefined;
        if (scanner !== sc) return; // a newer start has taken over: this pass belongs to a scan that was cleared
        if (isTop && location.href !== seenHref) {
          checkAddress(); // single-page sites change address without a reload
          if (scanner !== sc) return; // the answer changed and start() began again: do not touch the old scan
        }
        const body = document.body;
        if (!body) return;
        // When the title or heading has just shown the page is about the game, the scanner reads everything again
        // (weak terms seen earlier now count). What is queued is still read, then on to the end of the pass,
        // so the tab title, screen readers and the count follow at once.
        report(sc.refreshPageContext());
        sc.recheckNow();
        // A page that turned neutral (a single-page site going back to its results) waits for a second look: a quiet page brings no change
        // to drive one, so it is made here, a moment later (a quick turn back to the game still never shows a cover go and come).
        confirmSoon(sc);
        // The budget is for reading nodes, timed after the page judge above (0.1.11: on a page of 6000 posts that took about 5 ms of every
        // pass, so a busy page's backlog was read a few nodes a pass).
        // The parse is done: a few more waiting nodes to move ahead (at most END_FIRST_STEP_MS of collecting a pass, resumed in the next).
        const ef = endFirst;
        if (ef?.state === 'collecting') {
          // What the backlog reads next (see nearHead).
          nearHead.clear();
          for (const q of [queue, fresh]) for (const n of q) { if (nearHead.size >= HEAD_N) break; nearHead.add(n); }
          // A big part (over BIG_READ) takes turns with the backlog even from the first look (see CLAIM_MAX).
          ef.step((n, first) => (first && !bigAhead.has(n) ? ahead : aheadRest).add(n));
          // Only needed while a step looks: let the page's nodes go between steps.
          nearHead.clear();
        }
        const t0 = performance.now();
        // While the page is still loading nobody can interact with it yet, so hiding takes priority.
        const budget = document.readyState === 'loading' ? LOADING_BUDGET_MS : BUDGET_MS;
        // Dialog nodes left over from the callbacks first, for at most a quarter of the budget (0.1.13), then the blocks read ahead (0.1.15),
        // then the backlog, then the rest. Changed text left over comes right after the dialog nodes, with a quarter of the budget of its own,
        // and the pass goes on (what is not on screen goes to the front of `queue`): a page that changes its text all the time takes neither
        // the dialog nodes' share (read before them on the same clock, they were left one node a pass) nor the passes from the rest.
        let over = false;
        let aheadRead = 0;
        // The backlog is `queue` and then `fresh` (a page sent in pieces is mostly in `fresh`): both take the backlog's turns.
        // Nothing moved waits: the backlog has the whole budget, as before (halved, a feed of 6000 waiting posts was read in 4.8 s, not 2.4).
        // The moved rest only while it has used no more time than the backlog: a moved node can take 20 ms, and read after the backlog's few ms
        // in every pass it kept the backlog at a few ms a pass (the saved Bing page sent in pieces: cards 0.45 s later than base).
        const turns = aheadRest.size && (restMs <= queueMs || (!queue.size && !fresh.size))
          ? [[aheadRest, budget / 2], [queue, budget], [fresh, budget]] as const
          : [[queue, budget], [fresh, budget]] as const;
        // What the page added after load first (`newer`), for at most NEWER_SHARE of the pass while an older backlog waits.
        // By time (see newMs): while the old backlog has had less, it has the pass (`newer` only if it ends), else `newer` first for at most
        // NEWER_SHARE of it. (Old first for a share only, a heavy new unit read after it every pass kept the old backlog at 26-29%.)
        const oldWaits = queue.size > 0 || fresh.size > 0;
        if (!oldWaits) newMs = oldMs = 0;
        const newShare = oldWaits || aheadRest.size ? budget * NEWER_SHARE : budget;
        const order = newMs <= oldMs * NEW_RATIO
          ? [[urgent, budget / 4], [ahead, budget], [newer, newShare], ...turns] as const
          : [[urgent, budget / 4], [ahead, budget], ...turns, [newer, budget]] as const;
        for (const [q, share] of order) {
          const qt = performance.now();
          for (const n of q) {
            const moved = q === ahead || q === aheadRest;
            const big = moved && bigAhead.has(n);
            // A big moved node waits for the next pass when this one has read another moved node already. (Not timed: the dialog nodes read
            // first took the pass's first ms on the saved Google page, and every big node then waited, pass after pass, about 1 s.)
            if (big && aheadRead > 0) { over = true; break; }
            if (moved) aheadRead++;
            q.delete(n);
            read(n, body);
            const used = performance.now() - t0;
            if ((over = used > budget || big) || used > share) break;
          }
          if (q === urgent && !over && changed.size) {
            const ct = performance.now();
            readChanged(body, () => performance.now() - ct > budget / 4);
            over = performance.now() - t0 > budget;
          }
          if (q === aheadRest) restMs += performance.now() - qt;
          else if ((q === queue || q === fresh) && aheadRest.size) queueMs += performance.now() - qt;
          if (q === newer && oldWaits) newMs += performance.now() - qt;
          else if (q === queue || q === fresh) oldMs += performance.now() - qt;
          if (over) break;
        }
        if (urgent.size || changed.size || ahead.size || aheadRest.size || newer.size || queue.size || fresh.size || ef?.state === 'collecting') timer = window.setTimeout(drain, 0);
        else tellCount();
        sc.quiet();
        // Reading every cover on a big page costs a few milliseconds: only when one was put on or taken off since last time.
        if (sc.changes !== synced) {
          synced = sc.changes;
          syncReaders(document);
        }
        guardTitle();
        // Not pushed back by every change: a page that keeps changing would otherwise never get its leftover labels cleaned.
        pruneTimer ??= window.setTimeout(() => { pruneTimer = undefined; sc.prune(); }, 1000);
        watchLate();
      };
      lookNow = () => { if (scanner === sc) drain(); };

      // A custom element defined after it was read (lazy chat code, as Reddit's) gets its shadow root with no change the page
      // watcher sees, so it was never read. While one waits for its definition, look again before each paint,
      // for up to half a minute after the page last changed; and twice on the whole page for a defined one that is late too.
      let lateUntil = 0;
      const lookLate = (everywhere = false) => {
        if (scanner !== sc) return;
        const roots = sc.lateShadows(everywhere);
        if (!roots.length) return;
        for (const r of roots) queue.add(r);
        if (timer === undefined) drain();
      };
      const lateTick = () => {
        lateFrame = undefined;
        lookLate();
        // The drain above may have asked for the next look already.
        if (lateFrame === undefined && scanner === sc && sc.lateWaiting && performance.now() < lateUntil) lateFrame = requestAnimationFrame(lateTick);
      };
      function watchLate() {
        if (!sc.lateWaiting) return;
        lateUntil = performance.now() + 30_000;
        if (lateFrame === undefined) lateFrame = requestAnimationFrame(lateTick);
      }
      watchLate();
      for (const ms of [3000, 10000]) staleTimers.push(window.setTimeout(() => lookLate(true), ms));

      observer = new MutationObserver((muts) => {
        // With nothing waiting, as always: into the queue and read now. While earlier changes still wait (a page still read in pieces, a busy
        // page), the new nodes go after the other new ones (`fresh`, in the order they came), and after a small change the oldest of those are
        // read now, ahead of the backlog, before the browser paints them. Behind the backlog they stayed in view for seconds (0.1.11: the tiles
        // of other posts in an Instagram post dialog, a listed name on them too). See FRESH_BUDGET_MS for the shares.
        const waiting = timer !== undefined;
        // The page's own nodes (not our labels: a cover's bar is put in at once and must not start more reads), and among them what is, holds
        // or lands inside a dialog (`urgent`, 0.1.13): inside, one look per change at where it landed; is or holds, the first DIALOG_CHECKS
        // nodes of the callback and the last DIALOG_TAIL of each change.
        let added = 0;
        let changes = 0;
        const into = (n: Node, inDialog: boolean, tail: boolean, replaces = false) => {
          const e = n.nodeType === 1 ? (n as Element) : n.parentElement;
          // Our own go with the backlog, as before 0.1.11.
          // Not also read as changed text (see change).
          changed.delete(n);
          if (!waiting || e?.closest(OWN_NODES)) return void queue.add(n);
          queue.delete(n);
          added++;
          if (inDialog || (n.nodeType === 1 && (added <= DIALOG_CHECKS || tail) && (e!.matches(DIALOGS) || e!.querySelector(DIALOGS)))) {
            fresh.delete(n);
            newer.delete(n);
            urgent.add(n);
          } else if (!urgent.has(n)) {
            // After load: before the old backlog (see `newer`); a part with elements in it only (a unit, a post), not a text or a bare
            // element swapped in (a ticker's churn: read first, a ticker that swaps 500 lines a frame cost 7% of the frames), and nothing
            // put in where other nodes were taken out (`replaces`: a rewrite of a part already there, not an appended unit; review C of
            // e03f5713: a ticker swapping '<span><b>..</b></span>' into 500 lines put them ahead, the old backlog's last post 0.65 s later).
            // A page that rebuilds a unit by taking it out and putting a new one in goes to `fresh`, as before `newer`.
            if (!replaces && document.readyState === 'complete' && n.nodeType === 1 && (n as Element).firstElementChild) {
              fresh.delete(n);
              newer.add(n);
            } else if (!newer.has(n)) fresh.add(n);
          }
        };
        /** Where a change landed is inside a dialog (looked at only while a backlog waits). */
        const landsInDialog = (t: Node) => {
          if (!waiting) return false;
          const at = t.nodeType === 1 ? (t as Element) : (t.parentElement ?? (t as ShadowRoot).host ?? null);
          return !!at?.closest(DIALOGS);
        };
        /** Text changed in place (see `changed`): in a dialog, past CHANGED_MAX, our own, or more than a few elements (a part swapped in), as a new node. */
        const change = (n: Node, tail = true) => {
          const inside = landsInDialog(n);
          const e = n.nodeType === 1 ? (n as Element) : n.parentElement;
          if (!waiting || inside || changes >= CHANGED_MAX || e?.closest(OWN_NODES) || (n.nodeType === 1 && (e!.getElementsByTagName('*')[CHANGED_ELEMENTS] || e!.matches(DIALOGS) || e!.querySelector(DIALOGS)))) return into(n, inside, tail, true);
          changes++;
          // Counted as a change of the callback, as before (a callback with only such changes still reads the oldest of `fresh` in the slice:
          // not counted, a clock rewritten every frame left the slice unused and a backlog ended 1 s later).
          added++;
          // Read here only (not also where it waited before).
          queue.delete(n);
          fresh.delete(n);
          newer.delete(n);
          urgent.delete(n);
          ahead.delete(n);
          aheadRest.delete(n);
          changed.delete(n);
          changed.add(n);
        };
        const seenAt = performance.now();
        for (const m of muts) {
          if (m.type === 'characterData') {
            noteChange(m.target.parentNode, seenAt);
            change(m.target, false);
          }
          // A reused card (YouTube recycles its tiles) gets a new link address without a new element: spoiler accounts are
          // read from links, so a changed address is checked for those only (watched only while any account is listed).
          else if (m.type === 'attributes') {
            const t = m.target as Element;
            if (m.attributeName === 'href') sc.linkChanged(t);
            else if (t.matches('img, video')) into(t, landsInDialog(t), false);
          }
          else if (m.addedNodes.length) {
            // An element's text replaced (a node or two put in where others were taken out): changed text too. Not a picture: put in at a
            // size it has not got yet, read at once it was covered as a tiny icon (the saved IGN game page's 145x16 thumbnail).
            const swap = m.removedNodes.length > 0 && m.addedNodes.length <= 2;
            if (swap) noteChange(m.target, seenAt);
            const inside = landsInDialog(m.target);
            const last = m.addedNodes.length - DIALOG_TAIL;
            // Past CHANGED_MAX (or with nothing waiting) straight to the backlog, as before: a ticker swapping 500 lines a frame paid a
            // picture check and a dialog check for each (5% fewer frames than base).
            m.addedNodes.forEach((n, i) => (swap && waiting && changes < CHANGED_MAX && (n.nodeType === 3 || (n.nodeType === 1 && !(n as Element).matches(MEDIA) && !(n as Element).querySelector(MEDIA))) ? change(n, i >= last) : into(n, inside, i >= last, m.removedNodes.length > 0)));
          }
        }
        if (!waiting) return drain();
        const small = added > 0 && added <= FRESH_MAX_NODES;
        if (sliceOpen && performance.now() - sliceAt > SLICE_TASK_MS) {
          sliceLeft = FRESH_BUDGET_MS;
          sliceOpen = false;
        }
        if ((!small || (!fresh.size && !newer.size)) && !urgent.size && !changed.size) return;
        if (sliceLeft <= 0 || scanner !== sc) return;
        // The new nodes are read at the page's new address (an opened post), as in a pass.
        if (isTop && location.href !== seenHref) {
          checkAddress();
          if (scanner !== sc) return;
        }
        const body = document.body;
        if (!body) return;
        // One slice a task for all these reads together: it is given back when the task ends (see sliceEnd).
        if (!sliceOpen) {
          sliceOpen = true;
          sliceAt = performance.now();
          sliceEnd.port2.postMessage(0);
        }
        const t0 = performance.now();
        const over = () => performance.now() - t0 > sliceLeft;
        let stop = false;
        // A dialog and what lands in one first, whatever came with them, oldest first.
        for (const d of urgent) {
          urgent.delete(d);
          read(d, body);
          if ((stop = over())) break;
        }
        // Then changed text on screen (the rest into `queue`, first).
        if (!stop && changed.size) stop = readChanged(body, over, CHANGED_SCREEN_CAP);
        if (small && !stop) {
          // What the page added after load first (see `newer`), then the oldest of `fresh`; the old first while it has had less time.
          const oldWaits = queue.size > 0 || fresh.size > 0;
          for (const q of newMs <= oldMs * NEW_RATIO ? [newer, fresh] : [fresh]) {
            // (An empty set is not timed: the clock reads cost the slice its first read.)
            if (!q.size) continue;
            const qt = performance.now();
            for (const n of q) {
              q.delete(n);
              read(n, body);
              if ((stop = over())) break;
            }
            if (q === newer && oldWaits) newMs += performance.now() - qt;
            else if (q === fresh) oldMs += performance.now() - qt;
            if (stop) break;
          }
        }
        sliceLeft -= performance.now() - t0;
      });
      // The page is still loading at this point, so watch the whole document, not just a body that may not exist yet.
      // Lazy-loaded pictures get their address and description after they are added, so those attributes are watched too,
      // and so are link addresses (spoiler accounts).
      observer.observe(document.documentElement, watchOpts);
      // The page watcher does not see inside shadow roots: each one found is watched on its own.
      for (const r of shadowRoots()) observer.observe(r, watchOpts);
      // 0.1.15: once the parse is done (and again on load), the end of the page and what is on screen are read ahead of the backlog
      // (see `ahead`). A start after load read the whole body above already. Only a node waiting in the backlog moves (claimFor).
      const body0 = () => document.body ?? document.documentElement;
      const waits = (x: Node) => queue.has(x) || fresh.has(x) || newer.has(x);
      const take = (x: Node) => { queue.delete(x); fresh.delete(x); newer.delete(x); };
      const ef = new EndFirst(document, (t, onScreen) => {
        for (let x: Node | null = t; x && x !== document.body; x = x.parentNode) if (nearHead.has(x)) return null;
        const n = claimFor(t, body0(), waits, take, onScreen ? CLAIM_MAX : CLAIM_MAX_END);
        if (n?.nodeType === 1 && (n as Element).getElementsByTagName('*')[BIG_READ]) bigAhead.add(n);
        return n;
      });
      endFirst = ef;
      // 0.1.15 second step: what is on screen is looked for by position first (end-first.ts), in a pass right after DOMContentLoaded (and
      // load): a timer, not the event itself (run in the event, it laid a feed of 6000 posts out in the page's own task: 145 ms, base 65).
      const readEndFirst = (screenOnly = false) => {
        if (scanner !== sc || endFirst !== ef) return;
        // Nothing waits: nothing to move ahead (the page behaves as before).
        if (!queue.size && !fresh.size) return;
        ef.start(screenOnly);
        if (screenOnly) {
          if (timer === undefined) timer = window.setTimeout(drain, 0);
          return;
        }
        clearTimeout(timer);
        drain();
      };
      const soon = () => window.setTimeout(() => readEndFirst(), 0);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', soon, { once: true });
      if (document.readyState !== 'complete') window.addEventListener('load', soon, { once: true });
      // Scrolled while a backlog waits: once the scrolling stops, what is on screen now is moved ahead too.
      let scrollIdle: number | undefined;
      const onScroll = () => {
        if (scanner !== sc) return void window.removeEventListener('scroll', onScroll);
        if (document.readyState === 'loading') return;
        clearTimeout(scrollIdle);
        scrollIdle = window.setTimeout(() => readEndFirst(true), SCROLL_IDLE_MS);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
    };

    const begin = async () => {
      if (!isTop) {
        send({ type: 'isPageAbout' }, (r) => {
          const about = (r as { about?: boolean } | undefined)?.about === true;
          if (about !== outer) { outer = about; scanner?.setOuterContext(about); if (scanner) confirmSoon(scanner); }
        });
      }

      if (isTop) {
        seenHref = location.href;
        send({ type: 'pageUrl', url: seenHref }); // frames inside this page follow its address
        // Single-page sites change address without reloading. The observer drain also compares addresses.
        const nav = (window as unknown as { navigation?: EventTarget }).navigation;
        nav?.addEventListener('navigatesuccess', checkAddress);
        window.addEventListener('popstate', checkAddress);
        window.addEventListener('hashchange', checkAddress);
        // Without the Navigation API, a page that is not being watched (a Safe page) would never notice.
        if (!nav) setInterval(checkAddress, 1000);
      }

      // Listen before the first start: it can wait over a second for the tab address, and a message from the top
      // in that time was lost. One that comes before the scanner exists is picked up when it is made.
      chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
        // The popup talks to the top frame: a frame inside it stays silent so it cannot answer first.
        if (msg?.type === 'getCount') { if (isTop) reply({ count: scanner?.count ?? 0, groups: scanner?.groups ?? {} }); }
        else if (msg?.type === 'askPageAbout') { if (isTop) reply({ about: reported === true }); }
      else if (msg?.type === 'askPageUrl') { if (isTop) reply({ url: location.href }); }
      else if (msg?.type === 'askGeneric') { if (isTop) reply({ generic: genericAt === location.host + location.pathname }); }
      else if (msg?.type === 'pageUrl') {
        if (!isTop && typeof msg.url === 'string' && msg.url !== tabUrl) { tabUrl = msg.url; checkAddress(); }
      }
      else if (msg?.type === 'pageAbout') {
          if (!isTop) { outer = msg.about === true; scanner?.setOuterContext(outer); if (scanner) confirmSoon(scanner); tellCount(); }
        }
        else if (msg?.type === 'revealAll') {
          scanner?.revealAll();
          titleShown = true;
          guardTitle();
          tellCount();
          reply({ count: 0 });
        }
      });

      await start();

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.settings || changes.list)) void start(!changes.settings, !!changes.settings);
      });
      // A tab frozen (back/forward cache) or in the background can miss a Resume, the wake timer or a settings change (a stricter choice,
      // the blackout, a restore) and stay unprotected. Shown again while not hiding, it looks again; a running scan starts again only if
      // the saved settings are not the ones it started with.
      const shown = async () => {
        if (!scanner) return void start();
        // A tab cut off by an update keeps what it has: reading from it would answer with the defaults, and a restart would drop what
        // the person revealed (review of the first version).
        if (!extensionAlive()) return;
        try {
          if (settingsChangedSince(lastSaved, await keptSettings())) void start(false, true);
        } catch {
          /* cut off while reading: nothing to compare */
        }
      };
      window.addEventListener('pageshow', (e: PageTransitionEvent) => { if (e.persisted) void shown(); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void shown(); });
    };

    // A frame with no address of its own is often an empty ad slot: it starts only once it holds something to read.
    const ownless = !isTop && /^(about|data|blob):$/.test(location.protocol);
    const filled = () => !!document.body && (/\S/.test(document.body.textContent ?? '') || !!document.body.querySelector('img, video'));
    const ready = () => isTop || (bigEnough() && (!ownless || filled()));
    // A frame that is tiny at start may grow (a lazy comment box), and an empty one may be filled later: look again then.
    if (!ready()) {
      let ro: ResizeObserver | undefined;
      let mo: MutationObserver | undefined;
      let begun = false;
      const retry = () => {
        if (begun || !ready()) return;
        begun = true;
        ro?.disconnect();
        mo?.disconnect();
        window.removeEventListener('load', retry);
        void begin();
      };
      window.addEventListener('load', retry);
      if (typeof ResizeObserver !== 'undefined') (ro = new ResizeObserver(retry)).observe(document.documentElement);
      // On the document itself, so it still sees a frame the page rewrites with document.open().
      if (ownless) (mo = new MutationObserver(retry)).observe(document, { childList: true, subtree: true, characterData: true });
      return;
    }
    await begin();
  },
});
