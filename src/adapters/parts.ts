import { PAGE_PARTS, hostMatches, type PagePart } from '../settings';

/**
 * Where each part of a page lives, for the per-part switches. A part that is switched off is left unread:
 * nothing inside it is hidden. Generic selectors apply everywhere; the site ones add to them.
 * Sites change their markup; a selector that stops matching just means that switch does nothing there.
 */
const GENERIC: Record<PagePart, string> = {
  titles: 'h1, h2, h3, [role="heading"]',
  comments: '#comments, .comments, [id^="comment-"], [data-testid="comments"]',
  search: '',
  sidebar: 'aside, [role="complementary"]',
  news: '[itemtype*="Article"], .article-body, .entry-content, .post-content',
};

const SITE: { hosts: string[]; parts: Partial<Record<PagePart, string>> }[] = [
  {
    hosts: ['youtube.com'],
    parts: {
      titles: '#video-title, yt-formatted-string#video-title, ytd-thumbnail, yt-lockup-metadata-view-model',
      comments: 'ytd-comments, ytd-comment-thread-renderer, ytd-comment-view-model',
      sidebar: '#related, ytd-watch-next-secondary-results-renderer, ytd-guide-renderer, #guide',
    },
  },
  {
    hosts: ['reddit.com'],
    parts: {
      titles: 'shreddit-post [slot="title"], a[slot="title"], .thing .title',
      comments: 'shreddit-comment-tree, shreddit-comment, .commentarea, .thing.comment',
      sidebar: '#right-sidebar-container, .side',
    },
  },
  { hosts: ['steamcommunity.com'], parts: { comments: '.commentthread_comment, .forum_op, .commentthread_area' } },
  { hosts: ['x.com', 'twitter.com'], parts: { sidebar: '[data-testid="sidebarColumn"]', titles: '[data-testid="trend"]' } },
];

/** Pages whose address says they are a search. A bare number in `s=` is a share tag (X's `?s=20`), not a search. */
export function isSearchPage(pathname: string, search: string): boolean {
  return /\/(search|results|find)\b/i.test(pathname) || /[?&](q|query|search_query)=/i.test(search) || /[?&]s=(?!\d*(&|$))/i.test(search);
}

/** One selector for everything on this site that belongs to a part that is switched off, or null when none are. */
export function offSelector(host: string, on: Record<PagePart, boolean>): string | null {
  const out: string[] = [];
  for (const part of PAGE_PARTS) {
    if (on[part]) continue;
    if (GENERIC[part]) out.push(GENERIC[part]);
    for (const s of SITE) if (s.parts[part] && hostMatches(host, s.hosts)) out.push(s.parts[part]!);
  }
  return out.length ? out.join(', ') : null;
}
