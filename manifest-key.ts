import { createHash } from 'node:crypto';

/**
 * The public half of the extension's own key, for the GitHub build (wxt.config.ts). With it every unpacked install, in any folder, has
 * the same extension ID, so chrome.storage (settings and lists) carries over when someone loads a new version from a new folder. The
 * private half is not in the repository. The store build has no key (the Web Store gives its own ID and refuses one), nor has the beta build.
 */
export const PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtolFQxZ0nLKAbHjzTvjU3Q74US8NaJchqx3zxBkDQw7qiFnM3DnFjNQNEIjgkr3msi0wwThcs3iLxnrLSstzGVvkjj8gvjH89Sw5/50u2ee1cJqVW2VV9VKVbRwFqv6UMRmo6JeRG2KTIIpfBvN4i80T5WXelmVc1GUYVPiNvLJghXISOxFy03TaYAXSSjGBrd0H+MjkJV4NFtZy1ZqKRrPQzP1kn8bybiWS2DE7KuVs6eC6rZh02r75pfK3KQNy47a7L70Ry6DJvUAYPLnJBUEdrphNUMZNSCy2jQYHZ140gxgKHoYIgfzRRAg+REFwYpCwwh0UrhUjXzsuRAJR/wIDAQAB';

/** The extension ID that PUBLIC_KEY gives an unpacked install. */
export const GITHUB_ID = 'ahaocjmgbhfnfjdgnebcjdkaaloleidj';

/** Chrome's ID for a manifest key: the first 32 hex digits of the SHA-256 of the key, written with the letters a to p. */
export function extensionIdOf(key: string): string {
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
}

/** The manifest key for a build: none for the store zip (GSB_STORE=1, set by scripts/zip-store.ts) or the beta flavour (GSB_BETA=1). */
export function manifestKeyFor(env: Record<string, string | undefined>): string | undefined {
  return env.GSB_STORE === '1' || env.GSB_BETA === '1' ? undefined : PUBLIC_KEY;
}
