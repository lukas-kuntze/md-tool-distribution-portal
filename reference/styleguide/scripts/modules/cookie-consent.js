/* =============================================================================
   App.CookieConsent · DSGVO cookie banner.
   -----------------------------------------------------------------------------
   Three categories (necessary always on). The choice is persisted in a
   `cookie_consent` cookie (365 days, SameSite=Lax). Buttons via [data-cookie]:
     necessary → only necessary   ·   save → current selection   ·   all → accept all

   NOTE (styleguide demo): in a real product you would call show() on load when
   !hasConsent(). Here the banner starts hidden and is opened via the demo button
   [data-cookie-open], so the styleguide isn't blocked on every visit. On file://
   cookies may not persist — the confirmation toast still fires.
   ========================================================================== */

App.register('CookieConsent', {
  COOKIE_NAME: 'cookie_consent',
  COOKIE_DAYS: 365,

  init() {
    this.banner = document.querySelector('[data-cookie-banner]');
    if (!this.banner) return;

    this.banner.addEventListener('click', (e) => {
      const action = e.target.closest('[data-cookie]');
      if (!action) return;
      const kind = action.getAttribute('data-cookie');
      if (kind === 'all') this.save({ necessary: true, analytics: true, marketing: true });
      else if (kind === 'necessary') this.save({ necessary: true, analytics: false, marketing: false });
      else if (kind === 'save') this.save(this.readSelection());
    });

    document.querySelectorAll('[data-cookie-open]').forEach((btn) =>
      btn.addEventListener('click', () => this.show())
    );
  },

  readSelection() {
    const val = (id) => Boolean(this.banner.querySelector('#' + id)?.checked);
    return { necessary: true, analytics: val('cc-analytics'), marketing: val('cc-marketing') };
  },

  hasConsent() {
    return document.cookie.split(';').some((c) => c.trim().startsWith(this.COOKIE_NAME + '='));
  },

  save(preferences) {
    const expires = new Date();
    expires.setDate(expires.getDate() + this.COOKIE_DAYS);
    document.cookie =
      `${this.COOKIE_NAME}=${encodeURIComponent(JSON.stringify(preferences))};` +
      `expires=${expires.toUTCString()};path=/;SameSite=Lax`;
    this.hide();
    if (App.Toast) {
      App.Toast.show({
        type: 'success',
        title: 'Einstellungen gespeichert',
        body: 'Deine Cookie-Auswahl wurde übernommen.',
      });
    }
  },

  show() { this.banner.hidden = false; },
  hide() { this.banner.hidden = true; },
});
