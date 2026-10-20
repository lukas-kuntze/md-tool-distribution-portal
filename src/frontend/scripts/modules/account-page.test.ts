import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AccountDto } from '../../../shared/types/api.js';
import { click, fakeApi, loadPage, respond, stubNavigation, submitForm, textOf, type, user } from '../testing/page.js';
import { AccountPage, describeDevice } from './account-page.js';
import { Overlays } from './overlays.js';
import { Theme } from './theme.js';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const ACCOUNT: AccountDto = {
  user: {
    id: 'u1',
    displayName: 'Ada Admin',
    login: 'ada',
    avatarUrl: null,
    status: 'active',
    lastLoginAt: '2026-10-18T07:00:00.000Z',
  } as AccountDto['user'],
  preferences: { theme: 'system', startPage: 'dashboard' },
  roles: [
    {
      roleKey: 'project-admin',
      scope: { type: 'project', projectId: 'p1' },
      scopeName: 'MD Ambulant',
      viaTeam: false,
      expiresAt: null,
      permissions: ['projects.update', 'shares.manage'],
    },
  ],
  sessions: [
    {
      id: 's1',
      createdAt: '2026-10-18T07:00:00.000Z',
      lastSeenAt: '2026-10-18T08:00:00.000Z',
      expiresAt: '2026-10-18T19:00:00.000Z',
      userAgent: CHROME_WINDOWS,
      current: true,
    },
    {
      id: 's2',
      createdAt: '2026-10-17T07:00:00.000Z',
      lastSeenAt: '2026-10-17T09:00:00.000Z',
      expiresAt: '2026-10-17T19:00:00.000Z',
      userAgent: SAFARI_IPHONE,
      current: false,
    },
  ],
};

describe('account page', (): void => {
  beforeAll((): void => {
    Overlays.init();
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows profile, roles and sessions, saves the settings and ends another session', async (): Promise<void> => {
    loadPage('account');
    const calls = fakeApi({
      'GET /api/session': user(),
      'GET /api/account': ACCOUNT,
      'PATCH /api/account/preferences': { theme: 'dark', startPage: 'apps' },
      'POST /api/account/sessions/s2/revoke': respond(204),
    });

    await AccountPage.init();

    expect(textOf('[data-account-profile]')).toContain('@ada');
    expect(textOf('[data-account-roles] tbody')).toContain('Projekt MD Ambulant');
    expect(textOf('[data-account-roles] tbody')).toContain('Freigabelinks');
    expect(textOf('[data-account-sessions] tbody')).toContain('Chrome auf Windows');
    expect(textOf('[data-account-sessions] tbody')).toContain('Dieses Gerät');
    // The current session cannot be ended here; that is what signing out is for.
    expect(document.querySelectorAll('[data-account-sessions] tbody button')).toHaveLength(1);

    type('#account-theme', 'dark');
    type('#account-start-page', 'apps');
    submitForm('#account-preferences-form');
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ theme: 'dark', startPage: 'apps' });
    await vi.waitFor(() => expect(Theme.current()).toBe('dark'));

    click('[data-account-sessions] tbody button');
    await vi.waitFor(() => expect(calls.some((call) => call.path === '/api/account/sessions/s2/revoke')).toBe(true));
  });

  it('keeps the start page for people who only install apps and signs out everywhere', async (): Promise<void> => {
    loadPage('account');
    const navigation = stubNavigation();
    const calls = fakeApi({
      'GET /api/session': user({ administers: false }),
      'GET /api/account': { ...ACCOUNT, roles: [] },
      'POST /api/account/sessions/revoke-all': respond(204),
    });

    await AccountPage.init();

    expect(document.querySelector<HTMLSelectElement>('#account-start-page')?.disabled).toBe(true);
    expect(textOf('[data-account-roles]')).toContain('Keine Rolle');

    click('[data-action="sign-out-everywhere"]');
    click('[data-confirm-sign-out]');
    await vi.waitFor(() => expect(navigation.targets).toEqual(['/login.html']));
    expect(calls.some((call) => call.path === '/api/account/sessions/revoke-all')).toBe(true);
  });

  it('recognises browsers and systems roughly', (): void => {
    expect(describeDevice(CHROME_WINDOWS)).toBe('Chrome auf Windows');
    expect(describeDevice(SAFARI_IPHONE)).toBe('Safari auf iOS');
    expect(describeDevice('Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/131.0')).toBe('Firefox auf Linux');
    expect(describeDevice(null)).toBe('Unbekanntes Gerät');
  });
});
