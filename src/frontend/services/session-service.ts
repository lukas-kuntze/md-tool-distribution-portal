import type { CurrentUserDto } from '../../shared/types/api.js';
import { api, LOGIN_PAGE } from './api-client.js';

let current: Promise<CurrentUserDto> | null = null;

/** The signed-in user, loaded once per page and shared by all modules. */
export function currentUser(): Promise<CurrentUserDto> {
  current ??= api.get<CurrentUserDto>('/api/session');
  return current;
}

export async function signOut(): Promise<void> {
  await api.post<undefined>('/api/session/sign-out');
  window.location.assign(LOGIN_PAGE);
}

/** Forgets the loaded user; for tests that switch between users. */
export function resetSession(): void {
  current = null;
}

/** Key of the tab's shell cache: written by the Shell module, read by the inline script in `partials/shell-start.html`. */
export const SHELL_CACHE_KEY = 'md-shell';

/** Forgets the cached shell, so that the next person signing in in this tab never sees the previous one. */
export function forgetShell(): void {
  try {
    sessionStorage.removeItem(SHELL_CACHE_KEY);
  } catch {
    // Storage blocked: nothing was stored.
  }
}
