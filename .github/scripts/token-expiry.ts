// The quarantine token (a fine-grained key, Issues read/write on this repo and the quarantine repo only) expires. This warns 14 days
// ahead so reports are not silently left public: with no valid token a held issue cannot be moved (the scan then replaces its text).
//   QUARANTINE_TOKEN_EXPIRES=YYYY-MM-DD npx tsx .github/scripts/token-expiry.ts      exit 2 and a line when 14 days or fewer are left
export const WARN_DAYS = 14;

/** Whole days from now to the end of the expiry day (UTC); null for anything that is not a date. */
export function daysLeft(expires: string | undefined, now: number): number | null {
  if (!expires || !/^\d{4}-\d{2}-\d{2}$/.test(expires.trim())) return null;
  const end = Date.parse(`${expires.trim()}T23:59:59Z`);
  return Number.isNaN(end) ? null : Math.floor((end - now) / 864e5);
}

/** The weekly counts line, and whether it needs attention. */
export function tokenLine(expires: string | undefined, now: number): { line: string; warn: boolean } {
  // Never set: the intake is not switched on yet (Issues are off), so there is no token to expire and nothing to warn about.
  if (!(expires ?? '').trim()) return { line: 'quarantine token: not configured (intake is off)', warn: false };
  const d = daysLeft(expires, now);
  if (d === null) return { line: 'quarantine token: expiry date is not a date (fix the QUARANTINE_TOKEN_EXPIRES repo variable)', warn: true };
  if (d < 0) return { line: `quarantine token: EXPIRED ${-d} days ago`, warn: true };
  return { line: `quarantine token: ${d} days left`, warn: d <= WARN_DAYS };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop()!)) {
  const r = tokenLine(process.env.QUARANTINE_TOKEN_EXPIRES, Date.now());
  console.log(r.line);
  if (r.warn) process.exitCode = 2;
}
