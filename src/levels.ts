import { PROTECT_THRESHOLD, presetKindModes, type Settings } from './settings';
import { KIND_BASE_LEVEL, kindOf, levelOf, type Term } from './types';

/** The settings that shape the list before matching. */
export type ShapeSettings = Pick<Settings, 'protect' | 'kindModes' | 'categoryModes' | 'allowTrailers'> & Partial<Pick<Settings, 'rareNames' | 'customBase'>>;

/**
 * Shapes the list by what the user chose to protect, so the matcher and scanner need no idea of levels.
 * - Show: the entry is dropped, unless it only marks a page as being about the game (level 0), which it keeps doing.
 * - Only with game mention: an entry that blocks alone is made to count only with the game's name.
 * - Hide: left as it is.
 * Under a preset, an entry the job raised to the preset's level is hidden even if its kind is set to Show.
 * Custom keeps that for every row still set as the preset it came from (`customBase`) sets it; a row the user changed is final.
 * A rare made-up name (`r`) follows its own row instead of its kind's, and stays a marker even when set to Show.
 * A kind that only marks pages (level 0, a brand) stays a marker under Show even when the job raised it.
 */
export function shapeTerms(terms: Term[], s: ShapeSettings): Term[] {
  const base = s.protect === 'custom' ? (s.customBase ?? 'story') : s.protect;
  const threshold = PROTECT_THRESHOLD[base];
  const presetRow = presetKindModes(base);
  const out: Term[] = [];
  for (const t of terms) {
    if (s.allowTrailers && t.tr) continue;
    const level = levelOf(t);
    const kind = kindOf(t);
    // The raise lifts a name under a preset, and in Custom while its kind's row is untouched.
    const raised = !!t.l && level >= threshold && (s.protect !== 'custom' || s.kindModes[kind] === presetRow[kind]);
    if (t.r) {
      let rare = s.rareNames ?? 'mention';
      // A name the job raised to the preset's level gives the story away: it hides as the preset says.
      if (rare !== 'always' && raised) rare = 'always';
      if (rare === 'always' && s.categoryModes[t.c] === 'mention') rare = 'mention';
      out.push({ ...t, s: rare === 'off' ? 'context' : rare === 'always' ? 'strong' : 'weak' });
      continue;
    }
    // A story place left off by a preset: its name may show, but what happens there may not. As a marker, it hides only beside a
    // spoiler word ("everyone dies at <place>"). Not for an everyday-word name, nor when someone set the row to Show themselves.
    if (kind === 'storyplace' && !t.o && s.kindModes[kind] === 'off' && presetRow[kind] === 'off' && level < threshold) {
      out.push({ ...t, s: 'context' });
      continue;
    }
    let mode = s.kindModes[kind];
    if (mode === 'off' && (s.protect !== 'custom' || mode === presetRow[kind]) && level >= threshold) mode = 'always';
    if (mode === 'off') {
      if (level === 0 || KIND_BASE_LEVEL[kind] === 0 || t.s === 'context') out.push(t.s === 'context' ? t : { ...t, s: 'context' });
      continue;
    }
    // The older per-category switch still applies on top.
    const weakened = (mode === 'mention' || s.categoryModes[t.c] === 'mention') && t.s === 'strong';
    out.push(weakened ? { ...t, s: 'weak' } : t);
  }
  return out;
}
