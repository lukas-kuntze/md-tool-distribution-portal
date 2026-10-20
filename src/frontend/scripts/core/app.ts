/**
 * App registry of the styleguide, typed. Every interaction pattern is a module that registers itself here when
 * `main.ts` imports it; `App.start()` initialises all of them once the document is ready. A module does nothing
 * when its markup is missing on the current page, and a failing module never stops the others.
 */
export interface AppModule {
  init(): void | Promise<void>;
}

interface Registration {
  readonly name: string;
  readonly module: AppModule;
}

const registrations: Registration[] = [];

export const App = {
  MOBILE_BREAKPOINT: 768,
  TOAST_DELAY: 5000,

  register<Module extends AppModule>(name: string, module: Module): Module {
    registrations.push({ name, module });
    return module;
  },

  /** Initialises every registered module; resolves once all of them have finished, failed ones included. */
  async init(): Promise<void> {
    await Promise.all(
      registrations.map(async ({ name, module }) => {
        try {
          await module.init();
        } catch (error) {
          reportError(new Error(`Modul "${name}" konnte nicht initialisiert werden.`, { cause: error }));
        }
      }),
    );
  },

  start(): void {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => void App.init(), { once: true });
    } else {
      void App.init();
    }
  },

  prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  },
};
