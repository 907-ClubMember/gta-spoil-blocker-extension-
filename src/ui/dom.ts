import { TEXT } from '../text';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props as Record<string, unknown>;
  if (cls) e.className = cls as string;
  Object.assign(e, rest);
  e.append(...kids);
  return e;
}

/** What a hidden post looks like, on a harmless line. Hover shows the post, as a click does on a real page. */
export function preview(look: 'light' | 'medium' | 'heavy' | 'solid' | 'line' | 'gone'): HTMLDivElement {
  const label = el('span', { class: 'pv-label' }, TEXT.previewLabel);
  const body = look === 'gone' ? el('div', { class: 'pv-gone' }, TEXT.previewGone)
    : look === 'line' ? el('div', { class: 'pv-line', title: 'Click to show, on a real page' }, label)
    : el('div', { class: `pv-cover pv-${look}`, title: 'Click the label to show, on a real page' }, el('span', { class: 'pv-text' }, TEXT.previewPost), label);
  return el('div', { class: 'pv', ariaHidden: 'true' }, el('div', { class: 'pv-plain' }, TEXT.previewAbove), body, el('div', { class: 'pv-plain' }, TEXT.previewBelow));
}

/** Which control had the keyboard, so a page drawn again can give it back, by what it is and not by where it was. */
const CONTROLS = 'input,select,button,summary,a';
const keyOf = (e: Element): string => `${e.tagName}|${(e as HTMLInputElement).type ?? ''}|${(e as HTMLInputElement).name ?? ''}|${e.getAttribute('aria-label') ?? e.ariaLabel ?? e.closest('label')?.textContent ?? e.textContent ?? ''}`;
export interface Focus {
  key: string;
  /** Which of the controls with this same description ("Add" appears once per list). */
  nth: number;
}
export function rememberFocus(root: Element): Focus | null {
  const now = document.activeElement;
  if (!now || !root.contains(now) || !now.matches(CONTROLS)) return null;
  const key = keyOf(now);
  return { key, nth: [...root.querySelectorAll(CONTROLS)].filter((e) => keyOf(e) === key).indexOf(now) };
}
/** If the control has gone (a pause button once paused), the first control, so the keyboard isn't thrown out of the page. */
export function restoreFocus(root: Element, f: Focus | null): void {
  if (!f) return;
  const all = [...root.querySelectorAll<HTMLElement>(CONTROLS)].filter((e) => !e.closest('[hidden]'));
  const same = all.filter((e) => keyOf(e) === f.key);
  (same[Math.min(f.nth, same.length - 1)] ?? all[0])?.focus({ preventScroll: true });
}

/** A button that needs a second press within a few seconds, for what can't be taken back. */
export function twoPress(b: HTMLButtonElement, text: string, confirm: string, action: () => void | Promise<void>): void {
  let armed = 0;
  const disarm = () => {
    window.clearTimeout(armed);
    armed = 0;
    b.textContent = text;
  };
  b.setAttribute('aria-live', 'polite');
  b.addEventListener('blur', disarm);
  b.addEventListener('click', () => {
    if (armed) {
      disarm();
      void action();
    } else {
      b.textContent = confirm;
      armed = window.setTimeout(disarm, 4000);
    }
  });
}

/** A radio/checkbox row: bold name plus a plain-language explanation underneath. */
export function choiceRow(input: HTMLInputElement, name: string, help: string): HTMLLabelElement {
  return el('label', { class: 'row' }, input, el('span', {}, el('b', {}, name), el('span', { class: 'help' }, help)));
}
