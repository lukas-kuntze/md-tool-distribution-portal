/* =============================================================================
   App core  ·  Kuntze IT Engineering UI
   -----------------------------------------------------------------------------
   Framework-free behaviour layer. Every interactive pattern is a self-contained
   module registered on the global `App` namespace and started once on
   DOMContentLoaded. This mirrors the architecture documented in the
   "Verhalten & Interaktion" section of the styleguide.

   Load order (see index.html): app.js first, then scripts/modules/*.js, which
   call App.register(...). No bundler required — plain <script> tags.

   Add a module:
     App.register('MyThing', {
       init() { ... }   // called once by App.init()
     });
   ========================================================================== */

window.App = {
  /** Central config shared across modules. */
  MOBILE_BREAKPOINT: 768,
  TOAST_DELAY: 5000,

  /** Registered modules, in registration order. */
  _modules: [],

  /**
   * Register a behaviour module. `name` is exposed as App[name] for
   * programmatic access (e.g. App.Toast.show(...)).
   */
  register(name, module) {
    this[name] = module;
    this._modules.push({ name, module });
    return module;
  },

  /** Initialise every registered module exactly once. */
  init() {
    this._modules.forEach(({ name, module }) => {
      if (typeof module.init !== 'function') return;
      try {
        module.init();
      } catch (err) {
        // A single failing module must not break the rest of the page.
        console.error(`[App] Modul "${name}" konnte nicht initialisiert werden:`, err);
      }
    });
  },

  /** True when the user has requested reduced motion. */
  prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  },
};

document.addEventListener('DOMContentLoaded', () => window.App.init());
