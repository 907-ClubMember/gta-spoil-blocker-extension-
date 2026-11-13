// Version numbers as the extension shows them: "x.y.z", whole numbers only. Pure helpers (no browser calls), tested on their own.

/** "1.2.3" as three numbers; null for anything that is not exactly that (a longer or shorter one, a suffix, letters). */
export function parseVersion(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Is `latest` a higher version than `current`? False when either is not a plain x.y.z (nothing is said then). */
export function isNewerVersion(latest: unknown, current: unknown): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  return false;
}

/** The key of a version in extension-text.json's releaseNotes: 0.1.3 -> v0_1_3. */
export const releaseKey = (version: string): string => `v${version.replace(/\./g, '_')}`;

/** How this copy was installed: a folder loaded by hand ("development"), or from the store (everything else). */
export type InstallKind = 'store' | 'unpacked';
export const installKindOf = (installType: string | undefined): InstallKind => (installType === 'development' ? 'unpacked' : 'store');

/** The "How to update" steps are for a folder loaded by hand: a store install updates itself. */
export const showUpdateSteps = (kind: InstallKind): boolean => kind === 'unpacked';

/** Where the popup shows the note: set on an update, cleared when the person presses "Got it". */
export interface WhatsNew { from: string; to: string }

/** The note to show: only for the version that is running, and only when the release notes have an entry for it. */
export function noteToShow(stored: unknown, running: string, notes: Record<string, readonly string[] | undefined>): readonly string[] | null {
  const w = stored as Partial<WhatsNew> | null | undefined;
  if (!w || typeof w.to !== 'string' || w.to !== running) return null;
  const items = notes[releaseKey(running)];
  return items && items.length ? items : null;
}
