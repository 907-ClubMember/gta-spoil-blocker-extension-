// Has a site changed its layout overnight? A site rule names the elements that hold one post. After a redesign it may
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
  try {
    doc.createDocumentFragment().querySelector(site.containers); // checks the whole list without matching anything
  } catch {
    return 'none'; // a selector the browser no longer accepts reads like a rule that matches nothing
  }
  const posts = postLikeCount(doc);
  if (posts < 5) return null;
  // Only "none", "one or two" or "three or more" matter: the rule is looked at one selector at a time, as written, and stops at the third
  // card (0.1.15: Instagram's comment selectors, siblings with :has, held one task about 1 s on a feed of 6000 posts, at 3 s and 10 s).
  const cards = firstCards(doc, site.containers, 3);
  if (cards.size === 0) return 'none';
  if (cards.size <= 2 && [...cards].some((c) => (c.textContent ?? '').length > GIANT_POST_CHARS)) return 'giant';
  return null;
}

/** The elements matching a selector list, one selector of the list at a time, until `enough` are found. */
export function firstCards(doc: Document, list: string, enough: number): Set<Element> {
  const found = new Set<Element>();
  for (const sel of splitSelectors(list)) {
    for (const e of doc.querySelectorAll(sel)) found.add(e);
    if (found.size >= enough) break;
  }
  return found;
}

/** A selector list split at its top-level commas (not those inside brackets, parentheses or quotes). */
export function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(list.slice(from, i).trim()); from = i + 1; }
  }
  out.push(list.slice(from).trim());
  return out.filter(Boolean);
}
