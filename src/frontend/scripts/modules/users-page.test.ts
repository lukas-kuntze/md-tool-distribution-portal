import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { UserOverviewDto } from '../../../shared/types/api.js';
import { PROJECT_ID } from '../testing/fixtures.js';
import { click, fakeApi, loadPage, respond, submitForm, textOf, type, user } from '../testing/page.js';
import { Overlays } from './overlays.js';
import { roleLabel, UsersPage } from './users-page.js';

const ME = user().id;
const BOB = '0192f3a4-0000-7000-8000-000000000002';

function overview(overrides: Partial<UserOverviewDto> = {}): UserOverviewDto {
  return {
    id: BOB,
    displayName: 'Bob Builder',
    login: 'bob',
    gitHubId: '2000',
    avatarUrl: null,
    status: 'active',
    lastLoginAt: '2026-10-17T08:00:00.000Z',
    roles: [
      {
        roleKey: 'developer',
        scope: { type: 'project', projectId: PROJECT_ID },
        scopeName: 'MD Ambulant',
        viaTeam: false,
        expiresAt: null,
      },
    ],
    ...overrides,
  };
}

describe('users page', (): void => {
  beforeAll((): void => {
    Overlays.init();
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('lists users with roles and disables one after confirmation', async (): Promise<void> => {
    loadPage('access');
    let bob = overview();
    const calls = fakeApi({
      'GET /api/session': user(),
      'GET /api/user-directory': () =>
        respond(200, [overview({ id: ME, displayName: 'Ada Admin', login: 'ada', roles: [] }), bob], {
          'x-total-count': '2',
        }),
      [`POST /api/users/${BOB}/status`]: () => {
        bob = { ...bob, status: 'disabled' };
        return bob;
      },
    });

    await UsersPage.init();
    await vi.waitFor(() => expect(textOf('[data-users-page] tbody')).toContain('Bob Builder'));

    expect(textOf('[data-users-page] tbody')).toContain('Entwickler · Projekt MD Ambulant');
    // Nobody disables themselves: only Bob's row has an action.
    expect(document.querySelectorAll('[data-users-page] tbody button')).toHaveLength(1);

    click('[data-users-page] tbody button');
    click('#user-disable .btn-danger');

    await vi.waitFor(() => expect(textOf('[data-users-page] tbody')).toContain('Deaktiviert'));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ status: 'disabled' });
    expect(textOf('[data-users-page] tbody')).toContain('Aktivieren');
  });

  it('searches by name and status', async (): Promise<void> => {
    loadPage('access');
    const calls = fakeApi({ 'GET /api/session': user(), 'GET /api/user-directory': [] });

    await UsersPage.init();
    await vi.waitFor(() => expect(textOf('[data-users-page]')).toContain('Keine Benutzer'));

    type('[data-users-page] [name="query"]', 'bob');
    type('[data-users-page] [name="status"]', 'disabled');
    submitForm('[data-users-page] form');

    await vi.waitFor(() => expect(calls.at(-1)?.path).toContain('query=bob'));
    expect(calls.at(-1)?.path).toContain('status=disabled');
  });

  it('is reserved to platform-wide permission management', async (): Promise<void> => {
    loadPage('access');
    fakeApi({ 'GET /api/session': user({ managePermissions: false }) });

    await UsersPage.init();

    expect(textOf('[data-users-page]')).toContain('Keine Berechtigung');
  });

  it('describes roles with scope, team and expiry', (): void => {
    expect(
      roleLabel({
        roleKey: 'platform-admin',
        scope: { type: 'global' },
        scopeName: '',
        viaTeam: true,
        expiresAt: null,
      }),
    ).toBe('Plattform-Admin · Plattform (über Team)');
    expect(
      roleLabel({
        roleKey: 'tester',
        scope: { type: 'application', applicationId: 'a' },
        scopeName: 'Pflege mobil',
        viaTeam: false,
        expiresAt: '2026-12-31T00:00:00.000Z',
      }),
    ).toContain('Tester · Anwendung Pflege mobil (bis');
  });
});
