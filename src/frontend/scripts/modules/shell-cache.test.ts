import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SHELL_CACHE_KEY } from '../../services/session-service.js';
import { fakeApi, loadPage, textOf, user } from '../testing/page.js';
import { LoginPage } from './login-page.js';
import { Shell } from './shell.js';

/** The inline script of the shell partial; `loadPage` strips scripts, so the test runs it itself. */
const prepaint = ((): string => {
  const partial = readFileSync(path.resolve(import.meta.dirname, '../../partials/shell-start.html'), 'utf8');
  return /<script>([\s\S]*?)<\/script>/.exec(partial)?.[1] ?? '';
})();

const hidden = (selector: string): boolean => document.querySelector<HTMLElement>(selector)?.hidden === true;

/** Runs the inline script as the browser does while parsing the page. */
function runPrepaint(): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- executes the page's own inline script under test
  const run = new Function(prepaint) as () => void;
  run();
}

describe('shell without flicker', (): void => {
  beforeEach((): void => {
    sessionStorage.clear();
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('remembers the shell after loading the session', async (): Promise<void> => {
    loadPage('audit');
    fakeApi({ 'GET /api/session': { ...user({ manageStorage: false }), avatarUrl: 'https://avatars.example/1' } });

    await Shell.init();

    expect(JSON.parse(sessionStorage.getItem(SHELL_CACHE_KEY) ?? 'null')).toMatchObject({
      displayName: 'Ada Admin',
      login: 'ada',
      avatarUrl: 'https://avatars.example/1',
      capabilities: { readAudit: true, manageStorage: false },
    });
  });

  it('paints title, active entry, user and allowed entries before the modules load', (): void => {
    loadPage('access');
    sessionStorage.setItem(
      SHELL_CACHE_KEY,
      JSON.stringify({
        displayName: 'Ada Admin',
        login: 'ada',
        avatarUrl: 'https://avatars.example/1',
        capabilities: { ...user().capabilities, manageStorage: false, manageSettings: true },
      }),
    );

    runPrepaint();

    expect(textOf('[data-page-title]')).toBe('Zugriffsverwaltung');
    expect(document.querySelector('[data-nav-item="access"]')?.classList.contains('active')).toBe(true);
    expect(document.querySelector('[data-nav-item="access"]')?.getAttribute('aria-current')).toBe('page');
    expect(hidden('[data-nav-item="audit"]')).toBe(false);
    expect(hidden('[data-nav-item="storage"]')).toBe(true);
    // Several capabilities: one of them is enough.
    expect(hidden('[data-nav-item="settings"]')).toBe(false);
    expect(textOf('[data-user-name]')).toBe('Ada Admin');
    expect(textOf('[data-user-login]')).toBe('@ada');
    expect(document.querySelector('[data-user-avatar]')?.getAttribute('src')).toBe('https://avatars.example/1');
    expect(hidden('[data-user-avatar-fallback]')).toBe(true);
  });

  it('marks only the active entry when nothing is cached yet', (): void => {
    loadPage('audit');

    runPrepaint();

    expect(document.querySelector('[data-nav-item="audit"]')?.classList.contains('active')).toBe(true);
    expect(hidden('[data-nav-item="audit"]')).toBe(true);
    expect(textOf('[data-user-name]')).toBe('Angemeldet');
  });

  it('forgets the shell on the login page', (): void => {
    sessionStorage.setItem(SHELL_CACHE_KEY, '{}');
    loadPage('login');

    LoginPage.init();

    expect(sessionStorage.getItem(SHELL_CACHE_KEY)).toBeNull();
  });
});
