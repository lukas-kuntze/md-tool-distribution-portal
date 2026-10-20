import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../core/app.js';
import { apiError, click, fakeApi, loadPage, respond, stubNavigation, textOf, user } from '../testing/page.js';
import { Clipboard } from './clipboard.js';
import { Dropdown } from './dropdown.js';
import { LoginPage } from './login-page.js';
import { Overlays } from './overlays.js';
import { Shell } from './shell.js';
import { Tabs } from './tabs.js';
import { Theme } from './theme.js';
import { Toast } from './toast.js';

const key = (target: Element, name: string, shiftKey = false): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, shiftKey }));
};

describe('styleguide interaction modules', (): void => {
  beforeAll((): void => {
    Overlays.init();
    Tabs.init();
    Dropdown.init();
    Theme.init();
    Clipboard.init();
  });

  beforeEach((): void => {
    loadPage('project', '/project.html?id=x');
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens and closes overlays by attribute, backdrop and Escape and returns focus', (): void => {
    const trigger = document.createElement('button');
    trigger.setAttribute('data-modal-open', 'project-archive');
    document.querySelector('.content')?.append(trigger);
    trigger.focus();

    click(trigger);
    const overlay = document.querySelector<HTMLElement>('#project-archive');
    expect(overlay?.hidden).toBe(false);
    expect(document.body.classList.contains('has-overlay')).toBe(true);
    expect(document.activeElement?.textContent).toBe('Abbrechen');
    expect(document.querySelector<HTMLElement>('.app')?.inert).toBe(true);

    key(document.body, 'Escape');
    expect(overlay?.hidden).toBe(true);
    expect(document.body.classList.contains('has-overlay')).toBe(false);
    expect(document.activeElement).toBe(trigger);

    Overlays.open(overlay ?? null);
    overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay?.hidden).toBe(true);

    Overlays.open(document.querySelector('#project-edit'));
    expect(document.activeElement?.id).toBe('project-edit-name');
    key(document.body, 'Tab');
    Overlays.close(document.querySelector('#project-edit'));
  });

  it('moves between visible tabs with the keyboard', (): void => {
    const group = document.querySelector<HTMLElement>('[data-tab-group]');
    const changes: string[] = [];
    group?.addEventListener('tabs:change', (event) => changes.push((event as CustomEvent<string>).detail));
    document.querySelector<HTMLElement>('#tab-audit')!.hidden = false;

    const first = document.querySelector<HTMLElement>('#tab-applications');
    first?.focus();
    key(first as HTMLElement, 'ArrowRight');
    expect(document.activeElement?.id).toBe('tab-audit');
    expect(document.querySelector<HTMLElement>('#panel-audit')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('#panel-applications')?.hidden).toBe(true);

    key(document.activeElement as HTMLElement, 'Home');
    expect(document.activeElement?.id).toBe('tab-applications');
    key(document.activeElement as HTMLElement, 'End');
    key(document.activeElement as HTMLElement, 'x');
    expect(changes).toEqual(['panel-audit', 'panel-applications', 'panel-audit']);
    expect(document.querySelector('#tab-access')?.getAttribute('tabindex')).toBe('-1');
  });

  it('opens menus by click and keyboard and closes them on Escape', (): void => {
    document.querySelector('.content')?.insertAdjacentHTML(
      'beforeend',
      `<div class="dropdown">
         <button type="button" data-dropdown-toggle aria-haspopup="true" aria-expanded="false">Menü</button>
         <div class="dropdown-menu" role="menu">
           <button type="button" class="dropdown-item" role="menuitem" tabindex="-1">Abmelden</button>
         </div>
       </div>`,
    );
    const toggle = document.querySelector<HTMLElement>('[data-dropdown-toggle]');
    const dropdown = toggle?.closest('.dropdown');

    click(toggle as HTMLElement);
    expect(dropdown?.classList.contains('is-open')).toBe(true);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    click(toggle as HTMLElement);
    expect(dropdown?.classList.contains('is-open')).toBe(false);

    key(toggle as HTMLElement, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('Abmelden');
    key(document.activeElement as HTMLElement, 'ArrowDown');
    key(document.activeElement as HTMLElement, 'Escape');
    expect(dropdown?.classList.contains('is-open')).toBe(false);
    expect(document.activeElement).toBe(toggle);

    key(toggle as HTMLElement, 'ArrowUp');
    key(document.activeElement as HTMLElement, 'Tab');
    expect(dropdown?.classList.contains('is-open')).toBe(false);
  });

  it('toggles and remembers the dark theme', (): void => {
    Theme.sync();
    click('[data-theme-toggle]');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('kuntze-theme')).toBe('dark');
    expect(textOf('[data-theme-label]')).toBe('Hell');

    click('[data-theme-toggle]');
    expect(Theme.current()).toBe('light');
  });

  it('copies values and confirms it accessibly', async (): Promise<void> => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const button = document.createElement('button');
    button.setAttribute('data-copy', 'abc');
    document.body.append(button);

    await Clipboard.copy(button, 'abc');
    expect(writeText).toHaveBeenCalledWith('abc');
    expect(button.getAttribute('aria-label')).toBe('Kopiert');

    writeText.mockImplementationOnce(() => Promise.reject(new Error('denied')));
    await Clipboard.copy(button, 'abc');
    expect(button.getAttribute('aria-label')).toBe('Kopieren nicht möglich');
  });

  it('shows toasts that can be closed', (): void => {
    Toast.show('success', 'Gespeichert', 'Alles gut');
    expect(textOf('[data-toast-stack]')).toBe('GespeichertAlles gut×');
    click('.toast-close');
    expect(textOf('[data-toast-stack]')).toBe('');
  });
});

