/* =============================================================================
   App.InvoiceStore · localStorage-Persistenz für den Rechnungsgenerator.
   -----------------------------------------------------------------------------
   Drei unabhängige Datensätze: Einstellungen (Absender/Bank/Standardwerte),
   Kunden und Rechnungen (History). Alles bleibt lokal im Browser — kein
   Server, kein externer Aufruf (DSGVO-konform, analog zum Rest des Repos).
   ========================================================================== */

App.register('InvoiceStore', {
  KEYS: {
    settings: 'kuntze-invoicing:settings',
    customers: 'kuntze-invoicing:customers',
    invoices: 'kuntze-invoicing:invoices',
  },

  DEFAULT_SETTINGS: {
    company: {
      kicker1: 'SOFTWAREENTWICKLUNG &',
      kicker2: 'IT-DIENSTLEISTUNGEN',
      name: 'Kuntze',
      fullName: 'Softwareentwicklung & IT-Dienstleistungen Kuntze',
      contactName: 'Lukas Kuntze',
      street: 'Am Knick 19',
      zip: '31036',
      city: 'Eime',
      country: 'Deutschland',
      phone: '+49 (0) 151 16895833',
      email: 'lukas.kuntze@kuntze-it.de',
      website: 'https://www.kuntze-it.de',
      taxNumber: '30 / 125 / 03465',
    },
    bank: {
      accountHolder: 'Lukas Kuntze',
      bankName: 'Sparkasse Hildesheim Goslar Peine',
      iban: 'DE71 2595 0130 0074 8060 07',
      bic: 'NOLADE21HIK',
    },
    invoice: {
      numberPrefix: 'RE',
      dueDays: 7,
      editor: 'Lukas Kuntze',
      kleinunternehmer: true,
      kleinunternehmerText: 'Gemäß § 19 Abs. 1 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).',
      vatRate: 19,
      intro: 'vielen Dank für Ihren Auftrag. Für die nachfolgend aufgeführten Leistungen stelle ich Ihnen folgenden Betrag in Rechnung.',
      closing: 'Bei Fragen zu dieser Rechnung stehe ich Ihnen gerne zur Verfügung.',
    },
  },

  init() { /* no DOM wiring — pure data module */ },

  _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  _write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  },

  getSettings() {
    const stored = this._read(this.KEYS.settings, null) || {};
    return {
      company: { ...this.DEFAULT_SETTINGS.company, ...stored.company },
      bank: { ...this.DEFAULT_SETTINGS.bank, ...stored.bank },
      invoice: { ...this.DEFAULT_SETTINGS.invoice, ...stored.invoice },
    };
  },
  saveSettings(settings) { return this._write(this.KEYS.settings, settings); },

  getCustomers() { return this._read(this.KEYS.customers, []); },
  saveCustomers(list) { return this._write(this.KEYS.customers, list); },

  getInvoices() { return this._read(this.KEYS.invoices, []); },
  saveInvoices(list) { return this._write(this.KEYS.invoices, list); },

  nextCustomerNumber() {
    const customers = this.getCustomers();
    const max = customers.reduce((m, c) => Math.max(m, Number(c.kundennummer) || 0), 0);
    return max + 1;
  },

  /** Nächste freie Rechnungsnummer für {prefix}-{jahr}-KD{kundennummer}-{laufend}. */
  nextInvoiceNumber(prefix, year, kundennummer, excludeId) {
    const stem = `${prefix}-${year}-KD${kundennummer}-`;
    const max = this.getInvoices().reduce((m, inv) => {
      if (inv.id === excludeId) return m;
      if (inv.number && inv.number.startsWith(stem)) {
        const seq = parseInt(inv.number.slice(stem.length), 10);
        if (!isNaN(seq)) return Math.max(m, seq);
      }
      return m;
    }, 0);
    return `${stem}${String(max + 1).padStart(4, '0')}`;
  },

  exportAll() {
    return {
      exportedAt: new Date().toISOString(),
      settings: this.getSettings(),
      customers: this.getCustomers(),
      invoices: this.getInvoices(),
    };
  },
  importAll(data) {
    if (data && data.settings) this.saveSettings(data.settings);
    if (data && Array.isArray(data.customers)) this.saveCustomers(data.customers);
    if (data && Array.isArray(data.invoices)) this.saveInvoices(data.invoices);
  },
});
