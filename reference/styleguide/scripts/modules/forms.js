/* =============================================================================
   App.Forms · delegated form behaviour.
   -----------------------------------------------------------------------------
   Uses ONE delegated click listener on the document (not per element), so it
   also covers fields added later. Documented standard patterns:
     • .password-toggle       → switches an input between password ↔ text
     • .action-btn.delete     → opens the confirmation modal (#demo-modal) before
                                a destructive action runs
   ========================================================================== */

App.register('Forms', {
  init() {
    document.addEventListener('click', (e) => {
      this.handlePasswordToggle(e);
      this.handleDeleteConfirmation(e);
    });
  },

  handlePasswordToggle(e) {
    const btn = e.target.closest('.password-toggle');
    if (!btn) return;
    const input = btn.closest('.input-group')?.querySelector('input');
    if (!input) return;

    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    const icon = btn.querySelector('.material-icons-outlined');
    if (icon) icon.textContent = reveal ? 'visibility_off' : 'visibility';
    btn.setAttribute('aria-label', reveal ? 'Passwort verbergen' : 'Passwort anzeigen');
    btn.setAttribute('aria-pressed', String(reveal));
  },

  handleDeleteConfirmation(e) {
    const btn = e.target.closest('.action-btn.delete');
    if (!btn) return;
    e.preventDefault();
    const modal = document.getElementById('demo-modal');
    if (modal && App.Overlays) {
      App.Overlays.open(modal, btn);
    }
  },
});
