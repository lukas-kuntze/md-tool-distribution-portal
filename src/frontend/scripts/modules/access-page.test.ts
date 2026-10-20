import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssignmentDto, RoleDto, UserSummaryDto } from '../../../shared/types/api.js';
import { application, APPLICATION_ID, project, PROJECT_ID } from '../testing/fixtures.js';
import {
  apiError,
  click,
  fakeApi,
  loadPage,
  respond,
  submitForm,
  textOf,
  type,
  type Routes,
  user,
} from '../testing/page.js';
import { AccessPage, selectedScope } from './access-page.js';
import { Overlays } from './overlays.js';
import { userOptionLabel } from './role-assignments.js';

const ADA: UserSummaryDto = {
  id: '0192f3a4-0000-7000-8000-000000000002',
  displayName: 'Ben Builder',
  login: 'ben',
  gitHubId: '2000',
  avatarUrl: null,
  status: 'active',
  lastLoginAt: '2026-10-16T08:00:00.000Z',
};

const ROLES: RoleDto[] = [{ id: 'role-rm', key: 'release-manager', permissions: ['releases.read', 'releases.delete'] }];

function assignment(overrides: Partial<AssignmentDto> = {}): AssignmentDto {
  return {
    id: 'a1',
    role: { id: 'role-rm', key: 'release-manager' },
    principal: { type: 'user', user: ADA, userId: ADA.id },
    scope: { type: 'global' },
    source: 'manual',
    reason: 'Release-Verantwortung',
    grantedAt: '2026-10-01T08:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    inherited: false,
    ...overrides,
  };
}

function routes(extra: Routes = {}): Routes {
  return {
    'GET /api/session': user(),
    'GET /api/projects': [project()],
    [`GET /api/projects/${PROJECT_ID}/applications`]: [application()],
    'GET /api/role-assignments': [
      assignment(),
      assignment({ id: 'a2', source: 'configuration', reason: '' }),
      assignment({ id: 'a3', inherited: true, scope: { type: 'global' } }),
    ],
    'GET /api/roles': ROLES,
    'GET /api/users': [ADA],
    ...extra,
  };
}