describe('shell and login', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows navigation by capability and signs out', async (): Promise<void> => {
    loadPage('audit');
    const navigation = stubNavigation();
    fakeApi({ 'GET /api/session': user({ manageStorage: false }), 'POST /api/session/sign-out': respond(204) });

    await Shell.init();

    expect(document.querySelector<HTMLElement>('[data-nav-item="audit"]')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-nav-item="storage"]')?.hidden).toBe(true);
    expect(textOf('[data-user-login]')).toBe('@ada');

    click('.sidebar [data-sign-out]');
    await vi.waitFor(() => expect(navigation.targets).toEqual(['/login.html']));
  });

  it('shows the GitHub profile picture once it has loaded', async (): Promise<void> => {
    loadPage('audit');
    fakeApi({ 'GET /api/session': { ...user(), avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' } });

    await Shell.init();

    const avatar = document.querySelector<HTMLImageElement>('[data-user-avatar]');
    expect(avatar?.getAttribute('src')).toBe('https://avatars.githubusercontent.com/u/1?v=4');
    expect(avatar?.hidden).toBe(true);

    avatar?.dispatchEvent(new Event('load'));
    expect(avatar?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-user-avatar-fallback]')?.hidden).toBe(true);
  });

  it('reports a failing session load but stays quiet on missing sessions', async (): Promise<void> => {
    loadPage('projects', '/projects.html');
    fakeApi({ 'GET /api/session': apiError(500, 'internal_error') });
    await Shell.init();
    expect(textOf('[data-toast-stack]')).toContain('Sitzung konnte nicht geladen werden');

    loadPage('projects', '/projects.html');
    stubNavigation();
    fakeApi({ 'GET /api/session': apiError(401, 'unauthenticated') });
    await Shell.init();
    expect(textOf('[data-toast-stack]')).toBe('');
  });

  it('explains failed sign-ins on the login page', (): void => {
    loadPage('login', '/login.html?error=not_organization_member');
    LoginPage.init();
    expect(textOf('[data-login-error]')).toContain('gehört nicht zur berechtigten Organisation');
  });

  it('keeps initialising when one module fails', async (): Promise<void> => {
    const reported = vi.fn();
    vi.stubGlobal('reportError', reported);
    const ran = vi.fn();

    App.register('Broken', { init: () => Promise.reject(new Error('kaputt')) });
    App.register('Working', { init: ran });
    loadPage('login', '/login.html');
    fakeApi({});

    await App.init();

    expect(ran).toHaveBeenCalled();
    expect(reported).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Modul "Broken" konnte nicht initialisiert werden.' }),
    );
  });
});

describe('page structure', (): void => {
  it.each(['index', 'projects', 'project', 'application', 'release', 'access', 'audit', 'storage'])(
    'puts the content of %s inside the app shell and the overlays beside it',
    (name): void => {
      loadPage(name);

      const content = document.querySelector('.app > .main > .content');

      expect(content?.children.length).toBeGreaterThan(0);
      expect(document.querySelector('body > .app ~ .toast-stack')).not.toBeNull();
      expect(
        document.querySelectorAll('body > :not(.app, .toast-stack, .skip-link, .modal-overlay, .modal-overlay)'),
      ).toHaveLength(0);
    },
  );
});
