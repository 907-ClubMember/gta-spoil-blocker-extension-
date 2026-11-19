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
     * Nodes that are, hold or land inside a dialog ([role=dialog], dialog, [aria-modal=true]) while a backlog waits (0.1.13), in the order they
     * came: read first in the callbacks (the shared slice) and in each pass (for at most a quarter of its budget, so the backlog keeps the rest).
     */
    let urgent = new Set<Node>();
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
      urgent = new Set();
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
      const sc = new Scanner(document, matcher, { onShadowRoot: (r) => observer?.observe(r, watchOpts), hideMode: s.hideMode, blur: s.blur, showReason: s.showReason, debugWhy: DEBUG_WHY && s.debugWhy, revealMode: s.revealMode, keepRevealed: keptReveals, shownThreads, offParts: offSelector(host, s.parts), pauseVideo: s.pauseVideo, muteAudio: s.muteAudio, pictures: pics.values, gifs: site?.gifs, hideReplies: s.hideReplies, containers: site?.containers, panels: site?.panels, cardCap: site?.cardCap, keepParts: site?.keepParts, subCards: site?.subCards, panelSplit: site?.panelSplit, splitCards: site?.splitCards, chat: site?.chat, chatLines: site?.chatLines, threads: site?.threads, replies: site?.replies, thumbs: site?.thumbs, postMaker: site?.postMaker, allowTrailers: s.allowTrailers, allowStores: s.allowStores, primaryPost: site?.primaryPost, picLinks: site?.picLinks, viewers: site?.viewers, mediaPostPictures: site?.mediaPostPictures, coverParts: site?.coverParts, strongOnly: site?.strongOnly, apart: rule?.apart /* kept when the site rule went stale: its parts use stable hooks, not the post cards */, replyAreas: site?.replyAreas, main: site?.main, threadKey: site?.threadKey, threadEnd: site?.threadEnd, names: site?.names, people: site?.people, bio: site?.bio, keepClear: rule?.keepClear, keepClearNot: rule?.keepClearNot, liveMarks: rule?.liveMarks, playerLayers: rule?.playerLayers, feeds: rule?.feeds, staleTags: rule?.staleTags, embeds: site?.embeds, searchPath: rule?.searchPath, overCards: rule?.overCards, boxArt: rule?.boxArt, ownReplies: site?.ownReplies, ownRepliesOf: site?.ownRepliesOf, ownThreads: site?.ownThreads, siteChrome: site?.siteChrome, commentsInside: site?.commentsInside, slides: site?.slides, threadCards: site?.threadCards, mainBlock: site?.mainBlock, swallowClicks: site?.swallowClicks, accounts, ownPage: site?.ownPage, coverSource: { strictness: strictnessSource(saved, url, host), ownAccounts: accountKeys({ spoilerAccounts: false, blockedAccounts: s.blockedAccounts }), globalPictures: pics.global } });
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
        const t0 = performance.now();
        // While the page is still loading nobody can interact with it yet, so hiding takes priority.
        const budget = document.readyState === 'loading' ? LOADING_BUDGET_MS : BUDGET_MS;
        // Dialog nodes left over from the callbacks first, for at most a quarter of the budget (0.1.13), then the backlog, then the rest.
        let over = false;
        for (const [q, share] of [[urgent, budget / 4], [queue, budget], [fresh, budget]] as const) {
          for (const n of q) {
            q.delete(n);
            read(n, body);
            const used = performance.now() - t0;
            if ((over = used > budget) || used > share) break;
          }
          if (over) break;
        }
        if (urgent.size || queue.size || fresh.size) timer = window.setTimeout(drain, 0);
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
        const into = (n: Node, inDialog: boolean, tail: boolean) => {
          const e = n.nodeType === 1 ? (n as Element) : n.parentElement;
          // Our own go with the backlog, as before 0.1.11.
          if (!waiting || e?.closest(OWN_NODES)) return void queue.add(n);
          queue.delete(n);
          added++;
          if (inDialog || (n.nodeType === 1 && (added <= DIALOG_CHECKS || tail) && (e!.matches(DIALOGS) || e!.querySelector(DIALOGS)))) {
            fresh.delete(n);
            urgent.add(n);
          } else if (!urgent.has(n)) fresh.add(n);
        };
        /** Where a change landed is inside a dialog (looked at only while a backlog waits). */
        const landsInDialog = (t: Node) => {
          if (!waiting) return false;
          const at = t.nodeType === 1 ? (t as Element) : (t.parentElement ?? (t as ShadowRoot).host ?? null);
          return !!at?.closest(DIALOGS);
        };
        for (const m of muts) {
          if (m.type === 'characterData') into(m.target, landsInDialog(m.target), false);
          // A reused card (YouTube recycles its tiles) gets a new link address without a new element: spoiler accounts are
          // read from links, so a changed address is checked for those only (watched only while any account is listed).
          else if (m.type === 'attributes') {
            const t = m.target as Element;
            if (m.attributeName === 'href') sc.linkChanged(t);
            else if (t.matches('img, video')) into(t, landsInDialog(t), false);
          }
          else if (m.addedNodes.length) {
            const inside = landsInDialog(m.target);
            const last = m.addedNodes.length - DIALOG_TAIL;
            m.addedNodes.forEach((n, i) => into(n, inside, i >= last));
          }
        }
        if (!waiting) return drain();
        const small = added > 0 && added <= FRESH_MAX_NODES;
        if (sliceOpen && performance.now() - sliceAt > SLICE_TASK_MS) {
          sliceLeft = FRESH_BUDGET_MS;
          sliceOpen = false;
        }
        if ((!small || !fresh.size) && !urgent.size) return;
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
        if (small && !stop) {
          for (const n of fresh) {
            fresh.delete(n);
            read(n, body);
            if (over()) break;
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
