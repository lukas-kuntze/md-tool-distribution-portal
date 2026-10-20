/* =============================================================================
   App.Theme · light/dark mode toggle.
   -----------------------------------------------------------------------------
   The default theme is ALWAYS light. Dark mode is a manual opt-in via the
   toggle; the choice is stored in localStorage and re-applied by the tiny inline
   <head> script (no FOUC). The OS prefers-color-scheme is intentionally NOT
   followed — a dark-OS visitor still gets light until they toggle.

   Programmatic: App.Theme.set('dark' | 'light')
   ========================================================================== */

App.register('Theme', {
  KEY: 'kuntze-theme',

  init() {
    this.toggle = document.querySelector('[data-theme-toggle]');
    if (this.toggle) {
      this.toggle.addEventListener('click', () => this.set(this.current() === 'dark' ? 'light' : 'dark'));
    }
    this.sync();
  },

  stored() {
    try { return localStorage.getItem(this.KEY); } catch (e) { return null; }
  },

  /** The effective theme. Default is always light; dark is a manual opt-in. */
  current() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  },

  set(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(this.KEY, theme); } catch (e) { /* ignore */ }
    this.sync();
  },

  sync() {
    if (!this.toggle) return;
    const dark = this.current() === 'dark';
    this.toggle.setAttribute('aria-pressed', String(dark));
    const icon = this.toggle.querySelector('.material-icons-outlined');
    if (icon) icon.textContent = dark ? 'light_mode' : 'dark_mode';
    const label = this.toggle.querySelector('[data-theme-label]');
    if (label) label.textContent = dark ? 'Hell' : 'Dunkel';
  },
});
