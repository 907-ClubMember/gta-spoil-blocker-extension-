// The long-lived port a content script keeps to the background, so the popup and the badge know how much a page covers.
// A page going into the back/forward cache closes it (the other end sees a disconnect with lastError "The page keeping the extension port is
// moved into back/forward cache, so the message channel is closed"). So: the disconnect reads lastError, the page closes the port itself on
// pagehide (persisted) and does not reconnect while frozen, and on pageshow (persisted) it connects again and resends the count.

export interface PortLike {
  postMessage(message: unknown): void;
  disconnect(): void;
  onDisconnect: { addListener(cb: () => void): void };
}

export interface CountPortDeps {
  connect: () => PortLike;
  /** The message to send: the page's count. */
  payload: () => unknown;
  /** Reads chrome.runtime.lastError (see last-error.ts). */
  readLastError: () => unknown;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  addPageListener: (type: 'pagehide' | 'pageshow', fn: (e: { persisted: boolean }) => void) => void;
}

export interface CountPort {
  connect(): void;
  /** Sends the count; a closed port is not an error (the disconnect handler connects again). */
  tell(): void;
}

export const RECONNECT_MS = 500;

export function createCountPort(deps: CountPortDeps): CountPort {
  let port: PortLike | null = null;
  let timer: unknown;
  /** The page is in the back/forward cache (or going there): no reconnecting until it is shown again. */
  let frozen = false;
  const cancel = () => {
    if (timer !== undefined) deps.clearTimeout(timer);
    timer = undefined;
  };
  const tell = () => {
    try {
      port?.postMessage(deps.payload());
    } catch {
      /* the port closed: the disconnect handler connects again */
    }
  };
  const connect = () => {
    if (frozen) return;
    try {
      const p = deps.connect();
      port = p;
      // The worker was stopped and restarted: connect again and resend, so the popup count is not lost.
      p.onDisconnect.addListener(() => {
        deps.readLastError(); // an expected cut (cache, worker stop): read, so it is not reported as unchecked
        if (port === p) port = null;
        if (frozen) return;
        cancel();
        timer = deps.setTimeout(() => {
          timer = undefined;
          connect();
          tell();
        }, RECONNECT_MS);
      });
    } catch {
      /* extension reloaded */
    }
  };
  deps.addPageListener('pagehide', (e) => {
    if (!e.persisted) return; // a page that is really leaving needs nothing
    frozen = true;
    cancel();
    const p = port;
    port = null;
    try {
      p?.disconnect();
    } catch {
      /* already closed */
    }
  });
  deps.addPageListener('pageshow', (e) => {
    if (!e.persisted) return;
    frozen = false;
    connect();
    tell();
  });
  return { connect, tell };
}
