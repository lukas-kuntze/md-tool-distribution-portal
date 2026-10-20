/* =============================================================================
   App.Accordion · collapsible sections.
   -----------------------------------------------------------------------------
   One delegated click listener per [data-accordion] container. Each
   .accordion-trigger toggles its panel (referenced via aria-controls) and keeps
   aria-expanded in sync. Add `data-accordion-single` to the container to keep
   at most one panel open at a time.
   ========================================================================== */

App.register('Accordion', {
  init() {
    document.querySelectorAll('[data-accordion]').forEach((acc) => {
      acc.addEventListener('click', (e) => {
        const trigger = e.target.closest('.accordion-trigger');
        if (trigger && acc.contains(trigger)) this.toggle(acc, trigger);
      });
    });
  },

  toggle(acc, trigger) {
    const expanded = trigger.getAttribute('aria-expanded') === 'true';
    const panel = document.getElementById(trigger.getAttribute('aria-controls'));

    // Single-open mode: collapse any sibling before opening this one.
    if (acc.hasAttribute('data-accordion-single') && !expanded) {
      acc.querySelectorAll('.accordion-trigger[aria-expanded="true"]').forEach((t) => {
        t.setAttribute('aria-expanded', 'false');
        const p = document.getElementById(t.getAttribute('aria-controls'));
        if (p) p.hidden = true;
      });
    }

    trigger.setAttribute('aria-expanded', String(!expanded));
    if (panel) panel.hidden = expanded;
  },
});
