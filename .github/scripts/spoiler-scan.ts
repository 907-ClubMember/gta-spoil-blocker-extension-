// The spoiler scan (GitHub Actions, .github/workflows/spoiler-scan.yml): new or edited issues, comments and pull requests are
// checked against the published list with the extension's own matcher. A match is taken out of sight automatically, because the
// maintainer does not read GTA 6 content after release. The log is public, so it shows counts only, never a matched word.
//   npx tsx .github/scripts/spoiler-scan.ts            reads the event from $GITHUB_EVENT_PATH and acts with `gh`
//   DRY_RUN=1 ...                                      says what it would do, does nothing
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeList } from '../../src/list/index';
import { Matcher } from '../../src/matcher/index';
import { CATEGORIES, type Term } from '../../src/types';

/**
 * Names that count: those that hide everywhere. A repo about the game always "mentions the game", and this step closes issues and
 * deletes comments with no one watching, so a name that needs a mention, which can be everyday words ("What Happened"), does not count.
 */
export function scanTerms(terms: Term[]): Term[] {
  return terms.filter((t) => t.s === 'strong');
}

const FORM_HEADINGS = /^### (What happened\?|Link to the page|What were you protecting\?.*|Strictness.*|Anything else.*)$/gm;

/** Does any of these texts name something on the list? */
export function namesSpoiler(texts: string[], terms: Term[]): boolean {
  const m = new Matcher({ terms: scanTerms(terms), strictness: 'medium', categories: new Set(CATEGORIES), allowWords: [], customWords: [] });
  // The report form's own headings are not the writer's words; any other heading is.
  return texts.some((t) => !!t && m.inspect(t.replace(FORM_HEADINGS, '')).strong.size > 0);
}

const NOTICE = 'This was taken out of sight automatically: it named something on the spoiler list. The maintainer does not read GTA 6 '
  + 'details. Please post again without spoilers: describe it without names and give a link (see the README).';

function main() {
  const root = join(import.meta.dirname, '../..');
  // SCAN_LIST: another list file (tests and dry runs); the workflow uses the published list.
  const terms = decodeList(readFileSync(process.env.SCAN_LIST ?? join(root, 'lists/dist/spoilers.json'), 'utf8'), 0).terms;
  const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'));
  const repo = process.env.GITHUB_REPOSITORY!;
  const dry = process.env.DRY_RUN === '1';
  const gh = (...a: string[]) => (dry ? (console.log(`would run: gh ${a[0]} ${a[1] ?? ''} ...`), '') : execFileSync('gh', a, { encoding: 'utf8' }));
  // A pull request review: a submitted review cannot be deleted, so its text is replaced.
  if (ev.review) {
    if (!namesSpoiler([ev.review.body ?? ''], terms)) return console.log('scan: review clean');
    gh('api', '-X', 'PUT', `repos/${repo}/pulls/${ev.pull_request.number}/reviews/${ev.review.id}`, '-f', `body=${NOTICE}`);
    return console.log('scan: 1 review hidden');
  }
  if (ev.comment) {
    if (!namesSpoiler([ev.comment.body ?? ''], terms)) return console.log('scan: comment clean');
    // A comment on a pull request's changed lines lives under the pull request, not the issue.
    if (!ev.issue && ev.pull_request) {
      gh('api', '-X', 'DELETE', `repos/${repo}/pulls/comments/${ev.comment.id}`);
      gh('pr', 'comment', String(ev.pull_request.number), '--repo', repo, '--body', `A review comment was removed. ${NOTICE}`);
      return console.log('scan: 1 review comment removed');
    }
    gh('api', '-X', 'DELETE', `repos/${repo}/issues/comments/${ev.comment.id}`);
    gh('issue', 'comment', String(ev.issue.number), '--repo', repo, '--body', `A comment was removed. ${NOTICE}`);
    return console.log('scan: 1 comment removed');
  }
  const pr = ev.pull_request;
  if (pr) {
    // Only the changed lines, read through the API: the pull request's own code is never run.
    const files = dry ? [] : (JSON.parse(gh('api', `repos/${repo}/pulls/${pr.number}/files`, '--paginate')) as { patch?: string }[]);
    const added = files.flatMap((f) => (f.patch ?? '').split('\n').filter((l) => l.startsWith('+')).map((l) => l.slice(1)));
    const inText = namesSpoiler([pr.title, pr.body ?? ''], terms);
    const inDiff = namesSpoiler(added, terms);
    if (!inText && !inDiff) return console.log('scan: pull request clean');
    if (inText) gh('pr', 'edit', String(pr.number), '--repo', repo, '--title', 'Hidden by the spoiler scan', '--body', NOTICE);
    gh('pr', 'close', String(pr.number), '--repo', repo, '--comment', NOTICE);
    console.log(`scan: pull request closed (text ${inText ? 1 : 0}, changed lines ${inDiff ? 1 : 0})`);
    process.exitCode = 1;
    return;
  }
  const issue = ev.issue;
  if (issue) {
    if (!namesSpoiler([issue.title, issue.body ?? ''], terms)) return console.log('scan: issue clean');
    gh('issue', 'edit', String(issue.number), '--repo', repo, '--title', 'Hidden by the spoiler scan', '--body', NOTICE);
    gh('issue', 'close', String(issue.number), '--repo', repo);
    gh('issue', 'lock', String(issue.number), '--repo', repo);
    console.log('scan: 1 issue hidden, closed and locked');
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop()!)) main();
