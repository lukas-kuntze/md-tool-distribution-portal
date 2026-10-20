/* =============================================================================
   App.Dropdown · click-to-open context menus (WAI-ARIA menu button pattern).
   -----------------------------------------------------------------------------
   Opens on click, closes on outside click / ESC / re-click. Keyboard model:
     • ↓ on the toggle (or click) opens and moves focus to the first item.
     • ↑ / ↓ move between items, Home / End jump to first / last.
     • ESC closes and returns focus to the toggle; Tab closes the menu.
   ========================================================================== */

App.register('Dropdown', {
  init() {
    document.querySelectorAll('.dropdown').forEach((dropdown) => {
      const toggle = dropdown.querySelector('[data-dropdown-toggle]');
      const menu = dropdown.querySelector('.dropdown-menu');
      if (!toggle || !menu) return;

      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !dropdown.classList.contains('is-open');
        this.closeAll();
        if (willOpen) this.open(dropdown, { focusFirst: false });
      });

      // ↓ / ↑ / Enter / Space on the toggle open the menu and focus an item.
      toggle.addEventListener('keydown', (e) => {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
          e.preventDefault();
          this.closeAll();
          this.open(dropdown, { focusFirst: e.key !== 'ArrowUp', focusLast: e.key === 'ArrowUp' });
        }
      });

      // Arrow navigation within the open menu.
      menu.addEventListener('keydown', (e) => this.onMenuKeydown(e, dropdown, toggle, menu));
    });

    document.addEventListener('click', () => this.closeAll());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeAll();
    });
  },

  items(menu) {
    return Array.from(menu.querySelectorAll('.dropdown-item')).filter((el) => !el.disabled);
  },

  open(dropdown, { focusFirst = false, focusLast = false } = {}) {
    const toggle = dropdown.querySelector('[data-dropdown-toggle]');
    const menu = dropdown.querySelector('.dropdown-menu');
    dropdown.classList.add('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    const items = this.items(menu);
    if (focusLast && items.length) items[items.length - 1].focus();
    else if (focusFirst && items.length) items[0].focus();
  },

  onMenuKeydown(e, dropdown, toggle, menu) {
    const items = this.items(menu);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    let next = null;
    switch (e.key) {
      case 'ArrowDown': next = items[(i + 1) % items.length]; break;
      case 'ArrowUp':   next = items[(i - 1 + items.length) % items.length]; break;
      case 'Home':      next = items[0]; break;
      case 'End':       next = items[items.length - 1]; break;
      case 'Escape':
      case 'Tab':
        this.closeAll();
        if (e.key === 'Escape') { e.preventDefault(); toggle.focus(); }
        return;
      default: return;
    }
    e.preventDefault();
    next.focus();
  },

  closeAll() {
    document.querySelectorAll('.dropdown.is-open').forEach((d) => {
      d.classList.remove('is-open');
      const t = d.querySelector('[data-dropdown-toggle]');
      if (t) t.setAttribute('aria-expanded', 'false');
    });
  },
});
