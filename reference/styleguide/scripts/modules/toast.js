/* =============================================================================
   App.Toast · non-blocking notifications. Auto-dismiss after App.TOAST_DELAY.
   Programmatic use:  App.Toast.show('success')  or
                      App.Toast.show({ type: 'info', title: '…', body: '…' })
   ========================================================================== */

App.register('Toast', {
  TEMPLATES: {
    success: { title: 'Erfolgreich gespeichert', body: 'Die Änderungen wurden übernommen.' },
    danger:  { title: 'Vorgang fehlgeschlagen', body: 'Die Verbindung zum Server ist unterbrochen.' },
    warning: { title: 'Bitte prüfen', body: 'Einige Felder enthalten Platzhalterwerte.' },
    info:    { title: 'Hinweis', body: 'Ein neues Update ist verfügbar.' },
  },

  init() {
    this.stack = document.querySelector('[data-toast-stack]');
    document.querySelectorAll('[data-toast-trigger]').forEach((btn) => {
      btn.addEventListener('click', () => this.show(btn.getAttribute('data-toast-trigger')));
    });
  },

  /** Accepts a type string ('success' | 'danger' | 'warning' | 'info') or an
   *  options object { type, title, body }. */
  show(input) {
    if (!this.stack) return;
    const opts = typeof input === 'string' ? { type: input } : input || {};
    const type = opts.type || 'info';
    const tpl = this.TEMPLATES[type] || this.TEMPLATES.info;
    const title = opts.title || tpl.title;
    const body = opts.body || tpl.body;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    // No per-toast role: the stack is an aria-live="polite" region and already
    // announces each inserted toast. A role="status" here would make the same
    // message be read twice. (RECOMMENDATIONS: Toast-Doppelansage vermeiden)

    const content = document.createElement('div');
    content.style.flex = '1';
    const titleEl = document.createElement('div');
    titleEl.className = 'toast-title';
    titleEl.textContent = title;
    const bodyEl = document.createElement('div');
    bodyEl.className = 'toast-body';
    bodyEl.textContent = body;
    content.append(titleEl, bodyEl);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Schließen');
    close.innerHTML = '&times;';
    close.addEventListener('click', () => toast.remove());

    toast.append(content, close);
    this.stack.appendChild(toast);
    window.setTimeout(() => toast.remove(), App.TOAST_DELAY);
  },
});
