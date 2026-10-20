/* =============================================================================
   App.Tabs · segmented tab/pill controls (WAI-ARIA tabs pattern).
   -----------------------------------------------------------------------------
   Toggles .is-active + panel[hidden] and implements the full keyboard model the
   role="tablist"/role="tab" markup promises to assistive technology:
     • Roving tabindex  → only the active tab is in the page tab sequence.
     • ← / →  (and ↑ / ↓)  move between tabs; Home / End jump to first / last.
     • Activation is automatic: moving focus also selects the tab (matches the
       original click behaviour and is recommended for panels that are cheap to
       show). Enter/Space are not needed but remain harmless on <button>.
   ========================================================================== */

App.register('Tabs', {
  init() {
    document.querySelectorAll('.tablist').forEach((tablist) => {
      const tabs = Array.from(tablist.querySelectorAll('.tab'));
      if (!tabs.length) return;

      // Establish the initial roving tabindex from the pre-marked active tab.
      const active = tablist.querySelector('.tab.is-active') || tabs[0];
      tabs.forEach((t) => t.setAttribute('tabindex', t === active ? '0' : '-1'));

      tablist.addEventListener('click', (e) => {
        const tab = e.target.closest('.tab');
        if (tab && tablist.contains(tab)) this.activate(tablist, tabs, tab);
      });

      tablist.addEventListener('keydown', (e) => {
        const current = e.target.closest('.tab');
        if (!current || !tablist.contains(current)) return;

        const i = tabs.indexOf(current);
        let next = null;
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown': next = tabs[(i + 1) % tabs.length]; break;
          case 'ArrowLeft':
          case 'ArrowUp':   next = tabs[(i - 1 + tabs.length) % tabs.length]; break;
          case 'Home':      next = tabs[0]; break;
          case 'End':       next = tabs[tabs.length - 1]; break;
          default: return;
        }
        e.preventDefault();
        this.activate(tablist, tabs, next);
        next.focus();
      });
    });
  },

  /** Select `tab`, update roving tabindex and toggle the matching panel. */
  activate(tablist, tabs, tab) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      t.setAttribute('tabindex', on ? '0' : '-1');
    });

    const group = tablist.closest('[data-tab-group]');
    const panelId = tab.getAttribute('aria-controls');
    if (group && panelId) {
      group.querySelectorAll('[data-tab-panel]').forEach((panel) => {
        panel.hidden = panel.id !== panelId;
      });
    }
  },
});
