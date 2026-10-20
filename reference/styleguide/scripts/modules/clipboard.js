/* =============================================================================
   App.Clipboard · copy-to-clipboard for code snippets ([data-copy] button).
   ========================================================================== */

App.register('Clipboard', {
  init() {
    document.querySelectorAll('.snippet').forEach((snippet) => {
      const btn = snippet.querySelector('[data-copy]');
      const code = snippet.querySelector('pre.code');
      if (!btn || !code) return;

      btn.addEventListener('click', async () => {
        const original = btn.textContent;
        try {
          await navigator.clipboard.writeText(code.innerText);
          btn.textContent = 'Kopiert';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove('copied');
          }, 1600);
        } catch (e) {
          btn.textContent = 'Fehler';
          setTimeout(() => { btn.textContent = original; }, 1600);
        }
      });
    });
  },
});
