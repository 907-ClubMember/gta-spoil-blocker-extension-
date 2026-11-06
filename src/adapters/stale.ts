// Has a site changed its layout overnight? (2026-11-04) A site rule names the elements that hold one post. After a redesign it may
// match nothing, so the rules that judge a whole post never run, or match one giant wrapper, so one match would cover the whole
// feed. Either way the general rules do better, so the page is read with them instead. Local only: nothing is sent anywhere.
import type { Adapter } from './index';

/** How many things on the page look like separate posts, whatever the site calls them. */
export function postLikeCount(doc: Document): number {
  const articles = doc.querySelectorAll('article, [role="article"]').length;
  if (articles >= 5) return articles;
  // A feed of list items, each holding a sentence or more. Menus and side lists are page furniture, not posts.
  let items = 0;
  doc.querySelectorAll('ul > li, ol > li').forEach((li) => {
    if (li.closest('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]')) return;
    if ((li.textContent ?? '').trim().length >= 40) items++;
  });
  return Math.max(articles, items);
}

/** Characters of text above which one "post" is really the whole feed. */
export const GIANT_POST_CHARS = 8000;

/**
 * Why the site rule looks stale on this page, or null when it looks fine. `none`: the page clearly has posts but the rule
 * finds none. `giant`: the rule finds only one or two "posts" and one of them holds the text of a whole feed.
 */
export function staleRule(site: Pick<Adapter, 'containers'> | null, doc: Document): 'none' | 'giant' | null {
  if (!site?.containers) return null;
  let cards: Element[];
  try {
    cards = [...doc.querySelectorAll(site.containers)];
  } catch {
    return 'none'; // a selector the browser no longer accepts reads like a rule that matches nothing
  }
  const posts = postLikeCount(doc);
  if (posts < 5) return null;
  if (cards.length === 0) return 'none';
  if (cards.length <= 2 && cards.some((c) => (c.textContent ?? '').length > GIANT_POST_CHARS)) return 'giant';
  return null;
}
