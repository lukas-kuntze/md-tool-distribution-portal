import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  ApiErrorDto,
  ApplicationDto,
  AssignmentDto,
  PermissionExplanationDto,
  ProjectDto,
  RoleDto,
  UserSummaryDto,
} from '../../../../shared/types/api.js';
import { ADMIN_GITHUB_ID, createHttpFixture, json, type HttpFixture } from '../testing/http-fixture.js';

describe('access routes', (): void => {
  let fixture: HttpFixture;
  let admin: string;
  let project: ProjectDto;
  let kMobile: ApplicationDto;
  let dokuAirPad: ApplicationDto;
  let manager: string;
  let managerId: string;

  beforeEach(async (): Promise<void> => {
    fixture = await createHttpFixture();
    admin = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');
    manager = await fixture.signIn('2000', 'release-manager');
    project = json<ProjectDto>(
      await fixture.call(admin, {
        method: 'POST',
        url: '/api/projects',
        payload: { slug: 'md-ambulant', name: 'MD Ambulant' },
      }),
    );

    const createApp = async (slug: string): Promise<ApplicationDto> =>
      json<ApplicationDto>(
        await fixture.call(admin, {
          method: 'POST',
          url: `/api/projects/${project.id}/applications`,
          payload: { slug, name: slug, platforms: ['android'] },
        }),
      );

    kMobile = await createApp('k-mobile');
    dokuAirPad = await createApp('doku-airpad');
    managerId =
      json<UserSummaryDto[]>(await fixture.call(admin, { method: 'GET', url: '/api/users?query=release-manager' }))[0]
        ?.id ?? '';
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  const roleId = async (key: string): Promise<string> =>
    json<RoleDto[]>(await fixture.call(admin, { method: 'GET', url: '/api/roles' })).find((role) => role.key === key)
      ?.id ?? '';

  async function grant(cookie: string, role: string, scope: object): Promise<number> {
    const response = await fixture.call(cookie, {
      method: 'POST',
      url: '/api/role-assignments',
      payload: { roleId: await roleId(role), userId: managerId, scope, reason: 'Release-Verantwortung' },
    });
    return response.statusCode;
  }

  it('lets a release manager of K Mobile delete there but not in Doku AirPad', async (): Promise<void> => {
    expect(await grant(admin, 'release-manager', { type: 'application', applicationId: kMobile.id })).toBe(201);

    const capabilities = async (id: string): Promise<ApplicationDto['capabilities'] | undefined> =>
      (await fixture.call(manager, { method: 'GET', url: `/api/applications/${id}` })).statusCode === 200
        ? json<ApplicationDto>(await fixture.call(manager, { method: 'GET', url: `/api/applications/${id}` }))
            .capabilities
        : undefined;

    expect((await capabilities(kMobile.id))?.deleteReleases).toBe(true);
    expect(await capabilities(dokuAirPad.id)).toBeUndefined();
  });

  it('lists assignments including inherited ones and explains permissions', async (): Promise<void> => {
    await grant(admin, 'tester', { type: 'project', projectId: project.id });
    await grant(admin, 'release-manager', { type: 'application', applicationId: kMobile.id });

    const assignments = json<AssignmentDto[]>(
      await fixture.call(admin, { method: 'GET', url: `/api/role-assignments?scope=application&id=${kMobile.id}` }),
    );
    const explanation = json<PermissionExplanationDto[]>(
      await fixture.call(admin, {
        method: 'GET',
        url: `/api/users/${managerId}/permissions?scope=application&id=${kMobile.id}`,
      }),
    );

    expect(assignments.map((assignment) => [assignment.role?.key, assignment.inherited])).toEqual(
      expect.arrayContaining([
        ['release-manager', false],
        ['tester', true],
        ['platform-admin', true],
      ]),
    );
    expect(explanation.find((entry) => entry.permission === 'releases.delete')).toMatchObject({
      allowed: true,
      grants: [expect.objectContaining({ roleKey: 'release-manager' })],
    });
    expect(explanation.find((entry) => entry.permission === 'releases.purge')?.allowed).toBe(false);
  });

  it('revokes assignments but keeps the last platform administrator', async (): Promise<void> => {
    await grant(admin, 'tester', { type: 'global' });
    const assignments = json<AssignmentDto[]>(
      await fixture.call(admin, { method: 'GET', url: '/api/role-assignments?scope=global' }),
    );
    const tester = assignments.find((assignment) => assignment.role?.key === 'tester');
    const platformAdmin = assignments.find((assignment) => assignment.role?.key === 'platform-admin');

    const revoked = await fixture.call(admin, { method: 'POST', url: `/api/role-assignments/${tester?.id}/revoke` });
    const lastAdmin = await fixture.call(admin, {
      method: 'POST',
      url: `/api/role-assignments/${platformAdmin?.id}/revoke`,
    });

    expect(revoked.statusCode).toBe(204);
    expect(json<ApiErrorDto>(lastAdmin).error.code).toBe('last_platform_admin');
  });

  it('stops delegates from handing out more than they hold', async (): Promise<void> => {
    await grant(admin, 'project-admin', { type: 'application', applicationId: kMobile.id });

    expect(await grant(manager, 'tester', { type: 'application', applicationId: kMobile.id })).toBe(201);
    expect(await grant(manager, 'platform-admin', { type: 'global' })).toBe(403);
    expect(await grant(manager, 'release-manager', { type: 'application', applicationId: dokuAirPad.id })).toBe(403);
    expect(await grant(manager, 'release-manager', { type: 'application', applicationId: kMobile.id })).toBe(403);
  });

  it('requires a reason and an existing user', async (): Promise<void> => {
    const noReason = await fixture.call(admin, {
      method: 'POST',
      url: '/api/role-assignments',
      payload: { roleId: await roleId('tester'), userId: managerId, scope: { type: 'global' }, reason: ' ' },
    });

    expect(json<ApiErrorDto>(noReason).error.code).toBe('reason_required');
    expect((await fixture.call(manager, { method: 'GET', url: '/api/users?query=a' })).statusCode).toBe(403);
  });
});
