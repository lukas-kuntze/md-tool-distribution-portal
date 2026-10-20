/* =============================================================================
   App.CookieModal · DSGVO cookie consent — Variante B (modaler Dialog).
   -----------------------------------------------------------------------------
   Reicherer, blockierender Einstellungsdialog (übernommen aus der
   business-management-console). Öffnen/Schließen/ESC/Fokus-Trap liefert bereits
   App.Overlays, weil der Dialog in einem generischen `.modal-overlay` sitzt
   (Opener: [data-modal-open], Close-Buttons: [data-modal-close]). Dieses Modul
   ergänzt nur die fachliche Logik:
     • beim Öffnen die gespeicherte Auswahl in die Checkboxen laden
     • bei Klick auf eine Aktion die Auswahl persistieren + Bestätigungs-Toast

   Persistenz teilt sich das Cookie `cookie_consent` mit Variante A
   (365 Tage, SameSite=Lax). Aktionen via [data-cookie] im Dialog:
     necessary → nur Notwendige   ·   save → aktuelle Auswahl   ·   all → alle

   NOTE (styleguide demo): im Produkt würde man den Dialog beim ersten Besuch
   (`!hasConsent()`) automatisch öffnen und später über einen
   „Cookie-Einstellungen"-Link erneut. Hier wird er nur über den Demo-Button
   [data-modal-open] geöffnet, damit der Styleguide nicht blockiert.
   ========================================================================== */

App.register('CookieModal', {
  COOKIE_NAME: 'cookie_consent',
  COOKIE_DAYS: 365,

  init() {
    this.modal = document.querySelector('[data-cookie-modal]');
    if (!this.modal) return;
    this.overlay = this.modal.closest('.modal-overlay');

    // Persist the choice when an action button is clicked. The [data-modal-close]
    // attribute on those buttons lets App.Overlays handle the actual closing.
    this.modal.addEventListener('click', (e) => {
      const action = e.target.closest('[data-cookie]');
      if (!action) return;
      const kind = action.getAttribute('data-cookie');
      if (kind === 'all') this.save({ necessary: true, analytics: true, marketing: true });
      else if (kind === 'necessary') this.save({ necessary: true, analytics: false, marketing: false });
      else if (kind === 'save') this.save(this.readSelection());
    });

    // Reflect the stored selection into the checkboxes whenever the dialog opens.
    document.querySelectorAll('[data-modal-open="' + this.overlay?.id + '"]').forEach((btn) =>
      btn.addEventListener('click', () => this.loadSelection())
    );
  },

  readSelection() {
    const val = (id) => Boolean(this.modal.querySelector('#' + id)?.checked);
    return { necessary: true, analytics: val('cm-analytics'), marketing: val('cm-marketing') };
  },

  loadSelection() {
    const consent = this.getConsent();
    if (!consent) return;
    const set = (id, on) => { const el = this.modal.querySelector('#' + id); if (el) el.checked = Boolean(on); };
    set('cm-analytics', consent.analytics);
    set('cm-marketing', consent.marketing);
  },

  hasConsent() {
    return document.cookie.split(';').some((c) => c.trim().startsWith(this.COOKIE_NAME + '='));
  },

  getConsent() {
    const match = document.cookie.match(new RegExp('(?:^|; )' + this.COOKIE_NAME + '=([^;]+)'));
    if (!match) return null;
    try { return JSON.parse(decodeURIComponent(match[1])); } catch (e) { return null; }
  },

  save(preferences) {
    const prefs = { ...preferences, timestamp: new Date().toISOString() };
    const expires = new Date();
    expires.setDate(expires.getDate() + this.COOKIE_DAYS);
    document.cookie =
      `${this.COOKIE_NAME}=${encodeURIComponent(JSON.stringify(prefs))};` +
      `expires=${expires.toUTCString()};path=/;SameSite=Lax`;
    if (App.Toast) {
      App.Toast.show({
        type: 'success',
        title: 'Einstellungen gespeichert',
        body: 'Deine Cookie-Auswahl wurde übernommen.',
      });
    }
  },
});
