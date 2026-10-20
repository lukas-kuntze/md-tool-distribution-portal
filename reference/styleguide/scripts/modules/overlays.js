/* =============================================================================
   App.Overlays · Modal & Drawer controller.
   -----------------------------------------------------------------------------
   Preserves the original open/close behaviour (trigger buttons, overlay click,
   ESC) and adds the focus management the styleguide documents as mandatory but
   the original demo did not implement:
     • focus moves into the dialog on open (Cancel first for destructive modals)
     • Tab/Shift+Tab are trapped inside the open dialog
     • focus returns to the triggering element on close
   See docs/RECOMMENDATIONS.md → "Umgesetzte Empfehlungen".
   ========================================================================== */

App.register('Overlays', {
  _lastTrigger: null,
  _inerted: [],

  FOCUSABLE:
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',

  init() {
    // Openers
    document.querySelectorAll('[data-modal-open]').forEach((btn) => {
      btn.addEventListener('click', () =>
        this.open(document.getElementById(btn.getAttribute('data-modal-open')), btn)
      );
    });
    document.querySelectorAll('[data-drawer-open]').forEach((btn) => {
      btn.addEventListener('click', () =>
        this.open(document.getElementById(btn.getAttribute('data-drawer-open')), btn)
      );
    });

    // Explicit close buttons
    document.querySelectorAll('[data-modal-close], [data-drawer-close]').forEach((btn) => {
      btn.addEventListener('click', () =>
        this.close(btn.closest('.modal-overlay, .drawer-overlay'))
      );
    });

    // Click on the backdrop
    document.querySelectorAll('.modal-overlay, .drawer-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.close(overlay);
      });
    });

    // ESC closes the topmost open overlay; keep focus trapped on Tab.
    document.addEventListener('keydown', (e) => {
      const open = this.openOverlay();
      if (!open) return;
      if (e.key === 'Escape') this.close(open);
      else if (e.key === 'Tab') this.trapFocus(e, open);
    });
  },

  openOverlay() {
    return document.querySelector('.modal-overlay:not([hidden]), .drawer-overlay:not([hidden])');
  },

  open(overlay, trigger) {
    if (!overlay) return;
    this._lastTrigger = trigger || document.activeElement;
    overlay.hidden = false;
    this.lockScroll();
    this.applyInert(overlay);

    // Prefer an explicitly marked element, then the non-destructive action
    // (outline button = "Abbrechen"), then the first focusable element.
    const dialog = overlay.querySelector('.modal, .drawer') || overlay;
    const target =
      dialog.querySelector('[data-autofocus]') ||
      dialog.querySelector('.btn-outline') ||
      dialog.querySelector(this.FOCUSABLE);
    if (target) target.focus();
  },

  close(overlay) {
    if (!overlay) return;
    overlay.hidden = true;
    // Release scroll-lock and the background `inert` once every overlay is
    // closed (dialogs can stack, e.g. the cookie modal reuses this controller).
    // Order matters: the background must be un-inerted BEFORE focus is returned,
    // because focus() is a no-op on an element inside an inert subtree.
    if (!this.openOverlay()) {
      this.unlockScroll();
      this.releaseInert();
    }
    if (this._lastTrigger && typeof this._lastTrigger.focus === 'function') {
      this._lastTrigger.focus();
    }
    this._lastTrigger = null;
  },

  /** Make everything behind the dialog inert: removes it from the tab order AND
   *  hides it from assistive tech (the Tab focus-trap alone doesn't stop a
   *  screen-reader's virtual cursor). The live toast region is left interactive
   *  so status messages keep being announced. Complements lockScroll(). */
  applyInert(overlay) {
    Array.from(document.body.children).forEach((el) => {
      if (el === overlay || el.tagName === 'SCRIPT') return;
      if (el.hasAttribute('data-toast-stack') || el.inert) return;
      el.inert = true;
      this._inerted.push(el);
    });
  },

  releaseInert() {
    this._inerted.forEach((el) => { el.inert = false; });
    this._inerted = [];
  },

  /** Prevent the page behind an open overlay from scrolling. Compensates for
   *  the removed scrollbar so the fixed topbar/content doesn't shift. */
  lockScroll() {
    if (document.body.classList.contains('has-overlay')) return;
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    if (sbw > 0) document.body.style.paddingRight = sbw + 'px';
    document.body.classList.add('has-overlay');
  },

  unlockScroll() {
    document.body.classList.remove('has-overlay');
    document.body.style.paddingRight = '';
  },

  trapFocus(e, overlay) {
    const focusables = Array.from(
      overlay.querySelectorAll(this.FOCUSABLE)
    ).filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  },
});
