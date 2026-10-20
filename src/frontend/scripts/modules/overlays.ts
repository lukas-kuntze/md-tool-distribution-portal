import { App } from '../core/app.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const OVERLAY = '.modal-overlay, .drawer-overlay';

let lastTrigger: HTMLElement | null = null;
let inerted: HTMLElement[] = [];

/**
 * Modal and drawer controller of the styleguide: opens via `[data-modal-open]` / `[data-drawer-open]`, closes on
 * ESC, backdrop click and `[data-modal-close]` / `[data-drawer-close]`, traps focus inside and returns it to the
 * trigger. The page behind becomes inert, except the toast region.
 */
export const Overlays = App.register('Overlays', {
  init(): void {
    document.addEventListener('click', (event) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const opener = target.closest<HTMLElement>('[data-modal-open], [data-drawer-open]');
      const closer = target.closest('[data-modal-close], [data-drawer-close]');

      if (opener !== null) {
        const id = opener.getAttribute('data-modal-open') ?? opener.getAttribute('data-drawer-open') ?? '';
        Overlays.open(document.getElementById(id), opener);
      } else if (closer !== null) {
        Overlays.close(closer.closest<HTMLElement>(OVERLAY));
      } else if (target.matches(OVERLAY)) {
        Overlays.close(target as HTMLElement);
      }
    });

    document.addEventListener('keydown', (event) => {
      const open = Overlays.openOverlay();

      if (open === null) {
        return;
      }

      if (event.key === 'Escape') {
        Overlays.close(open);
      } else if (event.key === 'Tab') {
        trapFocus(event, open);
      }
    });
  },

  openOverlay(): HTMLElement | null {
    const all = document.querySelectorAll<HTMLElement>(`.modal-overlay:not([hidden]), .drawer-overlay:not([hidden])`);
    return all.item(all.length - 1);
  },

  open(overlay: HTMLElement | null, trigger?: HTMLElement): void {
    if (overlay === null) {
      return;
    }

    lastTrigger = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    // Pages keep their dialogs next to their content; the background is made inert per child of <body>, so the
    // dialog itself has to be one of those children.
    if (overlay.parentElement !== document.body) {
      document.body.append(overlay);
    }

    overlay.hidden = false;
    lockScroll();
    applyInert(overlay);

    // Explicit autofocus first, then the non-destructive action ("Abbrechen"), then anything focusable.
    const dialog = overlay.querySelector<HTMLElement>('.modal, .drawer') ?? overlay;
    const focusTarget =
      dialog.querySelector<HTMLElement>('[data-autofocus]') ??
      dialog.querySelector<HTMLElement>('.btn-outline') ??
      dialog.querySelector<HTMLElement>(FOCUSABLE);

    focusTarget?.focus();
  },

  close(overlay: HTMLElement | null): void {
    if (overlay === null || overlay.hidden) {
      return;
    }

    overlay.hidden = true;
    overlay.dispatchEvent(new CustomEvent('overlay:closed'));

    // The background must be interactive again before focus can return to it.
    if (Overlays.openOverlay() === null) {
      unlockScroll();
      releaseInert();
    }

    lastTrigger?.focus();
    lastTrigger = null;
  },
});

function applyInert(overlay: HTMLElement): void {
  for (const element of Array.from(document.body.children)) {
    if (
      !(element instanceof HTMLElement) ||
      element === overlay ||
      element.tagName === 'SCRIPT' ||
      element.hasAttribute('data-toast-stack') ||
      element.inert
    ) {
      continue;
    }

    element.inert = true;
    inerted.push(element);
  }
}

function releaseInert(): void {
  for (const element of inerted) {
    element.inert = false;
  }

  inerted = [];
}

function lockScroll(): void {
  if (document.body.classList.contains('has-overlay')) {
    return;
  }

  const scrollbar = window.innerWidth - document.documentElement.clientWidth;

  if (scrollbar > 0) {
    document.body.style.paddingRight = `${scrollbar}px`;
  }

  document.body.classList.add('has-overlay');
}

function unlockScroll(): void {
  document.body.classList.remove('has-overlay');
  document.body.style.paddingRight = '';
}

function trapFocus(event: KeyboardEvent, overlay: HTMLElement): void {
  const focusables = Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  if (first === undefined || last === undefined) {
    return;
  }

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
