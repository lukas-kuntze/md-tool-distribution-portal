import { App } from '../core/app.js';
import { h } from '../core/dom.js';

export type ToastType = 'success' | 'danger' | 'warning' | 'info';

/**
 * Non-blocking notifications, removed after `App.TOAST_DELAY`. The stack is an `aria-live` region, so each toast
 * is announced once without a role of its own.
 */
export const Toast = App.register('Toast', {
  init(): void {
    // Nothing to wire up; toasts are shown programmatically.
  },

  show(type: ToastType, title: string, body = ''): void {
    const stack = document.querySelector('[data-toast-stack]');

    if (stack === null) {
      return;
    }

    const close = h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Schließen' }, '×');
    const toast = h(
      'div',
      { class: `toast ${type}` },
      h(
        'div',
        { class: 'toast-content' },
        h('div', { class: 'toast-title' }, title),
        body === '' ? null : h('div', { class: 'toast-body' }, body),
      ),
      close,
    );

    close.addEventListener('click', () => toast.remove());
    stack.appendChild(toast);
    window.setTimeout(() => toast.remove(), App.TOAST_DELAY);
  },
});
