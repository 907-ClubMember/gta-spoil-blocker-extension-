import { accountKeys, accountWords } from '../accounts';
import { Matcher } from '../matcher';
import { Scanner } from '../content/scanner';
import { activeList } from '../list/store';
import { CATEGORIES } from '../types';
import { shapeTerms } from '../levels';
import { adapterFor } from '../adapters';
import { BLACKOUT_WORDS, timerNextChange, addressChange, blackoutNextChange, blackoutOn, isSuspended, listVerdict, loadSettings, settingsForUrl, type ListVerdict, type Settings } from '../settings';
import { isSearchPage, offSelector } from '../adapters/parts';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_start',
  async main() {
    const isTop = window === window.top;
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
    /** The Safe/Strict answer the running scan was started with, and the settings it was started from. */
    let verdict: ListVerdict = 'normal';
    let lastSaved: Settings | undefined;
    /** This page was left unread as a search page with that part switched off: moving to or from one starts again. */
    let searchSkipped = false;
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
    /** The address changed without a reload: start again only if that changes the Safe/Strict answer or the search-page skip. */
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
      if (r.restart || skipsSearch(lastSaved, decisionUrl()) !== searchSkipped) void start();
    };
    let scanner: Scanner | null = null;
    /** Items the user showed, kept across restarts for the people who switched "remember reveals" on. */
    const keptReveals = new WeakSet<Element>();
    let countPort: chrome.runtime.Port | null = null;
    const connectCount = () => {
      try {
        countPort = chrome.runtime.connect({ name: 'gsb-count' });
        // The worker was stopped and restarted: connect again and resend, so the popup count is not lost.
        countPort.onDisconnect.addListener(() => {
          countPort = null;
          setTimeout(() => {
            connectCount();
            tellCount();
          }, 500);
        });
      } catch {
        /* extension reloaded */
      }
    };
    const tellCount = () => {
      try {
        countPort?.postMessage({ count: scanner?.count ?? 0, groups: scanner?.groups ?? {} });
      } catch {
        /* the port closed: the disconnect handler connects again */
      }
    };
    connectCount();
    let observer: MutationObserver | null = null;
    let queue = new Set<Node>();
    let timer: number | undefined;
    let pruneTimer: number | undefined;
    /** Wakes the scanner when a pause or the end date passes. */
    let wake: number | undefined;
    /** Counts restarts, so a start overtaken by a newer one (two quick setting changes) gives up. */
    let generation = 0;
    /** Longest one pass may hold up the page, in milliseconds. */
    const BUDGET_MS = 8;
    const LOADING_BUDGET_MS = 40;

    const stop = () => {
      observer?.disconnect();
      observer = null;
      clearTimeout(timer);
      timer = undefined;
      clearTimeout(pruneTimer);
      clearTimeout(wake);
      queue = new Set();
      scanner?.clear();
      scanner = null;
      tellCount();
    };

    const start = async () => {
      stop();
      reported = undefined; // a restart tells the background again, so no stale answer survives
      const mine = ++generation;
      const saved: Settings = await loadSettings();
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
      const s = settingsForUrl(saved, url, host);
      searchSkipped = skipsSearch(saved, url);
      if (!s.enabled) return void report(false);
      const now = Date.now();
      if (isSuspended(s, now)) {
        // Paused, past the end date, or the story is finished: look again when the pause ends.
        const ends = [s.pausedUntil, timerNextChange(s, now) ?? 0].filter((t) => t > now);
        if (ends.length) wake = window.setTimeout(() => void start(), Math.min(Math.min(...ends) - now + 1000, 2 ** 31 - 1));
        return void report(false);
      }
      // A search page counts as one part; when it is switched off nothing on it is read.
      if (searchSkipped) return void report(false);

      const list = await activeList();
      if (mine !== generation) return;
      const site = adapterFor(host, location.pathname);
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
        customWords: [...s.customWords, ...accountWords(s), ...(blackoutOn(s, list.release, Date.now()) ? BLACKOUT_WORDS : [])],
        hintWords: s.hintWords,
      });
      // A tab left open across the blackout's first or last day picks up the change by itself.
      const turn = [blackoutNextChange(s, list.release, Date.now()), timerNextChange(s, Date.now())].filter((t) => t !== undefined).sort((a, b) => a - b)[0];
      if (turn) wake = window.setTimeout(() => void start(), Math.min(turn - Date.now() + 1000, 2 ** 31 - 1));
      const sc = new Scanner(document, matcher, { hideMode: s.hideMode, blur: s.blur, showReason: s.showReason, revealMode: s.revealMode, keepRevealed: s.rememberReveals ? keptReveals : undefined, offParts: offSelector(host, s.parts), pauseVideo: s.pauseVideo, muteAudio: s.muteAudio, thumbsOnly: s.thumbsOnly, hideImages: s.hideImages, hideMediaPosts: s.hideMediaPosts, mediaNearGame: s.mediaNearGame, hideReplies: s.hideReplies, containers: site?.containers, panels: site?.panels, chat: site?.chat, threads: site?.threads, replyAreas: site?.replyAreas, main: site?.main, threadKey: site?.threadKey, accounts, ownPage: site?.ownPage });
      scanner = sc;
      if (!isTop) sc.setOuterContext(outer);
      let hadContext = sc.refreshPageContext();
      report(hadContext);
      if (document.body) sc.scan(document.body);
      sc.quiet();
      tellCount();

      // New content is checked inside the observer callback, which runs before the browser paints it,
      // so a spoiler is hidden before it is ever shown. Work past the budget is put off so pages stay smooth.
      const drain = () => {
        timer = undefined;
        if (scanner !== sc) return; // a newer start has taken over: this pass belongs to a scan that was cleared
        if (isTop && location.href !== seenHref) {
          checkAddress(); // single-page sites change address without a reload
          if (scanner !== sc) return; // the answer changed and start() began again: do not touch the old scan
        }
        const t0 = performance.now();
        const body = document.body;
        if (!body) return;
        const about = sc.refreshPageContext();
        report(about);
        if (about && !hadContext) {
          // The title or heading has just shown the page is about the game: weak terms seen earlier now count.
          hadContext = true;
          queue.clear();
          sc.scan(body);
          return;
        }
        for (const n of queue) {
          queue.delete(n);
          if (n.isConnected && (n === body || body.contains(n))) sc.scan(n);
          // While the page is still loading nobody can interact with it yet, so hiding takes priority.
          if (performance.now() - t0 > (document.readyState === 'loading' ? LOADING_BUDGET_MS : BUDGET_MS)) break;
        }
        if (queue.size) timer = window.setTimeout(drain, 0);
        else tellCount();
        clearTimeout(pruneTimer);
        sc.quiet();
        pruneTimer = window.setTimeout(() => sc.prune(), 1000);
      };

      observer = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type === 'characterData') queue.add(m.target);
          // A reused card (YouTube recycles its tiles) gets a new link address without a new element: spoiler accounts are
          // read from links, so a changed address is checked for those only (watched only while any account is listed).
          else if (m.type === 'attributes') {
            const t = m.target as Element;
            if (m.attributeName === 'href') sc.linkChanged(t);
            else if (t.matches('img, video')) queue.add(t);
          }
          else m.addedNodes.forEach((n) => queue.add(n));
        }
        if (timer === undefined) drain();
      });
      // The page is still loading at this point, so watch the whole document, not just a body that may not exist yet.
      // Lazy-loaded pictures get their address and description after they are added, so those attributes are watched too,
      // and so are link addresses (spoiler accounts).
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['src', 'srcset', 'alt', 'poster', ...(accounts.size ? ['href'] : [])],
      });
    };

    const begin = async () => {
      if (!isTop) {
        send({ type: 'isPageAbout' }, (r) => {
          const about = (r as { about?: boolean } | undefined)?.about === true;
          if (about !== outer) { outer = about; scanner?.setOuterContext(about); }
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

      await start();

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.settings || changes.list)) void start();
      });

      chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
        // The popup talks to the top frame: a frame inside it stays silent so it cannot answer first.
        if (msg?.type === 'getCount') { if (isTop) reply({ count: scanner?.count ?? 0, groups: scanner?.groups ?? {} }); }
        else if (msg?.type === 'askPageAbout') { if (isTop) reply({ about: reported === true }); }
      else if (msg?.type === 'askPageUrl') { if (isTop) reply({ url: location.href }); }
      else if (msg?.type === 'pageUrl') {
        if (!isTop && typeof msg.url === 'string' && msg.url !== tabUrl) { tabUrl = msg.url; checkAddress(); }
      }
      else if (msg?.type === 'pageAbout') {
          if (!isTop) { outer = msg.about === true; scanner?.setOuterContext(outer); }
        }
        else if (msg?.type === 'revealAll') {
          scanner?.revealAll();
          tellCount();
          reply({ count: 0 });
        }
      });
    };

    // A frame that is tiny at start may grow (a lazy comment box): look again once it has a size.
    if (!isTop && !bigEnough()) {
      let ro: ResizeObserver | undefined;
      const retry = () => {
        if (!bigEnough()) return;
        ro?.disconnect();
        window.removeEventListener('load', retry);
        void begin();
      };
      window.addEventListener('load', retry);
      if (typeof ResizeObserver !== 'undefined') (ro = new ResizeObserver(retry)).observe(document.documentElement);
      return;
    }
    await begin();
  },
});