describe('access page', (): void => {
  beforeAll((): void => {
    Overlays.init();
  });

  beforeEach((): void => {
    loadPage('access');
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('combines assignments, users and roles in tabs and opens the users tab by its address', async (): Promise<void> => {
    fakeApi(routes());
    await AccessPage.init();

    const tab = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
    expect(tab('tab-users').hidden).toBe(false);
    expect(tab('tab-assignments').getAttribute('aria-selected')).toBe('true');
    expect(tab('panel-users').hidden).toBe(true);

    loadPage('access', '/access.html#benutzer');
    fakeApi(routes());
    await AccessPage.init();
    expect(tab('tab-users').getAttribute('aria-selected')).toBe('true');
    expect(tab('panel-users').hidden).toBe(false);

    // Project administrators manage roles in their projects, but the user list covers the whole platform.
    loadPage('access', '/access.html#benutzer');
    fakeApi(routes({ 'GET /api/session': user({ managePermissions: false }) }));
    await AccessPage.init();
    expect(tab('tab-users').hidden).toBe(true);
    expect(tab('tab-assignments').getAttribute('aria-selected')).toBe('true');
  });

  it('shows the assignments of the chosen scope, revocable ones with an action', async (): Promise<void> => {
    const calls = fakeApi(routes());

    await AccessPage.init();
    await vi.waitFor(() => expect(textOf('[data-assignments] tbody')).toContain('Ben Builder'));

    expect(textOf('[data-assignments] tbody')).toContain('durch Konfiguration');
    await vi.waitFor(() => expect(textOf('[data-role-catalog]')).toContain('Release Manager'));
    expect(textOf('[data-role-catalog]')).toContain('Löschung von Releases beantragen');
    expect(textOf('[data-assignments] tbody')).toContain('Release Manager');
    expect(textOf('[data-assignments] tbody')).toContain('geerbt');
    expect(document.querySelectorAll('[data-assignments] tbody button')).toHaveLength(1);

    type('#access-scope', 'application');
    await vi.waitFor(() =>
      expect(calls.at(-1)?.path).toBe(
        `/api/role-assignments?scope=application&id=${APPLICATION_ID}&includeRevoked=false`,
      ),
    );

    click('[data-assignments] input[type="checkbox"]');
    await vi.waitFor(() => expect(calls.at(-1)?.path).toContain('includeRevoked=true'));
  });

  it('grants a role after a user search, with reason and expiry', async (): Promise<void> => {
    const calls = fakeApi(routes({ 'POST /api/role-assignments': respond(201, { assignmentId: 'new' }) }));

    await AccessPage.init();
    await vi.waitFor(() => expect(textOf('[data-assignments] tbody')).toContain('Ben Builder'));

    click(
      Array.from(document.querySelectorAll<HTMLElement>('[data-assignments] button')).find(
        (button) => button.textContent === 'Rolle zuweisen',
      ) as HTMLElement,
    );
    expect(document.querySelector<HTMLElement>('#grant-modal')?.hidden).toBe(false);
    await vi.waitFor(() => expect(document.querySelectorAll('#grant-role option')).toHaveLength(2));

    submitForm('#grant-form');
    expect(document.querySelectorAll('#grant-form .form-error')).toHaveLength(3);

    vi.useFakeTimers();
    type('#grant-user-search', 'ben');
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();
    await vi.waitFor(() => expect(textOf('#grant-user')).toContain('Ben Builder (@ben) · GitHub-ID 2000'));

    type('#grant-user', ADA.id);
    type('#grant-role', 'role-rm');
    type('#grant-expires', '2026-12-31');
    type('#grant-reason', 'Vertretung');
    submitForm('#grant-form');

    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('#grant-modal')?.hidden).toBe(true));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      roleId: 'role-rm',
      userId: ADA.id,
      scope: { type: 'global' },
      reason: 'Vertretung',
      expiresAt: new Date('2026-12-31T23:59:59').toISOString(),
    });
  });

  it('revokes after confirmation and reports refusals', async (): Promise<void> => {
    const calls = fakeApi(routes({ 'POST /api/role-assignments/a1/revoke': apiError(422, 'last_platform_admin') }));

    await AccessPage.init();
    await vi.waitFor(() => expect(document.querySelector('[data-assignments] tbody button')).not.toBeNull());

    click('[data-assignments] tbody button');
    expect(textOf('#revoke-modal .modal-body')).toContain('„release-manager“ von Ben Builder');
    click('#revoke-modal .btn-danger');

    await vi.waitFor(() => expect(textOf('[data-toast-stack]')).toContain('letzte Plattform-Administrator'));
    expect(calls.some((call) => call.path === '/api/role-assignments/a1/revoke')).toBe(true);
  });

  it('searches users and explains their permissions', async (): Promise<void> => {
    fakeApi(
      routes({
        [`GET /api/users/${ADA.id}/permissions`]: [
          {
            permission: 'releases.delete',
            allowed: true,
            grants: [
              { assignmentId: 'a1', roleKey: 'release-manager', scope: { type: 'project', projectId: PROJECT_ID } },
            ],
          },
          { permission: 'projects.create', allowed: false, grants: [] },
        ],
      }),
    );

    await AccessPage.init();
    type('#access-user-query', 'ben');
    submitForm('[data-user-search]');
    await vi.waitFor(() => expect(textOf('[data-user-results]')).toContain('Ben Builder'));

    click('[data-user-results] tbody button');
    await vi.waitFor(() => expect(textOf('[data-permission-body]')).toContain('Rolle release-manager auf Projekt'));
    expect(textOf('[data-permission-user]')).toBe('Ben Builder · Plattform');
  });

  it('starts at project scope for project-level managers and refuses everyone else', async (): Promise<void> => {
    const calls = fakeApi(routes({ 'GET /api/session': user({ managePermissions: false }) }));

    await AccessPage.init();
    await vi.waitFor(() => expect(calls.some((call) => call.path.startsWith('/api/role-assignments'))).toBe(true));
    expect(calls.find((call) => call.path.startsWith('/api/role-assignments'))?.path).toContain(
      `scope=project&id=${PROJECT_ID}`,
    );

    loadPage('access');
    fakeApi(routes({ 'GET /api/session': user({ managesAnyPermissions: false }) }));
    await AccessPage.init();
    expect(textOf('[data-page-state]')).toContain('Keine Berechtigung');
  });

  it('maps form values to scopes and users to readable options', (): void => {
    expect(selectedScope('project', '', '')).toBeNull();
    expect(selectedScope('application', 'p', 'a')).toEqual({ type: 'application', applicationId: 'a' });
    expect(selectedScope('team', '', '')).toBeNull();
    expect(userOptionLabel({ ...ADA, login: null, gitHubId: null, status: 'disabled' })).toBe(
      'Ben Builder · deaktiviert',
    );
  });
});
