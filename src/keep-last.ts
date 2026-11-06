/** Whether this script can still reach the extension. After a store update, scripts already running in open tabs cannot. */
export function extensionAlive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

/**
 * A loader that remembers its last answer read while the extension was reachable, and gives that back once it is not.
 * Without it, a tab left open across an update would restart with the default settings and the built-in list (markers only),
 * which hides almost nothing. The tab keeps hiding as before until it is reloaded.
 */
export function keepLast<T>(load: () => Promise<T>, alive: () => boolean = extensionAlive): () => Promise<T> {
  let last: { value: T } | undefined;
  return async () => {
    if (alive()) {
      const value = await load();
      // Cut off while reading: the answer is a fallback, not the real one.
      if (alive()) {
        last = { value };
        return value;
      }
    }
    return last ? last.value : load();
  };
}
