import type { CurrentUserDto, GlobalCapabilitiesDto } from '../../../shared/types/api.js';
import { ApiError } from '../../services/api-client.js';
import { currentUser, SHELL_CACHE_KEY, signOut } from '../../services/session-service.js';
import { App } from '../core/app.js';
import { describeError } from '../core/messages.js';
import { Theme } from './theme.js';
import { Toast } from './toast.js';

/**
 * App shell: page title in the topbar, active navigation entry, the signed-in user and sign-out. Navigation
 * entries with `data-requires="<capability>"` stay hidden unless the user has that global capability; the API
 * checks every action anyway, hiding is only for orientation.
 */
export const Shell = App.register('Shell', {
  async init(): Promise<void> {
    const title = document.querySelector('[data-page-title]');

    if (title === null) {
      return;
    }

    title.textContent = document.body.dataset['title'] ?? '';

    for (const item of document.querySelectorAll<HTMLElement>('[data-nav-item]')) {
      const active = item.dataset['navItem'] === document.body.dataset['nav'];
      item.classList.toggle('active', active);

      if (active) {
        item.setAttribute('aria-current', 'page');
      }
    }

    document.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('[data-sign-out]') !== null) {
        signOut().catch((error: unknown) => Toast.show('danger', 'Abmelden fehlgeschlagen', describeError(error)));
      }
    });

    try {
      const user = await currentUser();
      Theme.fromAccount(user.preferences.theme);

      for (const name of document.querySelectorAll('[data-user-name]')) {
        name.textContent = user.displayName;
      }

      for (const login of document.querySelectorAll('[data-user-login]')) {
        login.textContent = user.login === null ? '' : `@${user.login}`;
      }

      showAvatar(user.avatarUrl);

      for (const item of document.querySelectorAll<HTMLElement>('[data-requires]')) {
        // Several capabilities separated by spaces: any one of them is enough.
        const capabilities = (item.dataset['requires'] ?? '').split(' ') as (keyof GlobalCapabilitiesDto)[];
        item.hidden = !capabilities.some((capability) => user.capabilities[capability]);
      }

      rememberShell(user);
    } catch (error) {
      // Without a session the API client already redirects to the login page.
      if (!(error instanceof ApiError && error.status === 401)) {
        Toast.show('danger', 'Sitzung konnte nicht geladen werden', describeError(error));
      }
    }
  },
});

/**
 * The GitHub profile picture instead of the generic icon. It is loaded from GitHub directly, without referrer;
 * when there is none or it fails to load (e.g. on a private GitHub Enterprise host), the icon stays.
 */
function showAvatar(url: string | null): void {
  const avatar = document.querySelector<HTMLImageElement>('[data-user-avatar]');
  const fallback = document.querySelector<HTMLElement>('[data-user-avatar-fallback]');

  if (avatar === null || url === null || !url.startsWith('https://')) {
    return;
  }

  avatar.addEventListener('load', () => {
    avatar.hidden = false;

    if (fallback !== null) {
      fallback.hidden = true;
    }
  });
  avatar.src = url;
}

/**
 * Remembers what the shell showed, so that the next page paints the same navigation and user before the
 * modules load instead of flickering. Only visibility depends on it; the server checks every action.
 */
function rememberShell(user: CurrentUserDto): void {
  try {
    sessionStorage.setItem(
      SHELL_CACHE_KEY,
      JSON.stringify({
        displayName: user.displayName,
        login: user.login,
        avatarUrl: user.avatarUrl,
        capabilities: user.capabilities,
      }),
    );
  } catch {
    // Storage blocked: every page then fills the shell in after loading, as before.
  }
}
