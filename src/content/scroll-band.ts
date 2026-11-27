// Scroll first (src/entrypoints/content.ts): which children of a long list lie across a band of the window, found by halving, so a look's
// cost is the band's and not the list's (a feed of 3,000 posts).

export type Box = { top: number; bottom: number; width: number; height: number };

/** Children looked at each way for one with a box, in place of one with none. */
export const NEAR_BOX = 8;

/**
 * The first and last of `n` children (their boxes by `raw`, in the page's order) to walk for band [top, bottom): from the child before the
 * first one that ends below `top` to the first one that starts below `bottom`. Null: walk them all (the boxes do not go down the window in
 * the page's order: the first, middle and last one).
 */
export function bandRange(n: number, raw: (i: number) => Box, top: number, bottom: number): [number, number] | null {
  if (n < 1) return null;
  // A child with no box, or one with no area (display: none, a wrapper of height 0), is no row at y = 0 (review P2c of 4b12e5fb: taken for
  // one, it sent the halving the wrong way and the band was missed): the nearest child with a box stands for it, up to NEAR_BOX each way;
  // none there, all are walked.
  let none = false, stood = false;
  const box = (i: number): Box => {
    for (let d = 0; d <= NEAR_BOX; d++) {
      for (const k of d ? [i + d, i - d] : [i]) {
        if (k < 0 || k >= n) continue;
        const b = raw(k);
        if (b.width && b.height) {
          if (d) stood = true;
          return b;
        }
      }
    }
    none = true;
    return raw(i);
  };
  const a = box(0), m = box(n >> 1), z = box(n - 1);
  if (none || !(a.top <= m.top && m.top <= z.top)) return null;
  const find = (y: number, from: number, end: (r: Box) => number) => {
    let lo = from, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (end(box(mid)) <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const i = find(top, 0, (r) => r.bottom);
  const j = find(bottom, i, (r) => r.top);
  if (none) return null;
  // A stand-in a few rows away: the rows between it and the one looked for are walked too.
  const more = stood ? NEAR_BOX : 0;
  let s = Math.max(0, i - 1 - more), e = Math.min(n - 1, j + more);
  // Review P2f probe: a child placed out of the page's order (absolute, fixed, a transform) the halving probed can send it past rows across
  // the band. Checked both ways: a child within NEAR_BOX of an end still across (or past) the band widens the range, and the check goes on.
  const across = (k: number) => { const b = raw(k); return !!(b.width && b.height) && b.bottom > top && b.top < bottom; };
  for (let k = s - 1, left = NEAR_BOX; k >= 0 && left > 0; k--, left--) if (across(k)) { s = k; left = NEAR_BOX + 1; }
  for (let k = e + 1, left = NEAR_BOX; k < n && left > 0; k++, left--) if (across(k)) { e = k; left = NEAR_BOX + 1; }
  // Sent wholly off the band (nothing in the range across it while the list itself reaches across the band): walk them all.
  if (!(a.top < bottom && z.bottom > top)) return [s, e];
  let any = false;
  for (let k = s; k <= e && !any; k++) any = across(k);
  return any ? [s, e] : null;
}
