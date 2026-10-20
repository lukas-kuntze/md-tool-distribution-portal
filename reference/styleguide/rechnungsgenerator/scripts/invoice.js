/* =============================================================================
   App.InvoiceApp · Rechnungsgenerator
   -----------------------------------------------------------------------------
   Kein Formular an der Seite: die Rechnung wird direkt im Dokument bearbeitet
   (contenteditable-Textstellen + schlanke Zahlen-/Datumsfelder). Zwei
   Render-Pfade:
     - buildEditableInvoiceHTML(): die Live-Ansicht mit Bearbeitungs-Elementen.
     - buildStaticInvoiceHTML(): reine, nicht-interaktive Fassung fürs
       Drucken/PDF (identisches Aussehen, aber ohne jede Bedienoberfläche).
   Tippen in ein Feld löst NIE ein komplettes Neu-Rendern aus (sonst geht der
   Cursor verloren) — nur gezielte DOM-Updates der betroffenen Summen/Spiegel.
   Strukturelle Änderungen (Zeile hinzufügen/löschen, Kunde wählen, Datum,
   Steuer-Modus) rendern das Dokument komplett neu; das ist unkritisch, weil
   dort kein Tippfokus verloren geht.
   ========================================================================== */

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escMultiline(v) { return String(v == null ? '' : v).split('\n').map(esc).join('<br>'); }

