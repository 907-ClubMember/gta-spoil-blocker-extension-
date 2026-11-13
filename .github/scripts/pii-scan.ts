// Looks for personal details and secrets in the files of this repo. Runs on every push to main and on pull requests
// (.github/workflows/pii-scan.yml), so an edit made on github.com is checked too. Prints the rule and the place only, never the
// matched text, and fails the run on a finding. Only general patterns live here: nothing about the maintainer's own details.
// In the private repo only the files that get published are read (the list is scripts/public-files.js, read as text).
// Usage: node --experimental-strip-types .github/scripts/pii-scan.ts [folder]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export interface PiiFile { path: string; text: string }
export interface PiiFinding { rule: string; path: string; line: number }

// Data files: a pattern check inside them would only find the data.
const SKIP = new Set(['lists/dist/spoilers.json', 'package-lock.json']);
const TEXT = /\.(ts|js|json|md|yml|yaml|html|css|txt|gitignore)$|^LICENSE$|\.gitignore$/;
/** True for the files that are read. */
export const isRead = (path: string): boolean => !SKIP.has(path) && TEXT.test(path);

export const GENERIC_RULES: { rule: string; re: RegExp }[] = [
  { rule: 'home-path', re: /(?:[A-Za-z]:[\\/]+Users[\\/]|\/Users\/|\/home\/[a-z]|~\/work\b|~\/job\b)/ },
  { rule: 'lan-address', re: /\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/ },
  { rule: 'secret', re: /\bghp_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bsk-ant-[A-Za-z0-9_-]{10,}|\bAKIA[0-9A-Z]{16}\b|BEGIN [A-Z ]*PRIVATE KEY|(?:token|secret|api[_-]?key|password)\s*[:=]\s*['"][^'"\s]{16,}['"]/i },
  { rule: 'key-or-header', re: /\bssh-(?:ed25519|rsa) AAAA[0-9A-Za-z+/]{20,}|\bBearer [A-Za-z0-9._~+/-]{20,}|^\s*[A-Z][A-Z0-9_]{3,}=[^\s'"]{20,}\s*$/ },
  { rule: 'ntfy-topic', re: /\bntfy\.sh\/[A-Za-z0-9_-]{6,}/ },
  { rule: 'phone', re: /(?<![\d.])(?:\+\d{1,3}[ .-])?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)/ },
  { rule: 'street-address', re: /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Street|Avenue|Road|Lane|Drive|Boulevard|Blvd)\b/ },
];

// An email is fine only when it is a GitHub noreply address or an obvious placeholder.
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const EMAIL_OK = /@users\.noreply\.github\.com$|^x@y\.com$|@example\.(?:com|org|net)$|@types\//;

/** The general rules, for the lines of one file. Rule and line only. */
export function scanLines(path: string, text: string): PiiFinding[] {
  const out: PiiFinding[] = [];
  text.split('\n').forEach((line, i) => {
    for (const r of GENERIC_RULES) if (r.re.test(line)) out.push({ rule: r.rule, path, line: i + 1 });
    for (const m of line.matchAll(EMAIL)) if (!EMAIL_OK.test(m[0])) out.push({ rule: 'email', path, line: i + 1 });
  });
  return out;
}

export function scanGeneric(files: PiiFile[]): PiiFinding[] {
  return files.filter((f) => isRead(f.path)).flatMap((f) => scanLines(f.path, f.text));
}

/**
 * The paths that go public, read from the text of scripts/public-files.js (never imported or run). That file exists in the private
 * repo only; the public repo has no such file, so every file there is read. Null when the text has no PUBLIC list.
 */
export function publicPrefixes(text: string): string[] | null {
  const m = /export const PUBLIC\s*=\s*\[([\s\S]*?)\n\];/.exec(text);
  if (!m) return null;
  const body = (m[1] ?? '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  const list = [...body.matchAll(/'([^'\n]+)'/g)].map((x) => x[1] ?? '').filter(Boolean);
  return list.length ? list : null;
}

/** Keeps the files that are published: a path equal to an entry or inside an entry that ends with a slash. */
export const onlyPublic = (files: PiiFile[], prefixes: string[]): PiiFile[] =>
  files.filter((f) => prefixes.some((p) => f.path === p || (p.endsWith('/') && f.path.startsWith(p))));

/** Every file under a folder (not .git, node_modules or build folders), paths with forward slashes. */
export function readTree(dir: string): PiiFile[] {
  const files: PiiFile[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (['.git', 'node_modules', '.output', '.wxt', '.claude'].includes(name)) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push({ path: relative(dir, p).split('\\').join('/'), text: readFileSync(p, 'utf8') });
    }
  };
  walk(dir);
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const dir = resolve(process.argv[2] ?? '.');
  let files = readTree(dir);
  // In the private repo only the files that get published are read; the public repo has no public-files.js, so it reads all.
  const listFile = files.find((f) => f.path === 'scripts/public-files.js');
  const prefixes = listFile ? publicPrefixes(listFile.text) : null;
  if (prefixes) files = onlyPublic(files, prefixes);
  const found = scanGeneric(files);
  console.log(`${found.length} finding(s) in ${files.filter((f) => isRead(f.path)).length} files`);
  for (const x of found.slice(0, 40)) console.log(`${x.path}:${x.line} ${x.rule}`);
  process.exit(found.length ? 1 : 0);
}
