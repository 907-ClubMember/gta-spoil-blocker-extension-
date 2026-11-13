// The spoiler scan (GitHub Actions, .github/workflows/spoiler-scan.yml). New or edited issues and comments are decided by
// ./intake.ts; pull requests are checked against the published list with the extension's own matcher. The maintainer does not read
// GTA 6 content after release, and no model reads report text, so nothing here shows a word of the input. The log is public:
// counts and reasons only, and an error prints a fixed line, never the failing call's output.
//   Issues: a held issue is moved, whole, to the private quarantine repo (same owner). It is kept, not deleted or closed, and the
//     reporter sees a neutral "received" note first.
//   Comments: a held comment is copied to the quarantine repo, then removed here with the same note. Comments stay open.
//   Owner, members and collaborators are trusted: they are checked before anything else, so no cap or lookup ever touches them.
//   A lookup that fails (rate limit, outage) never leaves something public: the author is then treated as brand new.
//   npx tsx .github/scripts/spoiler-scan.ts   reads the event from $GITHUB_EVENT_PATH and acts with `gh`
//   DRY_RUN=1 ...                              says what it would do, does nothing
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeList } from '../../src/list/index';
import type { Term } from '../../src/types';
import { NOTICE_RECEIVED, decideComment, decideIssue, isTrusted, overCap, type Author, type Counts } from './intake';
import { namesSpoiler, scanTerms } from './names';

export { namesSpoiler, scanTerms };

const NOTICE = 'This was taken out of sight automatically: it named something on the spoiler list. The maintainer does not read GTA 6 '
  + 'details. Please post again without spoilers: describe it without names and give a link (see the README).';

export type Gh = (args: string[], opts?: { input?: string; token?: string }) => string;
export interface Deps {
  terms: Term[]; repo: string; quarantine: string; strict: boolean;
  /** The tower's intake pass has gone quiet: hold everything from outsiders. */
  towerStale?: boolean;
  /** The tower's second pass: look at names (and form shape) only, not at account age, caps or flood counts. */
  namesOnly?: boolean;
  gh: Gh; now: number; log: (s: string) => void;
}

const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(\[bot\])?$/;
/** An app account (the repo's own Actions notices, the token reminder). Only an installed app can be one. */
const isBot = (u: { type?: string } | undefined): boolean => u?.type === 'Bot';
const DAY = 864e5;
// An author we could not look up is treated as brand new, and over no cap: their free text is held, nothing is lost.
const UNKNOWN: Author = { ageDays: 0, priorIssues: 0, priorComments: 0, association: 'NONE' };
const ESTABLISHED: Author = { ageDays: 36500, priorIssues: 99, priorComments: 99, association: 'NONE' };

/** Who wrote it: account age and how much they have written here. Reads only numbers, never text. */
function authorOf(d: Deps, login: string, association: string, forComment: boolean): Author {
  if (d.namesOnly) return { ...ESTABLISHED, association };
  if (!LOGIN.test(login)) return { ...UNKNOWN, association };
  try {
    const created = d.gh(['api', `users/${login}`, '--jq', '.created_at']).trim();
    const total = (q: string) => Number(d.gh(['api', '-X', 'GET', 'search/issues', '-f', `q=repo:${d.repo} ${q}`, '--jq', '.total_count']));
    const out = {
      ageDays: (d.now - Date.parse(created)) / DAY,
      // The thing being judged is already counted: take it off.
      priorIssues: Math.max(0, total(`author:${login} type:issue`) - (forComment ? 0 : 1)),
      priorComments: Math.max(0, total(`commenter:${login}`) - (forComment ? 1 : 0)),
      association,
    };
    if (![out.ageDays, out.priorIssues, out.priorComments].every(Number.isFinite)) throw new Error('bad lookup');
    return out;
  } catch { return { ...UNKNOWN, association }; }
}

function countsFor(d: Deps, login: string): Counts {
  const none: Counts = { authorIssues24h: 0, authorComments24h: 0, allIssues24h: 0, allComments24h: 0 };
  if (d.namesOnly) return none;
  try {
    const since = new Date(d.now - DAY).toISOString().slice(0, 19) + 'Z'; // whole seconds: the search syntax is picky
    const issues = JSON.parse(d.gh(['api', '-X', 'GET', 'search/issues', '-f', `q=repo:${d.repo} is:issue created:>=${since}`, '-f', 'per_page=100', '--jq', '[.items[].user.login]'])) as string[];
    const comments = JSON.parse(d.gh(['api', '-X', 'GET', `repos/${d.repo}/issues/comments`, '-f', `since=${since}`, '-f', 'per_page=100', '--jq', '[.[].user.login]'])) as string[];
    return {
      authorIssues24h: issues.filter((l) => l === login).length,
      authorComments24h: comments.filter((l) => l === login).length,
      allIssues24h: issues.length,
      allComments24h: comments.length,
    };
  } catch { return none; }
}

/**
 * Takes a held issue out of public sight, whole, and keeps it. If the move fails (token lapsed, outage) the text is replaced and the
 * issue locked, but that is only a stopgap: the old text stays in the public edit history. The run goes red, which is the alarm.
 */
