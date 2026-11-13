// Does a text name something on the spoiler list? Shared by the spoiler scan and the intake decisions.
import { Matcher } from '../../src/matcher/index';
import { CATEGORIES, type Term } from '../../src/types';
import { KNOWN_HEADINGS } from './forms';

/**
 * Names that count: those that hide everywhere. A repo about the game always "mentions the game", and this step acts with no one
 * watching, so a name that needs a mention, which can be everyday words ("What Happened"), does not count.
 */
export function scanTerms(terms: Term[]): Term[] {
  return terms.filter((t) => t.s === 'strong');
}

const OLD_FORM_HEADINGS = /^### (What happened\?|Link to the page|What were you protecting\?.*|Strictness.*|Anything else.*)$/gm;

/** The forms' own headings are not the writer's words; any other heading is. */
function withoutFormHeadings(t: string): string {
  return t.replace(OLD_FORM_HEADINGS, '').split('\n').filter((l) => !(l.startsWith('### ') && KNOWN_HEADINGS.has(l.slice(4).trim()))).join('\n');
}

/** Does any of these texts name something on the list? */
export function namesSpoiler(texts: string[], terms: Term[]): boolean {
  const m = new Matcher({ terms: scanTerms(terms), strictness: 'medium', categories: new Set(CATEGORIES), allowWords: [], customWords: [] });
  return texts.some((t) => !!t && m.inspect(withoutFormHeadings(t)).strong.size > 0);
}
