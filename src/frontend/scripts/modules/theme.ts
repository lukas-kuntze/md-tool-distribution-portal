import type { PreferencesDto } from '../../../shared/types/api.js';
import { account } from '../../services/account-service.js';
import { App } from '../core/app.js';

const KEY = 'kuntze-theme';

type ThemeName = 'light' | 'dark';
type ThemeChoice = PreferencesDto['theme'];

/** Set once the signed-in account is known; only then is a choice saved for the account, too. */
let accountKnown = false;

/**
 * Light/dark mode of the styleguide. Light is the default; the choice is kept in `localStorage` and applied
 * before the first paint by the inline script of the `head` partial. For signed-in people it is also saved for
 * the account ("Mein Konto"), so it follows them to other browsers; `system` follows the device.
 */
export const Theme = App.register('Theme', {
  init(): void {
    document.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('[data-theme-toggle]') !== null) {
        const theme = Theme.current() === 'dark' ? 'light' : 'dark';
        Theme.choose(theme);

        if (accountKnown) {
          // Not worth an error message: the choice still applies in this browser.
          account.savePreferences({ theme }).catch(() => undefined);
        }
      }
    });

    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (stored() === 'system') {
        Theme.choose('system');
      }
    });
    Theme.sync();
  },

  current(): ThemeName {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  },

  /** Applies and remembers a choice in this browser. */
  choose(choice: ThemeChoice): void {
    document.documentElement.setAttribute('data-theme', resolve(choice));

    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Storage may be blocked; the choice then lasts for this page only.
    }

    Theme.sync();
  },

  /** Takes over the choice saved for the account, once the session is loaded. */
  fromAccount(choice: ThemeChoice): void {
    accountKnown = true;

    if (choice !== stored()) {
      Theme.choose(choice);
    }
  },

  sync(): void {
    const dark = Theme.current() === 'dark';

    for (const toggle of document.querySelectorAll('[data-theme-toggle]')) {
      toggle.setAttribute('aria-pressed', String(dark));

      const icon = toggle.querySelector('.material-icons-outlined');
      const label = toggle.querySelector('[data-theme-label]');

      if (icon !== null) {
        icon.textContent = dark ? 'light_mode' : 'dark_mode';
      }

      if (label !== null) {
        label.textContent = dark ? 'Hell' : 'Dunkel';
      }
    }
  },
});

function resolve(choice: ThemeChoice): ThemeName {
  if (choice !== 'system') {
    return choice;
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true ? 'dark' : 'light';
}

function stored(): ThemeChoice | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : null;
  } catch {
    return null;
  }
}
