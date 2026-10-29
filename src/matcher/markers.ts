/** Ways people write a game's name, made from its full title. Pure: no imports. */

const ROMAN = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];
const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/**
 * "Zorb Test Game IX" or "Zorb Test Game 9" gives the full title and the initials, each with the
 * number as roman numeral, digits and (1 to 10) word. Never the bare initials or bare title: too broad.
 * A title with no trailing number gives just the lower-cased title.
 */
export function markerForms(title: string): string[] {
  const clean = title.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!clean) return [];
  const parts = clean.split(' ');
  const last = parts[parts.length - 1]!;
  let n = 0;
  if (/^\d{1,4}$/.test(last)) n = Number(last);
  else if (ROMAN.indexOf(last) > 0 && /^[IVX]+$/.test(title.trim().split(/\s+/).pop()!)) n = ROMAN.indexOf(last);
  if (parts.length < 2 || n < 1) return [clean];

  const base = parts.slice(0, -1).join(' ');
  const forms = [String(n)];
  if (n <= 20) forms.push(ROMAN[n]!);
  if (n <= 10) forms.push(WORDS[n]!);
  const out = new Set<string>();
  for (const f of forms) out.add(`${base} ${f}`);

  const words = parts.slice(0, -1).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  const initials = words.map((w) => [...w][0]).join('');
  if (words.length >= 2) {
    for (const f of forms) {
      out.add(`${initials} ${f}`);
      if (f !== WORDS[n]) out.add(`${initials}${f}`);
    }
  }
  return [...out];
}
