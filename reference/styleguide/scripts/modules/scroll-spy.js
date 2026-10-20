/* =============================================================================
   App.ScrollSpy · highlights the sidebar link of the section in view.
   ========================================================================== */

App.register('ScrollSpy', {
  init() {
    const links = document.querySelectorAll('.sidebar-nav .nav-item');
    const sections = Array.from(document.querySelectorAll('main section[id]'));
    if (!links.length || !sections.length) return;

    const byId = {};
    links.forEach((l) => {
      const href = l.getAttribute('href') || '';
      if (href.startsWith('#')) byId[href.slice(1)] = l;
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((l) => l.classList.remove('active'));
          const link = byId[entry.target.id];
          if (link) link.classList.add('active');
        });
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 }
    );

    sections.forEach((s) => observer.observe(s));
  },
});
