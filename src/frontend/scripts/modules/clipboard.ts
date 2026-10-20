import { App } from '../core/app.js';

const FEEDBACK_MS = 1600;

/**
 * Copies the value of `[data-copy]` buttons, e.g. SHA-256 digests and commit hashes. As the styleguide's code
 * snippets do, a visible `[data-copy-label]` switches to "Kopiert" (or "Fehler") for a moment; buttons that
 * only carry an icon report the same through their `aria-label`.
 */
export const Clipboard = App.register('Clipboard', {
  init(): void {
    document.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-copy]') : null;

      if (button !== null) {
        void Clipboard.copy(button, button.getAttribute('data-copy') ?? '');
      }
    });
  },

  async copy(button: HTMLElement, text: string): Promise<void> {
    const visible = button.querySelector('[data-copy-label]');
    const original = visible?.textContent ?? button.getAttribute('aria-label') ?? 'Kopieren';
    const show = (message: string): void => {
      if (visible === null) {
        button.setAttribute('aria-label', message);
      } else {
        visible.textContent = message;
      }
    };

    try {
      await navigator.clipboard.writeText(text);
      show('Kopiert');
      button.classList.add('copied');
    } catch {
      show(visible === null ? 'Kopieren nicht möglich' : 'Fehler');
    }

    window.setTimeout(() => {
      show(original);
      button.classList.remove('copied');
    }, FEEDBACK_MS);
  },
});
