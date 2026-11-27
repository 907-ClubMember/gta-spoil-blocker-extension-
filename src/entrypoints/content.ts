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
import { bandRange } from '../content/scroll-band';

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
     * While the page is parsed, what is on screen is read right before each paint (see paintLook): points across and down the window; ms a
     * look before the first paint (paint-window, saved pages: 150 ms put the saved Google page's first paint 96 ms later, 50 ms 92 ms) and
     * after it (50 ms left a part of the saved Reddit thread for the next frame, painted uncovered for one long frame: 0.4 s, 2 loads in 3);
     * the biggest part read.
     */
    const PAINT_X = 6, PAINT_Y = 12, PAINT_FIRST_MS = 50, PAINT_LOOK_MS = 150, PAINT_MAX_ELS = 600;
    /** The animation frame asked for the next look (0: none). */
    let paintFrame = 0;
    /** DOMContentLoaded has run: the look runs until then (review P1 of 2ac745ef: the parser's last part comes while the page is 'interactive'). */
    let dclSeen = document.readyState !== 'loading';
    if (!dclSeen) document.addEventListener('DOMContentLoaded', () => { dclSeen = true; }, { once: true });
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
    /**
     * Nodes whose read threw once in this scan (readChanged, readOrRequeue, a page watcher record). One set for all, for the whole scan: a node
     * that throws again, even much later, is split into its parts (one with none is left unread). Accepted (review Q2 of 5d209622): a second
     * throw on the same node is rare, and a set per pass could retry a node that always throws forever.
     */
    let rethrown = new WeakSet<Node>();
    /** Nodes handed to a read by the backlog's loops (see readOrRequeue and afterThrow). */
    let handled = 0;
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
    /**
     * `ahead` holds what a scroll look moved (till it empties); the time read from `ahead` and from the rest (the backlog, `newer`, aheadRest)
     * meanwhile: `ahead` keeps at most 3/4 of it (see drainPass).
     */
    let scrollFed = false;
    let fedMs = 0, unfedMs = 0;
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
    /** Not walked by the scroll look (nothing in them is shown). */
    const SWEEP_SKIP = `script, style, noscript, template, ${OWN_NODES}`;
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
    /**
     * Scroll first (see lookForScroll): at most one look a SCROLL_LOOK_MS while the page scrolls (and one after the last scroll); each walks
     * for at most SWEEP_MS and moves at most SWEEP_CLAIMS parts ahead, SWEEP_RATE a second in all (a pass reads about 1,000 a second).
     */
    const SCROLL_LOOK_MS = 100, SWEEP_MS = 4, SWEEP_CLAIMS = 100, SWEEP_RATE = 1200;
    /** A node with more child elements than this is walked only across the band (see `across`). */
    const SWEEP_LIST = 32;
    /** The scroll look's points across and down the window (fewer than the paint look's: each hit test on a big page costs 0.2-0.5 ms). */
    const SWEEP_X = 4, SWEEP_Y = 8;
    /** The band ahead of a fast scroll reaches at most this many screens. */
    const SWEEP_SCREENS = 4;
    /** A walk of the window goes on over at most this many frames (see viewWalk). */
    const SWEEP_FRAMES = 6;
    /** The animation frame and the timer asked for the next scroll look (0, undefined: none). */
    let scrollFrame = 0;
    let scrollTimer: number | undefined;
    /** Takes the running scan's scroll listeners off (see stop). */
    let unlisten: (() => void) | null = null;
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
      // A look asked for by the scan that ends (a new start asks for its own).
      if (paintFrame) cancelAnimationFrame(paintFrame);
      paintFrame = 0;
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
      clearTimeout(scrollTimer);
      scrollTimer = undefined;
      unlisten?.();
      unlisten = null;
      urgent = new Set();
      changed = new Set();
      frontAt = new WeakMap();
      // A node that threw in the scan that ends gets its one more read in a new one (review Q1 of 0553a8ba).
      rethrown = new WeakSet();
      pacer.clear();
      judged.clear();
      changedTimes = new WeakMap();
      if (pacerTimer !== undefined) clearTimeout(pacerTimer);
      pacerTimer = undefined;
      ahead = new Set();
      aheadRest = new Set();
      restMs = queueMs = 0;
      bigAhead = new WeakSet();
      scrollFed = false;
      fedMs = unfedMs = 0;
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
      // The first look at the page and its first read: a throw there (odd markup) must not end this start (review Q1 of 0553a8ba: start()
      // began again on the built-in list, so the page lost the user's list; when that read threw too, the page was never watched). The page
      // waits in the backlog for the first pass instead, part by part, and the throw reaches the browser once the page watcher is set up.
      // The list is kept as the last good one: a read that throws is a fault of the page or the scanner, not a damaged list (a list that made
      // every read throw used to fall back to the built-in one; it now stays: the page is read part by part with it).
      let firstThrow: { e: unknown } | undefined;
      try {
        report(sc.refreshPageContext());
        if (document.body) sc.scan(document.body);
      } catch (e) {
        firstThrow = { e };
        // Its parts, one by one (a read of the whole body that throws every time would never be read).
        if (document.body) for (const c of document.body.childNodes) queue.add(c);
      }
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
      /**
       * What waits in the backlog under a grid of points over the window is read now: the outermost waiting part under each point (at most
       * PAINT_MAX_ELS elements, see claimFor), for up to PAINT_FIRST_MS before the page's first paint, PAINT_LOOK_MS after it. Run in an
       * animation frame, so right before the browser paints. A part read whole takes what waits inside it out of the backlog, and a point
       * over it is passed (review P1 of 2ac745ef: claimFor takes the outermost waiting part, what waited inside stayed, and each point over it
       * read the next level down: 61 reads, 442 elements, for a 77-element page); under a point with no waiting part, the element's own
       * texts that wait (claimFor walks up only: a name put in a line read before waited 540 ms).
       */
      const paintLook = (body: HTMLElement) => {
        // Nothing waits: nothing to look for (72 hit tests a frame).
        if (!queue.size && !fresh.size && !newer.size) return;
        const t0 = performance.now();
        const most = performance.getEntriesByType('paint').length ? PAINT_LOOK_MS : PAINT_FIRST_MS;
        const waits = (x: Node) => queue.has(x) || fresh.has(x) || newer.has(x);
        const take = (x: Node) => { queue.delete(x); fresh.delete(x); newer.delete(x); };
        const vw = window.innerWidth, vh = window.innerHeight;
        // Every hit test first, then the reads (review P2 of 2ac745ef: a read that covers dirties style, and each hit test after it laid the
        // page out again); the time is looked at before each read.
        const hits = new Set<Element>();
        for (let y = 0; y < PAINT_Y; y++) for (let x = 0; x < PAINT_X; x++) {
          const e = document.elementFromPoint(((x + 0.5) * vw) / PAINT_X, ((y + 0.5) * vh) / PAINT_Y);
          if (e && e !== body && e !== document.documentElement) hits.add(e);
        }
        const done: Node[] = [];
        // A read that throws goes back to `fresh` after the look (readOrRequeue), and the look goes on.
        for (const e of hits) {
          if (performance.now() - t0 > most) return;
          if (done.some((d) => d.contains(e))) continue;
          const n = claimFor(e, body, waits, take, PAINT_MAX_ELS);
          if (n) {
            // The walk below only after a read that worked (review P2b of 650882c5: a part that threw twice is split into its parts, back in
            // the backlog, and the walk took them out again: nothing in it was read again).
            if (!readOrRequeue(n, body)) continue;
            done.push(n);
            const w = document.createTreeWalker(n, 5 /* NodeFilter.SHOW_ELEMENT | SHOW_TEXT */);
            for (let d = w.nextNode(); d; d = w.nextNode()) if (waits(d)) take(d);
          } else {
            for (let c = e.firstChild; c; c = c.nextSibling) {
              if (c.nodeType === 3 && waits(c)) {
                if (performance.now() - t0 > most) return;
                take(c);
                readOrRequeue(c, body);
              }
            }
          }
        }
      };
      /** Reads `n` if it is still in the page. */
      /**
       * `read` in the backlog's loops (a pass, the page watcher's slice; `handled` counts them). A read that throws does not end the loop: its node
       * goes back to its set after the pass (`back`: a dialog stays ahead of the backlog, review Q1 of 0553a8ba) once (a node that throws again
       * is split into its parts, down to nodes with none, which are left unread) and the next pass is asked for (review P2 of the paint look: the throw ended
       * the pass before the next one was asked for, and on a page quiet after load the rest of the backlog was never read: in one run the
       * saved Bing page kept 6 named results uncovered).
       */
      // Review Q2 of 5d209622: a read that threw was thrown on at once, so it ended the pass, and a page where every read throws took one node
      // a pass (300 posts: 3600 passes and 3600 errors). Now the pass goes on; the first throw of the scan reaches the browser, the others are
      // told in one warning once the backlog is read (fixed words and the error's kind only: see no-error-text-logged).
      let readThrew = false;
      let untold: Error | undefined;
      let leftUnread = false;
      /** Nodes whose read threw in this pass or callback, back in their sets once it is over (read again in the next pass, not this one). */
      const putBack: [Node, Set<Node>][] = [];
      const flushBack = () => {
        for (const [n, s] of putBack) s.add(n);
        putBack.length = 0;
      };
      const readOrRequeue = (n: Node, body: HTMLElement, back: Set<Node> = fresh) => {
        handled++;
        try {
          read(n, body);
          return true;
        } catch (e) {
          const sr = n.nodeType === 1 ? (n as Element).shadowRoot : null;
          if (!rethrown.has(n)) {
            rethrown.add(n);
            putBack.push([n, back]);
          } else if (n.firstChild || sr) {
            // Twice: its parts, one by one (review Q1: a wrapper of 50 posts with one bad post dropped all 50; a part that throws twice is
            // split again, down to a node with nothing in it, which is dropped: finite). A host's own shadow root is one of its parts (review Q2).
            for (let c: ChildNode | null = n.firstChild; c; c = c.nextSibling) fresh.add(c);
            if (sr) fresh.add(sr);
          } else leftUnread = true;
          if (readThrew) untold = e as Error;
          else {
            readThrew = true;
            window.setTimeout(() => { throw e; }, 0);
          }
          if (timer === undefined && scanner === sc) timer = window.setTimeout(drain, 0);
          return false;
        }
      };
      /** The reads that threw after the first, and parts left unread: a warning each, once the backlog is read (see readOrRequeue). */
      const tellReadThrows = () => {
        if (untold) console.warn('Spoiler Blocker: more reads failed on this page', untold?.name);
        if (leftUnread) console.warn('Spoiler Blocker: some parts that failed twice are left unread');
        untold = undefined;
        leftUnread = false;
      };
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
              // As the backlog's reads (review Q2 of 5d209622): a throw puts it back once, then splits it, and does not end the slice.
              readOrRequeue(n, body);
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
      /** Kinds of a pass's own steps that threw in this scan (each reported once: see `step`). */
      const stepThrew = new Set<string>();
      /**
       * A pass's own step (the address, the page's context, the recheck, the end-first look, the tidying after the reads): one that throws
       * does not keep the pass from its reads (review Q1: a page-context look that threw in every pass asked for the next pass at once, 1000
       * passes a second, and the backlog was never read). The throw reaches the browser once a kind, after the pass; `failed` is the step's
       * own way out, each time it throws.
       */
      const step = (kind: string, f: () => void, failed?: () => void) => {
        try {
          f();
        } catch (e) {
          try {
            failed?.();
          } catch {
            // Its way out threw too: the pass goes on to its reads all the same.
          }
          if (stepThrew.has(kind)) return;
          stepThrew.add(kind);
          window.setTimeout(() => { throw e; }, 0);
        }
      };
      const drainPass = () => {
        // Called at once (a callback with nothing waiting) while a pass was asked for (after a throw): that one is not needed now.
        clearTimeout(timer);
        timer = undefined;
        if (scanner !== sc) return; // a newer start has taken over: this pass belongs to a scan that was cleared
        if (isTop && location.href !== seenHref) {
          step('address', checkAddress); // single-page sites change address without a reload
          if (scanner !== sc) return; // the answer changed and start() began again: do not touch the old scan
        }
        const body = document.body;
        if (!body) return;
        // When the title or heading has just shown the page is about the game, the scanner reads everything again
        // (weak terms seen earlier now count). What is queued is still read, then on to the end of the pass,
        // so the tab title, screen readers and the count follow at once.
        // A page that turned about the game is read again whole (rescanAll); when that throws, the first time, its parts wait in the backlog
        // to be read in the new context (review Q1 of 7de197e4: a weak name read before stayed uncovered), and so do the shadow roots already
        // read, which a read of the body does not enter again (review Q1 of f55b2db0).
        step('context', () => report(sc.refreshPageContext()), () => {
          if (stepThrew.has('context') || !document.body) return;
          for (const c of document.body.childNodes) queue.add(c);
          for (const r of sc.knownShadows()) queue.add(r);
        });
        step('recheck', () => sc.recheckNow());
        // A page that turned neutral (a single-page site going back to its results) waits for a second look: a quiet page brings no change
        // to drive one, so it is made here, a moment later (a quick turn back to the game still never shows a cover go and come).
        step('confirm', () => confirmSoon(sc));
        // The budget is for reading nodes, timed after the page judge above (0.1.11: on a page of 6000 posts that took about 5 ms of every
        // pass, so a busy page's backlog was read a few nodes a pass).
        // The parse is done: a few more waiting nodes to move ahead (at most END_FIRST_STEP_MS of collecting a pass, resumed in the next).
        const ef = endFirst;
        if (ef?.state === 'collecting') {
          // What the backlog reads next (see nearHead).
          nearHead.clear();
          for (const q of [queue, fresh]) for (const n of q) { if (nearHead.size >= HEAD_N) break; nearHead.add(n); }
          // A big part (over BIG_READ) takes turns with the backlog even from the first look (see CLAIM_MAX).
          // A step that throws ends the look for this scan, its held parts back to the backlog (review Q1 of 7de197e4: still 'collecting', it
          // asked for a pass every 0 ms with nothing to read).
          const moveAhead = (n: Node, first: boolean) => (first && !bigAhead.has(n) ? ahead : aheadRest).add(n);
          step('end-first', () => ef.step(moveAhead), () => ef.stop(moveAhead));
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
        // While scroll looks keep `ahead` full, the rest goes first whenever `ahead` has had over 3/4 of the time (review P2c of 4b12e5fb: with
        // `ahead` first in every pass, the backlog and what the page added after load waited until the scrolling stopped; by time, as the
        // other turns: a share of a pass is overrun by a heavy read, and two reads of `ahead` took every pass).
        const restFirst = scrollFed && fedMs > 3 * unfedMs && (queue.size > 0 || fresh.size > 0 || newer.size > 0 || aheadRest.size > 0);
        // And what the page added after load (`newer`) goes before `ahead` while the looks feed it, `ahead` then at most 3/4 of the pass (review
        // P1 of 3e63273a: after `ahead`, or after the backlog's whole turn, 13 units appended during a scroll waited the whole scroll, 7 s
        // and more; paint2 133 ms).
        const order = restFirst
          ? [[urgent, budget / 4], [newer, newShare], ...turns, [ahead, budget]] as const
          : scrollFed && newer.size
            ? [[urgent, budget / 4], [newer, newShare], [ahead, (budget * 3) / 4], ...turns] as const
            : newMs <= oldMs * NEW_RATIO
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
            readOrRequeue(n, body, q);
            const used = performance.now() - t0;
            if ((over = used > budget || big) || used > share) break;
          }
          if (q === urgent && !over && changed.size) {
            const ct = performance.now();
            readChanged(body, () => performance.now() - ct > budget / 4);
            over = performance.now() - t0 > budget;
          }
          if (scrollFed && q !== urgent) {
            if (q === ahead) fedMs += performance.now() - qt;
            else unfedMs += performance.now() - qt;
          }
          if (q === aheadRest) restMs += performance.now() - qt;
          else if ((q === queue || q === fresh) && aheadRest.size) queueMs += performance.now() - qt;
          if (q === newer && oldWaits) newMs += performance.now() - qt;
          else if (q === queue || q === fresh) oldMs += performance.now() - qt;
          if (over) break;
        }
        flushBack();
        if (!ahead.size) {
          scrollFed = false;
          fedMs = unfedMs = 0;
        }
        if (urgent.size || changed.size || ahead.size || aheadRest.size || newer.size || queue.size || fresh.size || ef?.state === 'collecting') {
          // A read that threw in this pass has asked for the next one already.
          if (timer === undefined) timer = window.setTimeout(drain, 0);
        } else {
          step('count', tellCount);
          tellReadThrows();
        }
        step('quiet', () => sc.quiet());
        // Reading every cover on a big page costs a few milliseconds: only when one was put on or taken off since last time.
        if (sc.changes !== synced) {
          synced = sc.changes;
          step('readers', () => syncReaders(document));
        }
        step('title', guardTitle);
        // Not pushed back by every change: a page that keeps changing would otherwise never get its leftover labels cleaned.
        pruneTimer ??= window.setTimeout(() => { pruneTimer = undefined; sc.prune(); }, 1000);
        step('late', watchLate);
      };
      /** Something waits to be read (see `afterThrow`). */
      const backlogWaits = () => urgent.size > 0 || changed.size > 0 || ahead.size > 0 || aheadRest.size > 0 || newer.size > 0 || queue.size > 0 || fresh.size > 0;
      /**
       * A pass or a page watcher callback that throws (a read, the page's context, the end-first look, anything in it) still reaches the
       * browser, but the next pass is asked for while something waits (review P2 of the paint look: a throw ended the pass before the next one
       * was asked for, and on a page quiet after load the backlog was never read again). Only on a throw: a pass that returns early (no body
       * yet, an old scan) asks for nothing.
       */
      // Passes in a row that threw with no node handled (see afterThrow).
      let idleThrows = 0;
      const afterThrow = (progress: boolean) => {
        if (scanner !== sc || timer !== undefined || !backlogWaits()) return;
        // A throw that handled a node (read, put back once, split or dropped) goes on at once; one that handled none (something else in the
        // pass throws every time) waits longer each time, 4 ms to 1 s, so it can never spin.
        idleThrows = progress ? 0 : idleThrows + 1;
        timer = window.setTimeout(drain, idleThrows ? Math.min(1000, 4 * 2 ** (idleThrows - 1)) : 0);
      };
      const drain = () => {
        const before = handled;
        let ok = false;
        try {
          drainPass();
          ok = true;
        } finally {
          flushBack();
          if (!ok) afterThrow(handled > before);
          else idleThrows = 0;
        }
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

      /** A throw of a record in the last callback, for the browser once the callback is done (see onChanges). */
      let callbackThrow: { e: unknown } | undefined;
      const onChanges = (muts: MutationRecord[]) => {
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
        // Elements and texts put in by this callback's changes (the on-screen look below runs only when there are any).
        let parsedEls = 0;
        const into = (n: Node, inDialog: boolean, tail: boolean, replaces = false) => {
          const e = n.nodeType === 1 ? (n as Element) : n.parentElement;
          // Our own bars and labels are not parsed content: they ask for no look (review P2 of 2ac745ef).
          if ((n.nodeType === 1 || n.nodeType === 3) && !e?.closest(OWN_NODES)) parsedEls++;
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
        // A record whose handling throws (a link read, a dialog check) does not skip the records after it (review Q1 of 0553a8ba: their nodes
        // never reached the backlog): its nodes go to the backlog, the others are handled, and the throw reaches the browser after the rest of
        // the callback (the reads before paint: see the page watcher below).
        for (const m of muts) {
          try {
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
          } catch (e) {
            // Its target and what it put in (review Q1: with <html> as the target, a read of it does nothing, and the record's nodes were
            // lost), to the backlog.
            if (m.target !== document.documentElement && !rethrown.has(m.target)) {
              rethrown.add(m.target);
              fresh.add(m.target);
            }
            m.addedNodes.forEach((n) => { if (!queue.has(n) && !fresh.has(n) && !newer.has(n) && !urgent.has(n)) fresh.add(n); });
            if (timer === undefined) timer = window.setTimeout(drain, 0);
            callbackThrow ??= { e };
          }
        }
        // While the page is parsed, what it put in on screen is read before the browser paints it (item 4, paint-window: on main the saved
        // Reddit pages' left nav, parsed late, was painted uncovered until the look after load, 1-1.7 s every load). By position, once a frame
        // in an animation frame (all that was parsed by then; the parser hands thousands of nodes a callback: a box for each cost 14-28 ms
        // and missed the nav; a look in every callback put first paint up to 270 ms later).
        // Until DOMContentLoaded (also while 'interactive': the parser's last part), never after load.
        if (parsedEls > 0 && !dclSeen && document.readyState !== 'complete' && !paintFrame) {
          paintFrame = requestAnimationFrame(() => {
            paintFrame = 0;
            // Not after DOMContentLoaded either (review P2 of 2ac745ef): the end-first look has moved parts ahead by then (ahead, aheadRest), which
            // this look does not see waiting, and it read them twice.
            if (scanner !== sc || !document.body || document.readyState === 'complete' || dclSeen) return;
            // Guarded as a pass's own steps are (see step): a throw reaches the browser once a scan (review P2b of 650882c5: a hit test that
            // threw in every frame sent an error each), and still asks for the pass.
            const before = handled;
            try {
              step('look', () => paintLook(document.body), () => afterThrow(handled > before));
            } finally {
              flushBack();
            }
          });
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
          readOrRequeue(d, body, urgent);
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
              readOrRequeue(n, body, q);
              if ((stop = over())) break;
            }
            if (q === newer && oldWaits) newMs += performance.now() - qt;
            else if (q === fresh) oldMs += performance.now() - qt;
            if (stop) break;
          }
        }
        sliceLeft -= performance.now() - t0;
      };
      observer = new MutationObserver((muts) => {
        let ok = false;
        // A record that threw (see onChanges), raised after the reads. When the callback itself threw, that throw goes out and this one is let
        // go (never raised in a later callback).
        let t: { e: unknown } | undefined;
        try {
          onChanges(muts);
          ok = true;
        } finally {
          flushBack();
          if (!ok) afterThrow(true);
          t = callbackThrow;
          callbackThrow = undefined;
        }
        if (t) throw t.e;
      });
      // The page is still loading at this point, so watch the whole document, not just a body that may not exist yet.
      // Lazy-loaded pictures get their address and description after they are added, so those attributes are watched too,
      // and so are link addresses (spoiler accounts).
      observer.observe(document.documentElement, watchOpts);
      // The page watcher does not see inside shadow roots: each one found is watched on its own.
      for (const r of shadowRoots()) observer.observe(r, watchOpts);
      if (firstThrow) {
        const { e } = firstThrow;
        if (timer === undefined) timer = window.setTimeout(drain, 0);
        window.setTimeout(() => { throw e; }, 0);
      }
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
      const readEndFirst = () => {
        if (scanner !== sc || endFirst !== ef) return;
        // Nothing waits: nothing to move ahead (the page behaves as before).
        if (!queue.size && !fresh.size) return;
        ef.start();
        clearTimeout(timer);
        drain();
      };
      const soon = () => window.setTimeout(() => readEndFirst(), 0);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', soon, { once: true });
      if (document.readyState !== 'complete') window.addEventListener('load', soon, { once: true });

      // Scroll first. Scrolled while a backlog waits (after DOMContentLoaded: before it the paint look reads what is on screen), what is in
      // the window, then a screen the way it scrolls, then a screen the other way, moves ahead of the backlog, so what is about to come into
      // view is read before it does. Only looked for once the scrolling had stopped for 150 ms (a5ba5d88), a post the reader jumped to was
      // covered 230 ms later, one between two rows of the look's points never before the backlog reached it, and a steady scroll showed
      // every name not read yet. The look walks the page from the body down, into what lies across each band only (so its cost is the
      // band's, not the backlog's: the saved Reddit control page keeps about 28,000 single nodes waiting while its parse goes on), in the
      // page's order; each waiting node there is claimed (claimFor: the outermost waiting part around it, CLAIM_MAX elements at most).
      // What is under the paint look's points comes first (a fixed bar whose wrapper has no height, a pane's own rows). Nodes already moved
      // ahead are moved to the front again when in a band (an older look's, passed by a fast scroll, wait behind them). It only claims: a
      // pass reads them (readOrRequeue), at the front of `ahead`.
      // Bands are rows across the whole width of the window (review P1 of 3e63273a): a carousel's parts out of view to the side are not claimed
      // (a box wholly left or right of the window is passed), and a window scrolled sideways gets no band ahead: known, not met on the pages
      // measured.
      const sweepWaits = (x: Node) => waits(x) || aheadRest.has(x) || ahead.has(x);
      const sweepTake = (x: Node) => { take(x); aheadRest.delete(x); ahead.delete(x); };
      const claimNear = (t: Node, out: Node[]) => {
        const n = claimFor(t, body0(), sweepWaits, sweepTake, CLAIM_MAX);
        if (!n) return false;
        out.push(n);
        if (n.nodeType === 1 && (n as Element).getElementsByTagName('*')[BIG_READ]) bigAhead.add(n);
        return true;
      };
      /** The first and last child of `e` to walk for band [top, bottom) (see bandRange); all of them when its children's boxes are not in order. */
      const across = (e: Element, top: number, bottom: number): [ChildNode | null, ChildNode | null] => {
        const ch = e.children;
        const r = bandRange(ch.length, (i) => ch[i]!.getBoundingClientRect(), top, bottom);
        return r ? [r[0] > 0 ? ch[r[0]]! : e.firstChild, r[1] < ch.length - 1 ? ch[r[1]]! : e.lastChild] : [e.firstChild, e.lastChild];
      };
      /**
       * The waiting nodes of the page's part across band [top, bottom) of the window, in the page's order, into `out` while it has `room`;
       * false once the look's time or claims are used up. A box outside the band is passed with what is in it; inside it, what is in it is
       * not measured again. A box with no area: `display: contents` is entered; any other (a collapsed float, a wrapper of height 0 around
       * placed parts, or hidden) has its child elements looked at by their own boxes, one level only (review P2c of 4b12e5fb: passed with
       * all in it, a placed post in it waited for the backlog), its texts not (no place); a child there in the band claims the wrapper
       * when that waits (claimFor: the outermost waiting part around it).
       */
      /** A node to walk: [node, inside the band, under a wrapper with no box (1; 2: one that waits), the node it was found in]. */
      type Walk = [Node, boolean, number, Node | null];
      /**
       * The walk of the window that ran out of its SWEEP_MS, for the next frame (a frame of its own is asked for) and the next looks to go on
       * from, up to SWEEP_FRAMES frames and while the window stays within a screen of where it began; then a walk starts again from the body.
       * Started again from the body each look, a long stretch before the window's own parts (many nodes in the band) was walked again and
       * again and what was in the window never claimed (scroll-look-rand seeds 6 and 84: 0 claims a look, every look).
       */
      let viewWalk: { stack: Walk[]; frames: number; y: number; pane: boolean } | null = null;
      /** A walk met a box in the band whose content scrolls (see sweep: the frames going on with it take the hit tests again). */
      let metPane = false;
      /** Per look: the children on the way from the body down to each element under the look's points, by parent (see walkBand). */
      let onWay = new Map<Node, Set<Node>>();
      const walkBand = (stack: Walk[], body: HTMLElement, top: number, bottom: number, t0: number, room: number, out: Node[]) => {
        const vw = window.innerWidth;
        const again = new Set<Node>();
        for (let k = 0; stack.length; k++) {
          if (out.length >= room || ((k & 31) === 31 && performance.now() - t0 > SWEEP_MS)) return false;
          const [n, inside, under, up] = stack.pop()!;
          // Taken out of the page since it was put on the stack (a walk resumed in a later frame): its parent is walked again instead, once.
          if (!n.isConnected) {
            if (up?.isConnected && !again.has(up)) {
              again.add(up);
              stack.push([up, false, 0, up.parentNode]);
            }
            continue;
          }
          let into = inside;
          if (n.nodeType === 1) {
            const e = n as Element;
            if (e.matches(SWEEP_SKIP)) continue;
            if (!inside) {
              const r = e.getBoundingClientRect();
              if (r.width && r.height) {
                // Outside the band: passed with what is in it, unless its content scrolls (a pane's rows lie past its box, clipped: the
                // rows about to scroll into it were never looked at).
                if ((r.bottom <= top || r.top >= bottom || r.right <= 0 || r.left >= vw) && e.scrollHeight <= e.clientHeight + 1) continue;
                // A pane that scrolls holds more than its box shows: its rows are measured (taken as inside, the rows above and below
                // the pane's view were claimed first, ahead of those in it).
                const scrolls = e.scrollHeight > e.clientHeight + 1;
                if (scrolls) metPane = true;
                into = r.top >= top && r.bottom <= bottom && !scrolls;
              } else if (getComputedStyle(e).display !== 'contents') {
                if (under) continue;
                const w = sweepWaits(e) ? 2 : 1;
                for (let c = e.lastElementChild; c; c = c.previousElementSibling) stack.push([c, false, w, e]);
                continue;
              }
            }
          } else if (n.nodeType === 3 ? under > 0 : n.nodeType !== 11) continue;
          if (n !== body && (under === 2 || sweepWaits(n)) && claimNear(n, out)) continue;
          // A long list across the band edge (a feed of 3,000 posts): only its part across the band, found by halving (a box each try).
          // A part on the way to an element under the look's points is walked too, wherever it is in the list (a pane put in late in a flex
          // body but shown at the top, `order: -1`, breaks the boxes' order: the halving passed it, and only the rows under the points were
          // found while it scrolled).
          let first: ChildNode | null = n.firstChild, last: ChildNode | null = n.lastChild;
          const way = onWay.get(n);
          if (!into && n.nodeType === 1 && (n as Element).childElementCount > SWEEP_LIST) {
            [first, last] = across(n as Element, top, bottom);
            if (way) {
              const walked = new Set<Node>();
              for (let c = last; c; c = c === first ? null : c.previousSibling) walked.add(c);
              for (const c of way) if (!walked.has(c)) stack.push([c, false, 0, n]);
            }
          }
          for (let c = last; c; c = c === first ? null : c.previousSibling) stack.push([c, into, 0, n]);
          const sr = n.nodeType === 1 ? (n as Element).shadowRoot : null;
          if (sr) stack.push([sr, into, 0, n]);
        }
        return true;
      };
      // Which way the window scrolled last (from where it was at the scroll before).
      let down = true;
      let lastY = window.scrollY;
      /**
       * How fast the last scroll went (px/ms, of the window or a pane), so the band ahead reaches as far as it moves before the look after
       * next (the browser pin's pane: about 10 px/ms, 1,000 px between looks, more than the band of a screen).
       */
      let speed = 0, speedAt = 0, speedY = 0;
      let speedOf: EventTarget | null = null;
      let lastLook = -Infinity;
      let sweepTokens = 2 * SWEEP_CLAIMS;
      const sweep = () => {
        const body = document.body;
        // A look that walks nothing ends the walk of the window kept from before (review P2e of 02c01fdd: with nothing waiting it asked for a
        // frame every frame for the life of the scan, its stack kept alive).
        if (!body || (!queue.size && !fresh.size && !newer.size && !aheadRest.size && !ahead.size)) return void (viewWalk = null);
        const t0 = performance.now();
        sweepTokens = Math.min(2 * SWEEP_CLAIMS, sweepTokens + ((t0 - lastLook) * SWEEP_RATE) / 1000);
        lastLook = t0;
        const room = Math.min(SWEEP_CLAIMS, Math.floor(sweepTokens));
        if (room < 1) return void (viewWalk = null);
        const vw = window.innerWidth, vh = window.innerHeight;
        const now: Node[] = [];
        const soon: Node[] = [];
        // What it claimed goes ahead also when it throws partway (taken from the backlog, it must still be read).
        try {
          // The hit tests first (a claim writes nothing: the hit tests and boxes cost one layout), then the window in the page's order, then
          // what is under the points.
          // A walk of the window going on (see viewWalk): no hit tests again (review P1 of 3e63273a: up to SWEEP_FRAMES frames a look, each
          // with its 32 hit tests, about 10 ms on a page of 9,000 posts); what they found is claimed or on the walk's stack already. Unless
          // the walk met a box that scrolls (a pane's rows move under the points while the walk goes on: without them the scroll-first pin's
          // fast pane was covered later, median 1,328 ms against 848).
          const on = viewWalk && viewWalk.frames < SWEEP_FRAMES && Math.abs(window.scrollY - viewWalk.y) < vh ? viewWalk : null;
          const hits = new Set<Element>();
          // Hit tests that throw end the hit tests, not the look: its walks go on, and the throw is raised after them (see step).
          let hitThrew: { e: unknown } | undefined;
          if (!on || on.pane) try {
            for (let y = 0; y < SWEEP_Y; y++) for (let x = 0; x < SWEEP_X; x++) {
              const e = document.elementFromPoint(((x + 0.5) * vw) / SWEEP_X, ((y + 0.5) * vh) / SWEEP_Y);
              if (e && e !== body && e !== document.documentElement) hits.add(e);
            }
          } catch (e) {
            hitThrew = { e };
          }
          onWay = new Map();
          for (const e of hits) {
            for (let c: Node = e, p = c.parentNode; p && c !== body; c = p, p = c.parentNode) {
              const kids = onWay.get(p);
              if (kids?.has(c)) break;
              if (kids) kids.add(c);
              else onWay.set(p, new Set([c]));
            }
          }
          // The walks have SWEEP_MS of their own from here (counted from the look's start, the hit tests used it all on a page of 9,000 posts:
          // 72 of them took 24 ms there, and the walks stopped at their first node).
          const tw = performance.now();
          const stack: Walk[] = on ? on.stack : [[body, false, 0, null]];
          metPane = false;
          let more = walkBand(stack, body, 0, vh, tw, room, now);
          viewWalk = more ? null : { stack, frames: (on?.frames ?? 0) + 1, y: on?.y ?? window.scrollY, pane: (on?.pane ?? false) || metPane };
          for (const e of hits) {
            if (now.length >= room) break;
            if (claimNear(e, now)) continue;
            for (let c = e.firstChild; c && now.length < room; c = c.nextSibling) if (c.nodeType === 3 && sweepWaits(c)) claimNear(c, now);
          }
          // A screen ahead, or as far as the scroll goes in 2.5 looks when it is faster (at most SWEEP_SCREENS screens).
          const far = performance.now() - speedAt < 2 * SCROLL_LOOK_MS ? Math.min(SWEEP_SCREENS * vh, Math.max(vh, 2.5 * speed * SCROLL_LOOK_MS)) : vh;
          for (const [top, bottom] of down ? [[vh, vh + far], [-vh, 0]] : [[-far, 0], [vh, 2 * vh]]) {
            if (!more || !(more = walkBand([[body, false, 0, null]], body, top!, bottom!, tw, room - now.length, soon))) break;
          }
          if (hitThrew) throw hitThrew.e;
        } finally {
          onWay = new Map();
          sweepTokens -= now.length + soon.length;
          if (now.length || soon.length) {
            ahead = new Set([...now, ...soon, ...ahead]);
            scrollFed = true;
            if (timer === undefined) timer = window.setTimeout(drain, 0);
          }
        }
      };
      /** The look for a scroll, in the next animation frame (its hit tests and boxes then cost the frame's own layout). */
      const lookForScroll = () => {
        scrollTimer = undefined;
        if (scanner !== sc || scrollFrame) return;
        scrollFrame = requestAnimationFrame(() => {
          scrollFrame = 0;
          if (scanner !== sc) return;
          // A throw reaches the browser once a scan, and a pass is still asked for (see step).
          step('sweep', sweep, () => afterThrow(true));
          // The window's walk not done: on in the next frame (see viewWalk).
          if (viewWalk && viewWalk.frames < SWEEP_FRAMES && scanner === sc) lookForScroll();
        });
      };
      const onScroll = (e: Event) => {
        if (scanner !== sc) {
          window.removeEventListener('scroll', onScroll, true);
          window.removeEventListener('resize', onScroll);
          return;
        }
        if (e.type === 'scroll' && (e.target === document || e.target === window)) {
          const y = window.scrollY;
          if (y !== lastY) down = y > lastY;
          lastY = y;
        }
        if (e.type === 'scroll') {
          const el = e.target instanceof Element ? e.target : null;
          const y = el ? el.scrollTop : window.scrollY;
          const now = performance.now();
          const same = speedOf === e.target;
          const v = same && now > speedAt && now - speedAt < 500 ? Math.abs(y - speedY) / (now - speedAt) : 0;
          speed = same ? (speed + v) / 2 : v;
          // A pane's way too (its rows come in from below when its top goes down).
          if (el && same && y !== speedY) down = y > speedY;
          speedOf = e.target;
          speedAt = now;
          speedY = y;
        }
        if (document.readyState === 'loading' || scrollTimer !== undefined || scrollFrame) return;
        if (!queue.size && !fresh.size && !newer.size && !aheadRest.size && !ahead.size) return;
        // At most one look a SCROLL_LOOK_MS; one asked for during the wait shows where the scrolling went.
        const wait = lastLook + SCROLL_LOOK_MS - performance.now();
        if (wait <= 0) lookForScroll();
        else scrollTimer = window.setTimeout(lookForScroll, wait);
      };
      // Capture: a pane's own scroll (no bubbling) is seen too. Taken off by stop() (the old scan's look kept alive until the next scroll).
      window.addEventListener('scroll', onScroll, { passive: true, capture: true });
      window.addEventListener('resize', onScroll, { passive: true });
      unlisten = () => {
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onScroll);
        viewWalk = null;
      };
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