function holdIssue(d: Deps, n: number): string {
  try { d.gh(['issue', 'comment', String(n), '--repo', d.repo, '--body', NOTICE_RECEIVED]); } catch { /* the note is a courtesy */ }
  try {
    d.gh(['issue', 'transfer', String(n), d.quarantine, '--repo', d.repo], { token: process.env.QUARANTINE_TOKEN });
    return 'moved to quarantine';
  } catch {
    d.gh(['issue', 'edit', String(n), '--repo', d.repo, '--title', 'Held by the spoiler scan', '--body', NOTICE_RECEIVED]);
    d.gh(['issue', 'lock', String(n), '--repo', d.repo]);
    process.exitCode = 1;
    return 'quarantine move FAILED: text replaced and locked';
  }
}

/** Copies a held comment into the quarantine repo, removes it here and leaves the neutral note. If the copy fails, the text is replaced. */
function holdComment(d: Deps, ev: { comment: { id: number }; issue: { number: number } }, text: string): string {
  try {
    d.gh(['issue', 'create', '--repo', d.quarantine, '--title', `comment held from #${ev.issue.number}`, '--body-file', '-'], { input: text, token: process.env.QUARANTINE_TOKEN });
  } catch {
    d.gh(['api', '-X', 'PATCH', `repos/${d.repo}/issues/comments/${ev.comment.id}`, '-f', `body=${NOTICE_RECEIVED}`]);
    process.exitCode = 1;
    return ' (quarantine copy FAILED: text replaced)';
  }
  d.gh(['api', '-X', 'DELETE', `repos/${d.repo}/issues/comments/${ev.comment.id}`]);
  d.gh(['issue', 'comment', String(ev.issue.number), '--repo', d.repo, '--body', NOTICE_RECEIVED]);
  return '';
}

/** The event handler. Returns nothing; says what it did in `d.log`, in counts only. */
export function handleEvent(ev: any, d: Deps): void {
  const { gh, repo, terms } = d;
  // A pull request review: a submitted review cannot be deleted, so its text is replaced.
  if (ev.review) {
    if (!namesSpoiler([ev.review.body ?? ''], terms)) return d.log('scan: review clean');
    gh(['api', '-X', 'PUT', `repos/${repo}/pulls/${ev.pull_request.number}/reviews/${ev.review.id}`, '-f', `body=${NOTICE}`]);
    return d.log('scan: 1 review hidden');
  }
  if (ev.comment) {
    // A comment on a pull request, or on its changed lines: removed on a match, as before.
    if (!ev.issue || ev.issue.pull_request) {
      if (!namesSpoiler([ev.comment.body ?? ''], terms)) return d.log('scan: comment clean');
      if (!ev.issue) {
        gh(['api', '-X', 'DELETE', `repos/${repo}/pulls/comments/${ev.comment.id}`]);
        gh(['pr', 'comment', String(ev.pull_request.number), '--repo', repo, '--body', `A review comment was removed. ${NOTICE}`]);
        return d.log('scan: 1 review comment removed');
      }
      gh(['api', '-X', 'DELETE', `repos/${repo}/issues/comments/${ev.comment.id}`]);
      gh(['issue', 'comment', String(ev.issue.number), '--repo', repo, '--body', `A comment was removed. ${NOTICE}`]);
      return d.log('scan: 1 comment removed');
    }
    // A comment on an issue: held, kept, never just deleted. The owner, collaborators and bots (the repo's own notices and
    // reminders) come first: nothing is looked up for them.
    const assoc = ev.comment.author_association ?? 'NONE';
    if (isTrusted(assoc) || isBot(ev.comment.user)) return d.log('scan: comment clean');
    const login = ev.comment.user?.login ?? '';
    const author = authorOf(d, login, assoc, true);
    const cap = overCap(countsFor(d, login));
    const dec = decideComment({ body: ev.comment.body ?? '', author, terms, strict: d.strict });
    const stale = !!d.towerStale;
    if (dec.action === 'clean' && cap === 'ok' && !stale) return d.log('scan: comment clean');
    if (dec.action === 'clean' && !stale) {
      // Over a cap: spam, hidden from view but kept.
      gh(['api', 'graphql', '-f', 'query=mutation($id:ID!){minimizeComment(input:{subjectId:$id,classifier:SPAM}){clientMutationId}}', '-f', `id=${ev.comment.node_id}`]);
      return d.log(`scan: 1 comment minimized (${cap})`);
    }
    const why = dec.action === 'clean' ? 'tower-stale' : dec.reason;
    return d.log(`scan: 1 comment held (${why})${holdComment(d, ev, ev.comment.body ?? '')}`);
  }
  const pr = ev.pull_request;
  if (pr) {
    // Only the changed lines, read through the API: the pull request's own code is never run.
    const files = JSON.parse(gh(['api', `repos/${repo}/pulls/${pr.number}/files`, '--paginate', '--jq', '[.[] | {patch}]']) || '[]') as { patch?: string }[];
    const added = files.flatMap((f) => (f.patch ?? '').split('\n').filter((l) => l.startsWith('+')).map((l) => l.slice(1)));
    const inText = namesSpoiler([pr.title, pr.body ?? ''], terms);
    const inDiff = namesSpoiler(added, terms);
    if (!inText && !inDiff) return d.log('scan: pull request clean');
    if (inText) gh(['pr', 'edit', String(pr.number), '--repo', repo, '--title', 'Hidden by the spoiler scan', '--body', NOTICE]);
    gh(['pr', 'close', String(pr.number), '--repo', repo, '--comment', NOTICE]);
    d.log(`scan: pull request closed (text ${inText ? 1 : 0}, changed lines ${inDiff ? 1 : 0})`);
    process.exitCode = 1;
    return;
  }
  const issue = ev.issue;
  if (!issue) return;
  const assoc = issue.author_association ?? 'NONE';
  if (isTrusted(assoc) || isBot(issue.user)) return d.log('scan: issue clean');
  const login = issue.user?.login ?? '';
  const author = authorOf(d, login, assoc, false);
  const cap = overCap(countsFor(d, login));
  const dec = decideIssue({ title: issue.title ?? '', body: issue.body ?? '', labels: (issue.labels ?? []).map((l: { name: string }) => l.name), author, terms, strict: d.strict });
  const stale = !!d.towerStale;
  // The second pass is names-only: it holds a listed name and nothing else. Form shape, age and the like were the scan's call, and
  // holding an already-handled placeholder again would post another note every pass.
  if (d.namesOnly && !(dec.action === 'quarantine' && dec.reason === 'name')) return d.log('scan: issue clean');
  if (cap === 'paused' || dec.action === 'quarantine' || stale) {
    if (cap === 'paused') gh(['api', '-X', 'POST', `repos/${repo}/issues/${issue.number}/labels`, '-f', 'labels[]=intake-paused']);
    return d.log(`scan: 1 issue held (${cap === 'paused' ? 'paused' : dec.action === 'quarantine' ? dec.reason : 'tower-stale'}): ${holdIssue(d, issue.number)}`);
  }
  if (cap === 'author-limit') {
    gh(['api', '-X', 'POST', `repos/${repo}/issues/${issue.number}/labels`, '-f', 'labels[]=limit']);
    gh(['issue', 'close', String(issue.number), '--repo', repo, '--comment', 'Too many reports from one account today. Please wait a day.']);
    return d.log('scan: 1 issue over the per-author limit, closed');
  }
  d.log('scan: issue clean');
}

