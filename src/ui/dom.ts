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

/** A radio/checkbox row: bold name plus a plain-language explanation underneath. */
export function choiceRow(input: HTMLInputElement, name: string, help: string): HTMLLabelElement {
  return el('label', { class: 'row' }, input, el('span', {}, el('b', {}, name), el('span', { class: 'help' }, help)));
}
