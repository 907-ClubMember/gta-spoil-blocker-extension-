/**
 * A button that needs two presses, not a browser pop-up: one stray click must not lose someone's settings. The page is drawn
 * again often (a save elsewhere, the timed redraw, a tab switch), which builds a new button, so the armed state lives here by
 * id, not in the button: the second press works on the new one. It goes back by itself after ARM_MS, on screen.
 */
export const ARM_MS = 8000;

const armed = new Map<string, number>();
const current = new Map<string, HTMLButtonElement>();
const labels = new Map<string, string>();

function disarm(id: string) {
  window.clearTimeout(armed.get(id));
  armed.delete(id);
  const b = current.get(id);
  if (b) b.textContent = labels.get(id) ?? '';
}

export function disarmAll() {
  for (const id of [...armed.keys()]) disarm(id);
}

export function armedButton(id: string, text: string, confirm: string, action: () => void | Promise<void>): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-live', 'polite');
  current.set(id, b);
  labels.set(id, text);
  b.textContent = armed.has(id) ? confirm : text;
  if (armed.has(id)) b.classList.add('armed');
  // Clicking somewhere else on the page goes back; a button taken off the page by a redraw does not.
  b.addEventListener('blur', () => {
    if (b.isConnected && current.get(id) === b) disarm(id);
  });
  b.addEventListener('click', () => {
    if (armed.has(id)) {
      disarm(id);
      b.classList.remove('armed');
      void action();
      return;
    }
    b.textContent = confirm;
    b.classList.add('armed');
    armed.set(id, window.setTimeout(() => {
      current.get(id)?.classList.remove('armed');
      disarm(id);
    }, ARM_MS));
  });
  return b;
}