/**
 * Is the tower's intake pass quiet for over 2 hours? `stamp` is the ISO time the tower wrote into its heartbeat issue in the
 * quarantine repo (the tower edits it every pass; the scan's token can already read that repo). Only when the repo variable
 * INTAKE_TOWER_REQUIRED is 1 (turned on once the pass runs); a missing, unreadable or future stamp counts as quiet: failing
 * closed holds reports, it never loses them.
 */
export function towerStale(stamp: string | undefined, required: boolean, now: number): boolean {
  if (!required) return false;
  const age = now - Date.parse((stamp ?? '').trim());
  return !(age >= 0 && age < 2 * 3600e3);
}

/** The tower's stamp: the body of its heartbeat issue in the quarantine repo (number in the INTAKE_HEARTBEAT_ISSUE variable). */
export function heartbeatStamp(gh: Gh, quarantine: string, env: Record<string, string | undefined>): string | undefined {
  const n = env.INTAKE_HEARTBEAT_ISSUE ?? '';
  if (env.INTAKE_TOWER_REQUIRED !== '1' || !/^\d{1,9}$/.test(n)) return undefined;
  try { return gh(['api', `repos/${quarantine}/issues/${n}`, '--jq', '.body'], { token: env.QUARANTINE_TOKEN }); } catch { return undefined; }
}

function main() {
  const root = join(import.meta.dirname, '../..');
  const dry = process.env.DRY_RUN === '1';
  const repo = process.env.GITHUB_REPOSITORY!;
  const quarantine = process.env.QUARANTINE_REPO || `${repo.split('/')[0]}/gta-spoiler-quarantine`;
  const gh: Gh = (a, o) => {
    if (dry) { console.log(`would run: gh ${a[0]} ${a[1] ?? ''} ...`); return a[0] === 'api' ? '[]' : ''; }
    return execFileSync('gh', a, { encoding: 'utf8', input: o?.input, env: o?.token ? { ...process.env, GH_TOKEN: o.token } : process.env, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
  };
  try {
    handleEvent(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8')), {
      // SCAN_LIST: another list file (tests and dry runs); the workflow uses the published list.
      terms: decodeList(readFileSync(process.env.SCAN_LIST ?? join(root, 'lists/dist/spoilers.json'), 'utf8'), 0).terms,
      repo, quarantine,
      strict: process.env.INTAKE_STRICT === '1',
      towerStale: towerStale(heartbeatStamp(gh, quarantine, process.env), process.env.INTAKE_TOWER_REQUIRED === '1', Date.now()),
      gh, now: Date.now(), log: console.log,
    });
  } catch {
    // The log is public and a failing call's output can hold report text: a fixed line only.
    console.log('scan: FAILED (details withheld)');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop()!)) main();
