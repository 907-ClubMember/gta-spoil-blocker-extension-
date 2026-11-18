// Messages and ports between the extension's parts can be cut at any time: the page goes into the back/forward cache, the worker stops,
// the extension reloads, the tab closes. Chrome then sets chrome.runtime.lastError, and an unread one shows up on the extension's Errors page
// as "Unchecked runtime.lastError". These are expected, so they are read (and dropped) where they can happen.

/** Errors that only mean "the other end is gone": nothing to do about them. */
export const EXPECTED_PORT_ERROR = /port closed|message channel closed|message port closed|back\/forward cache|receiving end does not exist|could not establish connection|extension context invalidated|no tab with id/i;

/** True for an error (or its message) that only means the other end is gone. */
export const isExpectedPortError = (e: unknown): boolean => EXPECTED_PORT_ERROR.test(String((e as { message?: unknown } | null)?.message ?? e));

/** Reads chrome.runtime.lastError, which marks it handled for Chrome, and returns its message (undefined when there was none). */
export function readLastError(): string | undefined {
  try {
    return chrome.runtime?.lastError?.message;
  } catch {
    return undefined;
  }
}
