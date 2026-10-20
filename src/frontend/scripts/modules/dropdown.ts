import { App } from '../core/app.js';

/**
 * Menu button of the styleguide: click or ↓ opens, ↑/↓/Home/End move, ESC closes and returns focus to the
 * toggle, a click elsewhere closes. Delegated, so menus rendered later work as well.
 */
export const Dropdown = App.register('Dropdown', {
  init(): void {
    document.addEventListener('click', (event) => {
      const toggle = event.target instanceof Element ? event.target.closest('[data-dropdown-toggle]') : null;
      const dropdown = toggle?.closest<HTMLElement>('.dropdown') ?? null;
      const wasOpen = dropdown?.classList.contains('is-open') ?? false;

      Dropdown.closeAll();

      if (dropdown !== null && !wasOpen) {
        Dropdown.open(dropdown);
      }
    });

    document.addEventListener('keydown', (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const dropdown = target?.closest<HTMLElement>('.dropdown') ?? null;

      if (event.key === 'Escape') {
        const open = document.querySelector<HTMLElement>('.dropdown.is-open');
        Dropdown.closeAll();
        open?.querySelector<HTMLElement>('[data-dropdown-toggle]')?.focus();
        return;
      }

      if (dropdown === null || target === null) {
        return;
      }

      const items = Array.from(dropdown.querySelectorAll<HTMLElement>('.dropdown-item')).filter(
        (item) => !item.hidden && !item.hasAttribute('disabled'),
      );

      if (target.hasAttribute('data-dropdown-toggle') && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        Dropdown.closeAll();
        Dropdown.open(dropdown);
        (event.key === 'ArrowUp' ? items[items.length - 1] : items[0])?.focus();
        return;
      }

      const index = items.indexOf(target);
      const targets: Readonly<Record<string, HTMLElement | undefined>> = {
        ArrowDown: items[(index + 1) % items.length],
        ArrowUp: items[(index - 1 + items.length) % items.length],
        Home: items[0],
        End: items[items.length - 1],
      };
      const next = index === -1 ? undefined : targets[event.key];

      if (event.key === 'Tab') {
        Dropdown.closeAll();
      } else if (next !== undefined) {
        event.preventDefault();
        next.focus();
      }
    });
  },

  open(dropdown: HTMLElement): void {
    dropdown.classList.add('is-open');
    dropdown.querySelector('[data-dropdown-toggle]')?.setAttribute('aria-expanded', 'true');
  },

  closeAll(): void {
    for (const dropdown of document.querySelectorAll('.dropdown.is-open')) {
      dropdown.classList.remove('is-open');
      dropdown.querySelector('[data-dropdown-toggle]')?.setAttribute('aria-expanded', 'false');
    }
  },
});
