// Remove mode leaves nothing behind. When it empties a whole area (every post of a grid, a feed or a list), the page would show an empty
// space and no hint why: one line stands in its place, "Spoiler Blocker removed N items here · Show" (0.1.10, the manager's call after an
// Instagram search for the game came up empty). Per area, never per item; an area with any post still shown gets no line.
// A press shows that area's posts for this visit only (nothing is kept: a reload, or the page moving to another address, removes them again).

/** One area's line: there while its posts are removed; gone once the person shows them. */
export type AreaState = 'removed' | 'shownThisVisit';
export type AreaEvent = 'press';
/** Every move an area can make. Anything not listed is refused (a shown area is not removed again in this visit). */
export const AREA_STEPS: Record<AreaState, Partial<Record<AreaEvent, AreaState>>> = {
  removed: { press: 'shownThisVisit' },
  shownThisVisit: {},
};
export const areaStep = (s: AreaState, e: AreaEvent): AreaState | null => AREA_STEPS[s][e] ?? null;

/** The posts directly in `root`: matches of `units` inside it that are not inside another match inside it (one search, no per-post match). */
export function topUnits(root: Element, units: string): Element[] {
  const all = [...root.querySelectorAll(units)];
  const set = new Set(all);
  return all.filter((u) => {
    for (let p = u.parentElement; p && p !== root; p = p.parentElement) if (set.has(p)) return false;
    return true;
  });
}

/**
 * Finds the areas of removed posts for one pass. Each block's posts are searched once per pass (`queries` counts the searches), so a pass
 * over many removed posts of one feed costs a few searches, not one per post and block (0.1.10 review: a 400-post feed stalled).
 */
export class AreaFinder {
  queries = 0;
  private memo = new Map<Element, Element[]>();
  constructor(private units: string, private removed: (u: Element) => boolean, private stop: (e: Element) => boolean) {}

  private top(p: Element): Element[] {
    let r = this.memo.get(p);
    if (!r) { r = topUnits(p, this.units); this.queries++; this.memo.set(p, r); }
    return r;
  }

  /**
   * The area a removed post is in: up from the post while every post under the block is removed. The area is the lowest block holding all
   * of the highest such block's posts (a grid, not each of its rows). Null when that is fewer than two posts, when the block above holds a
   * shown post of the same kind (part of a bigger list: a grid with some tiles shown, never a line for its removed part), or when nothing
   * below `stop` (the page itself) holds two.
   */
  area(unit: Element): { area: Element; units: Element[] } | null {
    let best: { area: Element; units: Element[] } = { area: unit, units: [unit] };
    let above: Element | null = null;
    for (let p = unit.parentElement; p && !this.stop(p); p = p.parentElement) {
      const all = this.top(p);
      if (!all.every(this.removed)) { above = p; break; }
      if (all.length > best.units.length) best = { area: p, units: all };
    }
    if (best.units.length < 2) return null;
    // A shown post of the same kind (tag) in the block above: the removed ones are part of a bigger list, not an area of their own.
    if (above && this.top(above).some((u) => !this.removed(u) && u.tagName === unit.tagName)) return null;
    return best;
  }
}

/** One-off use of AreaFinder (tests, a single post). */
export function emptiedArea(unit: Element, units: string, removed: (u: Element) => boolean, stop: (e: Element) => boolean): { area: Element; units: Element[] } | null {
  return new AreaFinder(units, removed, stop).area(unit);
}