function fmtEUR(n) {
  return (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function fmtNum(n) {
  return (Number(n) || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 });
}
function fmtDateDE(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
function isoFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayISO() { return isoFromDate(new Date()); }
function addDaysISO(iso, days) {
  const [y, m, d] = (iso || todayISO()).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + (Number(days) || 0));
  return isoFromDate(dt);
}

let __uidCounter = 0;
function uid() {
  __uidCounter += 1;
  return `id_${Date.now().toString(36)}_${__uidCounter}_${Math.random().toString(36).slice(2, 6)}`;
}

function customerName(c) {
  if (!c) return '';
  const person = [c.vorname, c.nachname].filter(Boolean).join(' ');
  if (c.firma && person) return `${c.firma} (${person})`;
  return c.firma || person || 'Unbenannt';
}

function composeRecipientText(c) {
  const lines = [];
  if (c.firma) lines.push(c.firma);
  const person = [c.vorname, c.nachname].filter(Boolean).join(' ');
  if (person) lines.push(person);
  if (c.strasse) lines.push(c.strasse);
  const cityLine = [c.plz, c.ort].filter(Boolean).join(' ');
  if (cityLine) lines.push(cityLine);
  if (c.land) lines.push(c.land);
  return lines.join('\n');
}

function firstLine(text) {
  const line = String(text || '').split('\n')[0].trim();
  return line || '—';
}

function computeSalutation(c) {
  if (!c) return 'Sehr geehrte Damen und Herren,';
  const nach = (c.nachname || '').trim();
  if (c.anrede === 'Herr' && nach) return `Sehr geehrter Herr ${nach},`;
  if (c.anrede === 'Frau' && nach) return `Sehr geehrte Frau ${nach},`;
  const full = [c.vorname, c.nachname].filter(Boolean).join(' ');
  if (full) return `Sehr geehrte(r) ${full},`;
  return 'Sehr geehrte Damen und Herren,';
}

/* -- Modul ------------------------------------------------------------------ */

App.register('InvoiceApp', {
  init() {
    this.store = App.InvoiceStore;
    this.cacheDom();
    this.bindEvents();
    this.resetState();
    this.renderCustomerOptions();
    this.renderPreview();
    this.renderHistory();
  },

  cacheDom() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      customer: $('field-customer'),
      preview: $('invoice-preview'),
      printRoot: $('invoice-print-root'),

      btnNewInvoice: $('btn-new-invoice'),
      btnSaveInvoice: $('btn-save-invoice'),
      btnPrint: $('btn-print'),

      btnNewCustomer: $('btn-new-customer'),
      btnManageCustomers: $('btn-manage-customers'),
      customerModal: $('customer-modal'),
      custId: $('cust-id'),
      custNumber: $('cust-number'),
      custAnrede: $('cust-anrede'),
      custFirma: $('cust-firma'),
      custVorname: $('cust-vorname'),
      custNachname: $('cust-nachname'),
      custStrasse: $('cust-strasse'),
      custPlz: $('cust-plz'),
      custOrt: $('cust-ort'),
      custLand: $('cust-land'),
      customerList: $('customer-list'),
      btnCustSave: $('btn-cust-save'),

      historyBody: $('history-body'),
      historyEmpty: $('history-empty'),

      settingsTrigger: document.querySelector('[data-modal-open="settings-modal"]'),
      settingsModal: $('settings-modal'),
      setKicker1: $('set-kicker1'),
      setKicker2: $('set-kicker2'),
      setCompanyName: $('set-company-name'),
      setFullName: $('set-full-name'),
      setContactName: $('set-contact-name'),
      setStreet: $('set-street'),
      setZip: $('set-zip'),
      setCity: $('set-city'),
      setCountry: $('set-country'),
      setTaxNumber: $('set-tax-number'),
      setPhone: $('set-phone'),
      setEmail: $('set-email'),
      setWebsite: $('set-website'),
      setBankHolder: $('set-bank-holder'),
      setBankName: $('set-bank-name'),
      setIban: $('set-iban'),
      setBic: $('set-bic'),
      setEditor: $('set-editor'),
      setDueDays: $('set-due-days'),
      setKleinDefault: $('set-klein-default'),
      setKleinText: $('set-klein-text'),
      setVatRate: $('set-vat-rate'),
      setIntro: $('set-intro'),
      setClosing: $('set-closing'),
      btnSettingsSave: $('btn-settings-save'),
      btnExportData: $('btn-export-data'),
      btnImportTrigger: $('btn-import-trigger'),
      inputImportData: $('input-import-data'),
    };
  },

  getCustomer(id) {
    if (!id) return null;
    return this.store.getCustomers().find((c) => c.id === id) || null;
  },

  /* -- State -------------------------------------------------------------- */
  newItemRow() { return { id: uid(), label: '', sub: '', qty: 1, unit: '', price: 0 }; },
  newAdjustmentRow() { return { id: uid(), label: '', amount: 0 }; },

  resetState() {
    const settings = this.store.getSettings();
    const today = todayISO();
    this.state = {
      customerId: '',
      kundennummer: '',
      recipient: '',
      number: '',
      numberAuto: true,
      date: today,
      dueDate: addDaysISO(today, settings.invoice.dueDays),
      dueDateAuto: true,
      serviceNote: 'Das Leistungsdatum entspricht dem Rechnungsdatum.',
      editor: settings.invoice.editor,
      salutation: 'Sehr geehrte Damen und Herren,',
      intro: settings.invoice.intro,
      items: [this.newItemRow()],
      adjustments: [],
      kleinunternehmer: settings.invoice.kleinunternehmer,
      kleinText: settings.invoice.kleinunternehmerText,
      vatRate: settings.invoice.vatRate,
      pay: {
        holder: settings.bank.accountHolder,
        bank: settings.bank.bankName,
        iban: settings.bank.iban,
        bic: settings.bank.bic,
        purpose: '',
      },
      purposeAuto: true,
      closing: settings.invoice.closing,
      savedId: null,
    };
  },

  computeTotals() {
    const s = this.state;
    const subtotal = s.items.reduce((sum, i) => sum + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
    const adjTotal = s.adjustments.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
    const netTotal = subtotal + adjTotal;
    let vat = 0;
    let gross = netTotal;
    if (!s.kleinunternehmer) {
      vat = netTotal * (Number(s.vatRate) || 0) / 100;
      gross = netTotal + vat;
    }
    return { subtotal, adjTotal, netTotal, vat, gross };
  },

  regenerateNumber() {
    const settings = this.store.getSettings();
    const s = this.state;
    if (!s.kundennummer) { s.number = ''; return; }
    const year = (s.date || todayISO()).slice(0, 4);
    s.number = this.store.nextInvoiceNumber(settings.invoice.numberPrefix, year, s.kundennummer, s.savedId);
    s.numberAuto = true;
    if (s.purposeAuto) s.pay.purpose = s.number;
  },

  genericSet(path, value) {
    if (path.indexOf('.') === -1) { this.state[path] = value; return; }
    const [a, b] = path.split('.');
    this.state[a][b] = value;
  },

  updateTotalsDisplay() {
    const t = this.computeTotals();
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('sum-subtotal', fmtEUR(t.subtotal));
    set('sum-net', fmtEUR(t.netTotal));
    set('sum-vat', fmtEUR(t.vat));
    set('sum-total', fmtEUR(t.gross));
    set('pay-total-amount', fmtEUR(t.gross));
  },

  /* -- Events --------------------------------------------------------------- */
  bindEvents() {
    const el = this.el;

    el.customer.addEventListener('change', () => {
      const c = this.getCustomer(el.customer.value);
      if (!c) return;
      const s = this.state;
      s.customerId = c.id;
      s.kundennummer = String(c.kundennummer);
      s.recipient = composeRecipientText(c);
      s.salutation = computeSalutation(c);
      if (s.numberAuto) this.regenerateNumber();
      this.renderPreview();
    });

    /* -- Direktes Editieren im Dokument -------------------------------------- */
    el.preview.addEventListener('input', (e) => this.handlePreviewInput(e));
    el.preview.addEventListener('change', (e) => this.handlePreviewChange(e));
    el.preview.addEventListener('click', (e) => this.handlePreviewClick(e));

    el.btnNewInvoice.addEventListener('click', () => {
      if (!window.confirm('Aktuelles Dokument verwerfen und eine neue Rechnung beginnen?')) return;
      this.resetState();
      this.renderPreview();
      App.Toast.show({ type: 'info', title: 'Neue Rechnung', body: 'Das Dokument wurde zurückgesetzt.' });
    });
    el.btnSaveInvoice.addEventListener('click', () => this.saveInvoice());
    el.btnPrint.addEventListener('click', () => this.printInvoice());

    /* -- Kunden -------------------------------------------------------------- */
    el.btnNewCustomer.addEventListener('click', () => {
      this.resetCustomerForm();
      this.populateCustomerModalList();
      App.Overlays.open(el.customerModal, el.btnNewCustomer);
    });
    el.btnManageCustomers.addEventListener('click', () => {
      this.populateCustomerModalList();
      App.Overlays.open(el.customerModal, el.btnManageCustomers);
    });
    el.customerList.addEventListener('click', (e) => {
      const row = e.target.closest('.rg-customer-row');
      if (!row) return;
      const id = row.dataset.id;
      const customer = this.store.getCustomers().find((c) => c.id === id);
      if (!customer) return;
      if (e.target.closest('[data-action="edit-customer"]')) {
        this.fillCustomerForm(customer);
      } else if (e.target.closest('[data-action="delete-customer"]')) {
        if (!window.confirm(`Kunde "${customerName(customer)}" wirklich löschen?`)) return;
        this.store.saveCustomers(this.store.getCustomers().filter((c) => c.id !== id));
        this.renderCustomerOptions();
        this.populateCustomerModalList();
        App.Toast.show({ type: 'success', title: 'Kunde gelöscht', body: customerName(customer) });
      }
    });
    el.btnCustSave.addEventListener('click', () => this.saveCustomerFromModal());

    /* -- Einstellungen --------------------------------------------------------- */
    if (el.settingsTrigger) el.settingsTrigger.addEventListener('click', () => this.populateSettingsForm());
    el.btnSettingsSave.addEventListener('click', () => this.saveSettingsFromModal());
    el.btnExportData.addEventListener('click', () => this.exportData());
    el.btnImportTrigger.addEventListener('click', () => el.inputImportData.click());
    el.inputImportData.addEventListener('change', () => this.importDataFromFile());

    /* -- Historie ---------------------------------------------------------------- */
    el.historyBody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const inv = this.store.getInvoices().find((i) => i.id === tr.dataset.id);
      if (!inv) return;
      if (e.target.closest('[data-action="open-invoice"]')) {
        this.loadInvoiceIntoForm(inv);
        App.Toast.show({ type: 'info', title: 'Rechnung geladen', body: inv.number });
      } else if (e.target.closest('[data-action="duplicate-invoice"]')) {
        this.loadInvoiceIntoForm(inv);
        const s = this.state;
        s.savedId = null;
        s.date = todayISO();
        const settings = this.store.getSettings();
        s.dueDate = addDaysISO(s.date, settings.invoice.dueDays);
        s.dueDateAuto = true;
        s.numberAuto = true;
        this.regenerateNumber();
        this.renderPreview();
        App.Toast.show({ type: 'success', title: 'Rechnung dupliziert', body: `Neue Nummer: ${s.number}` });
      } else if (e.target.closest('[data-action="print-invoice"]')) {
        this.loadInvoiceIntoForm(inv);
        this.printInvoice();
      } else if (e.target.closest('[data-action="delete-invoice"]')) {
        if (!window.confirm(`Rechnung ${inv.number} wirklich aus der Historie löschen?`)) return;
        this.store.saveInvoices(this.store.getInvoices().filter((i) => i.id !== inv.id));
        if (this.state.savedId === inv.id) this.state.savedId = null;
        this.renderHistory();
        App.Toast.show({ type: 'success', title: 'Rechnung gelöscht', body: inv.number });
      }
    });
  },

  /* -- Dokument-Interaktion: gezielte Updates ohne Fokusverlust -------------- */
  handlePreviewInput(e) {
    const t = e.target;
    const val = (t.tagName === 'INPUT') ? t.value : t.innerText.replace(/\n+$/, '');

    if (t.dataset.item) {
      const item = this.state.items.find((i) => i.id === t.dataset.item);
      if (!item) return;
      item[t.dataset.field] = val;
      if (t.dataset.field === 'qty' || t.dataset.field === 'price') {
        const amtEl = document.getElementById('amt-' + item.id);
        if (amtEl) amtEl.textContent = fmtEUR((Number(item.qty) || 0) * (Number(item.price) || 0));
        this.updateTotalsDisplay();
      }
      return;
    }
    if (t.dataset.adj) {
      const adj = this.state.adjustments.find((a) => a.id === t.dataset.adj);
      if (!adj) return;
      adj[t.dataset.field] = val;
      if (t.dataset.field === 'amount') this.updateTotalsDisplay();
      return;
    }
    if (t.dataset.path) {
      const path = t.dataset.path;
      this.genericSet(path, val);
      if (path === 'number') {
        const titleEl = document.getElementById('title-number-mirror');
        if (titleEl) titleEl.textContent = val;
        if (this.state.purposeAuto) {
          this.state.pay.purpose = val;
          const pf = document.getElementById('pay-purpose-field');
          if (pf) pf.textContent = val;
        }
      } else if (path === 'editor') {
        const mirror = document.getElementById('signoff-editor-name');
        if (mirror) mirror.textContent = val;
      } else if (path === 'pay.purpose') {
        this.state.purposeAuto = false;
      } else if (path === 'vatRate') {
        this.updateTotalsDisplay();
      }
    }
  },

  handlePreviewChange(e) {
    const t = e.target;
    if (t.dataset.path === 'date') {
      this.state.date = t.value;
      if (this.state.dueDateAuto) {
        const settings = this.store.getSettings();
        this.state.dueDate = addDaysISO(this.state.date, settings.invoice.dueDays);
      }
      if (this.state.numberAuto) this.regenerateNumber();
      this.renderPreview();
    } else if (t.dataset.path === 'dueDate') {
      this.state.dueDate = t.value;
      this.state.dueDateAuto = false;
      this.renderPreview();
    }
  },

  handlePreviewClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const s = this.state;
    const action = btn.dataset.action;
    if (action === 'remove-item') {
      s.items = s.items.filter((i) => i.id !== btn.dataset.id);
      this.renderPreview();
    } else if (action === 'add-item') {
      s.items.push(this.newItemRow());
      this.renderPreview();
    } else if (action === 'remove-adjustment') {
      s.adjustments = s.adjustments.filter((a) => a.id !== btn.dataset.id);
      this.renderPreview();
    } else if (action === 'add-adjustment') {
      s.adjustments.push(this.newAdjustmentRow());
      this.renderPreview();
    } else if (action === 'regen-number') {
      this.regenerateNumber();
      this.renderPreview();
    } else if (action === 'toggle-tax-mode') {
      s.kleinunternehmer = !s.kleinunternehmer;
      this.renderPreview();
    }
  },

  /* -- Speichern / Drucken ------------------------------------------------------ */
  saveInvoice() {
    const s = this.state;
    if (!s.recipient || !s.recipient.trim()) {
      App.Toast.show({ type: 'warning', title: 'Empfänger fehlt', body: 'Bitte zuerst einen Kunden auswählen oder die Anschrift eintragen.' });
      return;
    }
    if (!s.items.some((i) => i.label && i.label.trim())) {
      App.Toast.show({ type: 'warning', title: 'Keine Positionen', body: 'Bitte mindestens eine Position mit Bezeichnung erfassen.' });
      return;
    }
    const totals = this.computeTotals();
    const record = {
      id: s.savedId || uid(),
      number: s.number,
      customerId: s.customerId,
      kundennummer: s.kundennummer,
      recipient: s.recipient,
      date: s.date,
      dueDate: s.dueDate,
      serviceNote: s.serviceNote,
      editor: s.editor,
      salutation: s.salutation,
      intro: s.intro,
      items: JSON.parse(JSON.stringify(s.items)),
      adjustments: JSON.parse(JSON.stringify(s.adjustments)),
      kleinunternehmer: s.kleinunternehmer,
      kleinText: s.kleinText,
      vatRate: s.vatRate,
      pay: { ...s.pay },
      closing: s.closing,
      total: totals.gross,
      createdAt: new Date().toISOString(),
    };
    const list = this.store.getInvoices();
    const idx = list.findIndex((x) => x.id === record.id);
    if (idx >= 0) list[idx] = record; else list.push(record);
    this.store.saveInvoices(list);
    s.savedId = record.id;
    this.renderHistory();
    App.Toast.show({ type: 'success', title: 'Rechnung gespeichert', body: record.number });
  },

  printInvoice() {
    this.el.printRoot.innerHTML = this.buildStaticInvoiceHTML();
    window.print();
  },

  loadInvoiceIntoForm(inv) {
    const s = this.state;
    s.savedId = inv.id;
    s.customerId = inv.customerId || '';
    s.kundennummer = inv.kundennummer || '';
    s.recipient = inv.recipient || '';
    s.number = inv.number; s.numberAuto = false;
    s.date = inv.date; s.dueDate = inv.dueDate; s.dueDateAuto = false;
    s.serviceNote = inv.serviceNote || 'Das Leistungsdatum entspricht dem Rechnungsdatum.';
    s.editor = inv.editor;
    s.salutation = inv.salutation;
    s.intro = inv.intro;
    s.items = JSON.parse(JSON.stringify(inv.items || []));
    s.adjustments = JSON.parse(JSON.stringify(inv.adjustments || []));
    s.kleinunternehmer = inv.kleinunternehmer;
    s.kleinText = inv.kleinText;
    s.vatRate = inv.vatRate;
    s.pay = { ...inv.pay };
    s.purposeAuto = false;
    s.closing = inv.closing;
    this.renderCustomerOptions();
    this.renderPreview();
  },

  renderHistory() {
    const invoices = this.store.getInvoices().slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
    if (!invoices.length) { this.el.historyBody.innerHTML = ''; this.el.historyEmpty.hidden = false; return; }
    this.el.historyEmpty.hidden = true;
    this.el.historyBody.innerHTML = invoices.map((inv) => `
      <tr data-id="${esc(inv.id)}">
        <td>${esc(inv.number)}</td>
        <td>${esc(firstLine(inv.recipient))}</td>
        <td>${fmtDateDE(inv.date)}</td>
        <td>${fmtEUR(inv.total)}</td>
        <td class="rg-history-actions">
          <button type="button" class="rg-icon-btn" data-action="open-invoice" title="Öffnen" aria-label="Rechnung öffnen"><span class="material-icons-outlined" aria-hidden="true">edit</span></button>
          <button type="button" class="rg-icon-btn" data-action="duplicate-invoice" title="Duplizieren" aria-label="Rechnung duplizieren"><span class="material-icons-outlined" aria-hidden="true">content_copy</span></button>
          <button type="button" class="rg-icon-btn" data-action="print-invoice" title="Als PDF" aria-label="Als PDF öffnen"><span class="material-icons-outlined" aria-hidden="true">picture_as_pdf</span></button>
          <button type="button" class="rg-icon-btn" data-action="delete-invoice" title="Löschen" aria-label="Rechnung löschen"><span class="material-icons-outlined" aria-hidden="true">delete</span></button>
        </td>
      </tr>`).join('');
  },

  /* -- Kundenverwaltung (gespeicherte Kundenliste) ---------------------------- */
  renderCustomerOptions() {
    const customers = this.store.getCustomers().slice().sort((a, b) => (Number(a.kundennummer) || 0) - (Number(b.kundennummer) || 0));
    const current = this.state.customerId;
    this.el.customer.innerHTML = '<option value="">— Kunde wählen —</option>' + customers.map((c) => `<option value="${esc(c.id)}">${esc(customerName(c))} (Kd.-Nr. ${esc(c.kundennummer)})</option>`).join('');
    this.el.customer.value = customers.some((c) => c.id === current) ? current : '';
  },

  populateCustomerModalList() {
    const customers = this.store.getCustomers().slice().sort((a, b) => (Number(a.kundennummer) || 0) - (Number(b.kundennummer) || 0));
    if (!customers.length) {
      this.el.customerList.innerHTML = '<p class="form-helper" style="margin:0;">Noch keine Kunden angelegt.</p>';
      return;
    }
    this.el.customerList.innerHTML = customers.map((c) => `
      <div class="rg-customer-row" data-id="${esc(c.id)}">
        <div>
          <div class="name">${esc(customerName(c))}</div>
          <div class="meta">Kd.-Nr. ${esc(c.kundennummer)}${c.ort ? ' · ' + esc(c.ort) : ''}</div>
        </div>
        <div class="actions">
          <button type="button" class="rg-icon-btn" data-action="edit-customer" aria-label="Kunde bearbeiten"><span class="material-icons-outlined" aria-hidden="true">edit</span></button>
          <button type="button" class="rg-icon-btn" data-action="delete-customer" aria-label="Kunde löschen"><span class="material-icons-outlined" aria-hidden="true">delete</span></button>
        </div>
      </div>`).join('');
  },

  resetCustomerForm() {
    const el = this.el;
    el.custId.value = '';
    el.custNumber.value = this.store.nextCustomerNumber();
    el.custAnrede.value = '';
    el.custFirma.value = '';
    el.custVorname.value = '';
    el.custNachname.value = '';
    el.custStrasse.value = '';
    el.custPlz.value = '';
    el.custOrt.value = '';
    el.custLand.value = 'Deutschland';
  },

  fillCustomerForm(c) {
    const el = this.el;
    el.custId.value = c.id;
    el.custNumber.value = c.kundennummer;
    el.custAnrede.value = c.anrede || '';
    el.custFirma.value = c.firma || '';
    el.custVorname.value = c.vorname || '';
    el.custNachname.value = c.nachname || '';
    el.custStrasse.value = c.strasse || '';
    el.custPlz.value = c.plz || '';
    el.custOrt.value = c.ort || '';
    el.custLand.value = c.land || 'Deutschland';
  },

  saveCustomerFromModal() {
    const el = this.el;
    const firma = el.custFirma.value.trim();
    const nachname = el.custNachname.value.trim();
    if (!firma && !nachname) {
      App.Toast.show({ type: 'warning', title: 'Angaben fehlen', body: 'Bitte mindestens Firma oder Nachname angeben.' });
      return;
    }
    const id = el.custId.value || uid();
    const customer = {
      id,
      kundennummer: Number(el.custNumber.value) || this.store.nextCustomerNumber(),
      anrede: el.custAnrede.value,
      firma,
      vorname: el.custVorname.value.trim(),
      nachname,
      strasse: el.custStrasse.value.trim(),
      plz: el.custPlz.value.trim(),
      ort: el.custOrt.value.trim(),
      land: el.custLand.value.trim() || 'Deutschland',
    };
    const list = this.store.getCustomers();
    const idx = list.findIndex((c) => c.id === id);
    if (idx >= 0) list[idx] = customer; else list.push(customer);
    this.store.saveCustomers(list);

    if (!this.state.customerId) {
      const s = this.state;
      s.customerId = customer.id;
      s.kundennummer = String(customer.kundennummer);
      s.recipient = composeRecipientText(customer);
      s.salutation = computeSalutation(customer);
      if (s.numberAuto) this.regenerateNumber();
      this.renderPreview();
    }

    this.renderCustomerOptions();
    this.populateCustomerModalList();
    this.resetCustomerForm();
    App.Toast.show({ type: 'success', title: 'Kunde gespeichert', body: customerName(customer) });
  },

  /* -- Einstellungen --------------------------------------------------------------- */
  populateSettingsForm() {
    const settings = this.store.getSettings();
    const el = this.el;
    el.setKicker1.value = settings.company.kicker1;
    el.setKicker2.value = settings.company.kicker2;
    el.setCompanyName.value = settings.company.name;
    el.setFullName.value = settings.company.fullName;
    el.setContactName.value = settings.company.contactName;
    el.setStreet.value = settings.company.street;
    el.setZip.value = settings.company.zip;
    el.setCity.value = settings.company.city;
    el.setCountry.value = settings.company.country;
    el.setTaxNumber.value = settings.company.taxNumber;
    el.setPhone.value = settings.company.phone;
    el.setEmail.value = settings.company.email;
    el.setWebsite.value = settings.company.website;
    el.setBankHolder.value = settings.bank.accountHolder;
    el.setBankName.value = settings.bank.bankName;
    el.setIban.value = settings.bank.iban;
    el.setBic.value = settings.bank.bic;
    el.setEditor.value = settings.invoice.editor;
    el.setDueDays.value = settings.invoice.dueDays;
    el.setKleinDefault.checked = settings.invoice.kleinunternehmer;
    el.setKleinText.value = settings.invoice.kleinunternehmerText;
    el.setVatRate.value = settings.invoice.vatRate;
    el.setIntro.value = settings.invoice.intro;
    el.setClosing.value = settings.invoice.closing;
  },

  saveSettingsFromModal() {
    const el = this.el;
    const prevPrefix = this.store.getSettings().invoice.numberPrefix;
    const settings = {
      company: {
        kicker1: el.setKicker1.value.trim(),
        kicker2: el.setKicker2.value.trim(),
        name: el.setCompanyName.value.trim(),
        fullName: el.setFullName.value.trim(),
        contactName: el.setContactName.value.trim(),
        street: el.setStreet.value.trim(),
        zip: el.setZip.value.trim(),
        city: el.setCity.value.trim(),
        country: el.setCountry.value.trim(),
        taxNumber: el.setTaxNumber.value.trim(),
        phone: el.setPhone.value.trim(),
        email: el.setEmail.value.trim(),
        website: el.setWebsite.value.trim(),
      },
      bank: {
        accountHolder: el.setBankHolder.value.trim(),
        bankName: el.setBankName.value.trim(),
        iban: el.setIban.value.trim(),
        bic: el.setBic.value.trim(),
      },
      invoice: {
        numberPrefix: prevPrefix,
        editor: el.setEditor.value.trim(),
        dueDays: Number(el.setDueDays.value) || 0,
        kleinunternehmer: el.setKleinDefault.checked,
        kleinunternehmerText: el.setKleinText.value,
        vatRate: Number(el.setVatRate.value) || 0,
        intro: el.setIntro.value,
        closing: el.setClosing.value,
      },
    };
    this.store.saveSettings(settings);
    App.Overlays.close(this.el.settingsModal);
    App.Toast.show({ type: 'success', title: 'Einstellungen gespeichert', body: 'Neue Rechnungen verwenden ab sofort diese Werte.' });
  },

  exportData() {
    const data = this.store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rechnungsgenerator-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    App.Toast.show({ type: 'success', title: 'Export erstellt', body: 'Die Sicherungsdatei wurde heruntergeladen.' });
  },

  importDataFromFile() {
    const input = this.el.inputImportData;
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!window.confirm('Import überschreibt Einstellungen, Kunden und die Rechnungshistorie. Fortfahren?')) return;
        this.store.importAll(data);
        this.populateSettingsForm();
        this.renderCustomerOptions();
        this.populateCustomerModalList();
        this.renderHistory();
        App.Toast.show({ type: 'success', title: 'Import abgeschlossen', body: 'Die Daten wurden übernommen.' });
      } catch (err) {
        App.Toast.show({ type: 'danger', title: 'Import fehlgeschlagen', body: 'Die Datei konnte nicht gelesen werden.' });
      } finally {
        input.value = '';
      }
    };
    reader.readAsText(file);
  },

  /* -- Vorlagen --------------------------------------------------------------------- */
  invoiceParts() {
    const s = this.state;
    const settings = this.store.getSettings();
    const t = this.computeTotals();
    const returnLine = `${settings.company.fullName} · ${settings.company.street} · ${settings.company.zip} ${settings.company.city}`;
    const footerLine1 = `${settings.company.fullName} · ${settings.company.contactName} · ${settings.company.street} · ${settings.company.zip} ${settings.company.city}`;
    return { s, settings, t, returnLine, footerLine1 };
  },

  renderPreview() {
    this.el.preview.innerHTML = this.buildEditableInvoiceHTML();
  },

  buildEditableInvoiceHTML() {
    const { s, settings, t, returnLine, footerLine1 } = this.invoiceParts();

    const itemsRows = s.items.map((it, idx) => `
      <tr data-id="${esc(it.id)}">
        <td>${idx + 1}</td>
        <td>
          <span class="ed ed-block" contenteditable="true" data-item="${esc(it.id)}" data-field="label" data-placeholder="Bezeichnung">${esc(it.label)}</span>
          <span class="ed ed-block item-sub" contenteditable="true" data-item="${esc(it.id)}" data-field="sub" data-placeholder="Zusatz (optional)">${esc(it.sub)}</span>
        </td>
        <td class="center"><input type="number" class="ed-num" min="0" step="0.01" data-item="${esc(it.id)}" data-field="qty" value="${esc(it.qty)}"></td>
        <td><span class="ed" contenteditable="true" data-item="${esc(it.id)}" data-field="unit" data-placeholder="–">${esc(it.unit)}</span></td>
        <td class="num"><input type="number" class="ed-num right" min="0" step="0.01" data-item="${esc(it.id)}" data-field="price" value="${esc(it.price)}"></td>
        <td class="num amount" id="amt-${esc(it.id)}">${fmtEUR((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>
        <td class="rg-del-cell no-print"><button type="button" class="rg-row-del" data-action="remove-item" data-id="${esc(it.id)}" aria-label="Position entfernen">✕</button></td>
      </tr>`).join('');

    const adjRows = s.adjustments.map((a) => `
      <div class="summary-row adj-row">
        <span class="ed" contenteditable="true" data-adj="${esc(a.id)}" data-field="label" data-placeholder="Bezeichnung">${esc(a.label)}</span>
        <span class="adj-amount-wrap">
          <input type="number" class="ed-num right" step="0.01" data-adj="${esc(a.id)}" data-field="amount" value="${esc(a.amount)}">
          <button type="button" class="rg-row-del no-print" data-action="remove-adjustment" data-id="${esc(a.id)}" aria-label="Zeile entfernen">✕</button>
        </span>
      </div>`).join('');

    const vatRows = s.kleinunternehmer ? '' : `
      <div class="summary-row"><span>Nettobetrag</span><span id="sum-net">${fmtEUR(t.netTotal)}</span></div>
      <div class="summary-row"><span>zzgl. <input type="number" class="ed-num tiny" min="0" max="100" step="0.5" data-path="vatRate" value="${esc(s.vatRate)}">% USt</span><span id="sum-vat">${fmtEUR(t.vat)}</span></div>`;

    const taxToggleLabel = s.kleinunternehmer ? 'Kleinunternehmerregelung — klicken für Regelbesteuerung' : 'Regelbesteuerung — klicken für Kleinunternehmerregelung';
    const noteBlock = s.kleinunternehmer
      ? `<div class="invoice-note ed ed-block" contenteditable="true" data-path="kleinText">${esc(s.kleinText)}</div>`
      : '';

    return `
<div class="invoice-sheet">
  <header class="invoice-header">
    <div>
      <div class="invoice-kicker">${esc(settings.company.kicker1)}<br>${esc(settings.company.kicker2)}</div>
      <div class="invoice-brand">${esc(settings.company.name)}</div>
    </div>
    <div class="invoice-sender-block">
      <span class="name">${esc(settings.company.contactName)}</span>
      <div>${esc(settings.company.street)}</div>
      <div>${esc(settings.company.zip)} ${esc(settings.company.city)}</div>
      <div>${esc(settings.company.country)}</div>
      <div>Tel. ${esc(settings.company.phone)}</div>
      <div>${esc(settings.company.email)}</div>
      <div>${esc(settings.company.website)}</div>
    </div>
  </header>
  <div class="invoice-hr"></div>

  <div class="invoice-meta-row">
    <div style="min-width:0; flex:1;">
      <div class="invoice-return-line">${esc(returnLine)}</div>
      <div class="invoice-recipient-block ed ed-block" contenteditable="true" data-path="recipient" data-placeholder="Name und Anschrift des Kunden">${escMultiline(s.recipient)}</div>
    </div>
    <div class="invoice-facts">
      <div class="fact-row"><span>Rechnungsnummer</span><span><strong class="ed" contenteditable="true" data-path="number">${esc(s.number)}</strong> <button type="button" class="rg-mini-btn no-print" data-action="regen-number" title="Neu vergeben">↻</button></span></div>
      <div class="fact-row"><span>Rechnungsdatum</span><input type="date" class="ed-date" data-path="date" value="${esc(s.date)}"></div>
      <div class="fact-row"><span>Fällig am</span><input type="date" class="ed-date" data-path="dueDate" value="${esc(s.dueDate)}"></div>
      <div class="fact-row"><span>Kundennummer</span><strong class="ed" contenteditable="true" data-path="kundennummer" data-placeholder="–">${esc(s.kundennummer)}</strong></div>
      <div class="fact-row"><span>Bearbeiter</span><strong class="ed" contenteditable="true" data-path="editor">${esc(s.editor)}</strong></div>
    </div>
  </div>

  <h1 class="invoice-title">Rechnung Nr. <span id="title-number-mirror">${esc(s.number)}</span></h1>
  <p class="invoice-service-note ed ed-block" contenteditable="true" data-path="serviceNote">${esc(s.serviceNote)}</p>

  <p class="invoice-salutation ed ed-block" contenteditable="true" data-path="salutation">${esc(s.salutation)}</p>
  <p class="invoice-intro ed ed-block" contenteditable="true" data-path="intro">${escMultiline(s.intro)}</p>

  <table class="invoice-items">
    <thead>
      <tr>
        <th>Pos.</th>
        <th>Bezeichnung</th>
        <th class="center">Menge</th>
        <th>Einheit</th>
        <th class="num">Einzelpreis</th>
        <th class="num">Betrag</th>
        <th class="no-print"></th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
  </table>
  <button type="button" class="rg-add-link no-print" data-action="add-item">+ Position hinzufügen</button>

  <div class="invoice-summary" id="summary-block">
    <div class="summary-row"><span>Zwischensumme</span><span id="sum-subtotal">${fmtEUR(t.subtotal)}</span></div>
    ${adjRows}
    <div class="summary-row total"><span>Gesamtbetrag</span><span id="sum-total">${fmtEUR(t.gross)}</span></div>
  </div>
  <div style="text-align:right; margin-top:2px;">
    <button type="button" class="rg-add-link no-print" data-action="add-adjustment">+ Zuschlag/Abzug</button>
  </div>
  <div id="vat-rows">${vatRows}</div>

  <p class="no-print" style="margin:14px 0 0;">
    <button type="button" class="rg-mini-btn" data-action="toggle-tax-mode" title="${esc(taxToggleLabel)}">%</button>
    <span style="font-size:11px; color:var(--inv-gray-light); margin-left:6px;">${esc(taxToggleLabel)}</span>
  </p>
  ${noteBlock}

  <div class="invoice-payment">
    <div class="payment-title">Zahlungsinformationen</div>
    <div class="payment-grid">
      <div><span class="p-label">Kontoinhaber</span><strong class="ed" contenteditable="true" data-path="pay.holder">${esc(s.pay.holder)}</strong></div>
      <div><span class="p-label">Kreditinstitut</span><strong class="ed" contenteditable="true" data-path="pay.bank">${esc(s.pay.bank)}</strong></div>
      <div><span class="p-label">IBAN</span><strong class="ed" contenteditable="true" data-path="pay.iban">${esc(s.pay.iban)}</strong></div>
      <div><span class="p-label">BIC</span><strong class="ed" contenteditable="true" data-path="pay.bic">${esc(s.pay.bic)}</strong></div>
      <div><span class="p-label">Verwendungszweck</span><strong class="ed" contenteditable="true" data-path="pay.purpose" id="pay-purpose-field">${esc(s.pay.purpose)}</strong></div>
    </div>
    <p class="payment-sentence">Bitte überweisen Sie den Gesamtbetrag von <strong id="pay-total-amount">${fmtEUR(t.gross)}</strong> bis zum <strong id="pay-due-date-text">${fmtDateDE(s.dueDate)}</strong> ohne Abzug auf das oben genannte Konto.</p>
  </div>

  <p class="invoice-closing ed ed-block" contenteditable="true" data-path="closing">${escMultiline(s.closing)}</p>
  <p class="invoice-signoff">Mit freundlichen Grüßen<br><strong id="signoff-editor-name">${esc(s.editor)}</strong></p>

  <footer class="invoice-footer">
    <div class="line1">${esc(footerLine1)}</div>
    <div>${esc(settings.company.phone)} · ${esc(settings.company.email)} · ${esc(settings.company.website)}</div>
    <div>St.-Nr. ${esc(settings.company.taxNumber)} · ${esc(s.pay.bank)} · IBAN ${esc(s.pay.iban)}</div>
  </footer>
</div>`;
  },

  buildStaticInvoiceHTML() {
    const { s, settings, t, returnLine, footerLine1 } = this.invoiceParts();

    const itemsRows = s.items.map((it, idx) => {
      const amount = (Number(it.qty) || 0) * (Number(it.price) || 0);
      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${esc(it.label)}${it.sub ? `<div class="item-sub">${esc(it.sub)}</div>` : ''}</td>
          <td class="center">${fmtNum(it.qty)}</td>
          <td>${esc(it.unit)}</td>
          <td class="num">${fmtEUR(it.price)}</td>
          <td class="num amount">${fmtEUR(amount)}</td>
        </tr>`;
    }).join('');

    const summaryRows = [`<div class="summary-row"><span>Zwischensumme</span><span>${fmtEUR(t.subtotal)}</span></div>`];
    s.adjustments.forEach((a) => {
      const amt = Number(a.amount) || 0;
      summaryRows.push(`<div class="summary-row"><span>${esc(a.label || 'Position')}</span><span>${amt < 0 ? '− ' : ''}${fmtEUR(Math.abs(amt))}</span></div>`);
    });
    if (!s.kleinunternehmer) {
      summaryRows.push(`<div class="summary-row"><span>Nettobetrag</span><span>${fmtEUR(t.netTotal)}</span></div>`);
      summaryRows.push(`<div class="summary-row"><span>zzgl. ${fmtNum(s.vatRate)}% USt</span><span>${fmtEUR(t.vat)}</span></div>`);
    }
    summaryRows.push(`<div class="summary-row total"><span>Gesamtbetrag</span><span>${fmtEUR(t.gross)}</span></div>`);

    const noteBlock = s.kleinunternehmer ? `<div class="invoice-note">${esc(s.kleinText)}</div>` : '';

    return `
<div class="invoice-sheet">
  <header class="invoice-header">
    <div>
      <div class="invoice-kicker">${esc(settings.company.kicker1)}<br>${esc(settings.company.kicker2)}</div>
      <div class="invoice-brand">${esc(settings.company.name)}</div>
    </div>
    <div class="invoice-sender-block">
      <span class="name">${esc(settings.company.contactName)}</span>
      <div>${esc(settings.company.street)}</div>
      <div>${esc(settings.company.zip)} ${esc(settings.company.city)}</div>
      <div>${esc(settings.company.country)}</div>
      <div>Tel. ${esc(settings.company.phone)}</div>
      <div>${esc(settings.company.email)}</div>
      <div>${esc(settings.company.website)}</div>
    </div>
  </header>
  <div class="invoice-hr"></div>

  <div class="invoice-meta-row">
    <div>
      <div class="invoice-return-line">${esc(returnLine)}</div>
      <div class="invoice-recipient-block">${escMultiline(s.recipient)}</div>
    </div>
    <div class="invoice-facts">
      <div class="fact-row"><span>Rechnungsnummer</span><strong>${esc(s.number)}</strong></div>
      <div class="fact-row"><span>Rechnungsdatum</span><strong>${fmtDateDE(s.date)}</strong></div>
      <div class="fact-row"><span>Fällig am</span><strong>${fmtDateDE(s.dueDate)}</strong></div>
      <div class="fact-row"><span>Kundennummer</span><strong>${esc(s.kundennummer || '—')}</strong></div>
      <div class="fact-row"><span>Bearbeiter</span><strong>${esc(s.editor)}</strong></div>
    </div>
  </div>

  <h1 class="invoice-title">Rechnung Nr. ${esc(s.number)}</h1>
  <p class="invoice-service-note">${esc(s.serviceNote)}</p>

  <p class="invoice-salutation">${esc(s.salutation)}</p>
  <p class="invoice-intro">${escMultiline(s.intro)}</p>

  <table class="invoice-items">
    <thead>
      <tr>
        <th>Pos.</th>
        <th>Bezeichnung</th>
        <th class="center">Menge</th>
        <th>Einheit</th>
        <th class="num">Einzelpreis</th>
        <th class="num">Betrag</th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
  </table>

  <div class="invoice-summary">${summaryRows.join('')}</div>

  ${noteBlock}

  <div class="invoice-payment">
    <div class="payment-title">Zahlungsinformationen</div>
    <div class="payment-grid">
      <div><span class="p-label">Kontoinhaber</span><strong>${esc(s.pay.holder)}</strong></div>
      <div><span class="p-label">Kreditinstitut</span><strong>${esc(s.pay.bank)}</strong></div>
      <div><span class="p-label">IBAN</span><strong>${esc(s.pay.iban)}</strong></div>
      <div><span class="p-label">BIC</span><strong>${esc(s.pay.bic)}</strong></div>
      <div><span class="p-label">Verwendungszweck</span><strong>${esc(s.pay.purpose)}</strong></div>
    </div>
    <p class="payment-sentence">Bitte überweisen Sie den Gesamtbetrag von ${fmtEUR(t.gross)} bis zum ${fmtDateDE(s.dueDate)} ohne Abzug auf das oben genannte Konto.</p>
  </div>

  <p class="invoice-closing">${escMultiline(s.closing)}</p>
  <p class="invoice-signoff">Mit freundlichen Grüßen<br><strong>${esc(s.editor)}</strong></p>

  <footer class="invoice-footer">
    <div class="line1">${esc(footerLine1)}</div>
    <div>${esc(settings.company.phone)} · ${esc(settings.company.email)} · ${esc(settings.company.website)}</div>
    <div>St.-Nr. ${esc(settings.company.taxNumber)} · ${esc(s.pay.bank)} · IBAN ${esc(s.pay.iban)}</div>
  </footer>
</div>`;
  },
});
