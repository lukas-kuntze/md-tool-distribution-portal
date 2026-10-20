import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ApiErrorDto, UserOverviewDto, UserSummaryDto } from '../../../../shared/types/api.js';
import { ADMIN_GITHUB_ID, createHttpFixture, json, type HttpFixture } from '../testing/http-fixture.js';

const PROJECT_ADMIN_ROLE_ID = '00000000-0000-7000-8000-000000000002';

describe('user administration', (): void => {
  let fixture: HttpFixture;
  let admin: string;
  let octocat: string;

  beforeEach(async (): Promise<void> => {
    fixture = await createHttpFixture();
    admin = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');
    octocat = await fixture.signIn('2000', 'octocat');
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  const directory = async (query = '', cookie = admin): Promise<UserOverviewDto[]> =>
    json<UserOverviewDto[]>(await fixture.call(cookie, { method: 'GET', url: `/api/user-directory?${query}` }));
  const userId = async (login: string): Promise<string> =>
    (await directory(`query=${login}`)).find((user) => user.login === login)?.id ?? '';
  const setStatus = (id: string, status: string, cookie = admin): ReturnType<HttpFixture['call']> =>
    fixture.call(cookie, { method: 'POST', url: `/api/users/${id}/status`, payload: { status } });

  it('lists every user with last sign-in and current roles', async (): Promise<void> => {
    const users = await directory();
    const response = await fixture.call(admin, { method: 'GET', url: '/api/user-directory?limit=1' });
    expect(response.headers['x-total-count']).toBe(String(users.length));
    expect(json<UserOverviewDto[]>(response)).toHaveLength(1);

    const byLogin = (login: string): UserOverviewDto | undefined => users.find((user) => user.login === login);
    expect(byLogin('admin')).toMatchObject({
      status: 'active',
      lastLoginAt: expect.any(String) as unknown,
      roles: [{ roleKey: 'platform-admin', scope: { type: 'global' }, scopeName: '', viaTeam: false }],
    });
    expect(byLogin('octocat')?.roles).toEqual([]);

    expect((await fixture.call(octocat, { method: 'GET', url: '/api/user-directory' })).statusCode).toBe(403);
  });

  it('disables a user at once and enables them again', async (): Promise<void> => {
    const id = await userId('octocat');

    expect(json<UserSummaryDto>(await setStatus(id, 'disabled'))).toMatchObject({ status: 'disabled' });
    expect((await fixture.call(octocat, { method: 'GET', url: '/api/session' })).statusCode).toBe(401);
    await expect(fixture.signIn('2000', 'octocat')).rejects.toThrow();
    expect((await directory('status=disabled')).map((user) => user.login)).toEqual(['octocat']);
    expect(json<ApiErrorDto>(await setStatus(id, 'disabled')).error.code).toBe('invalid_user_state');

    expect(json<UserSummaryDto>(await setStatus(id, 'active'))).toMatchObject({ status: 'active' });
    await expect(fixture.signIn('2000', 'octocat')).resolves.toContain('md-session');
  });

  it('keeps administrators from locking the platform', async (): Promise<void> => {
    const adminId = await userId('admin');
    const octocatId = await userId('octocat');

    expect(json<ApiErrorDto>(await setStatus(adminId, 'disabled')).error.code).toBe('cannot_disable_self');

    // A project admin at platform scope may manage users, but not disable the only platform administrator.
    await fixture.call(admin, {
      method: 'POST',
      url: '/api/role-assignments',
      payload: {
        roleId: PROJECT_ADMIN_ROLE_ID,
        userId: octocatId,
        scope: { type: 'global' },
        reason: 'Benutzerverwaltung',
      },
    });
    expect(json<ApiErrorDto>(await setStatus(adminId, 'disabled', octocat)).error.code).toBe('last_platform_admin');

    const audit = fixture.test.unitOfWork.read(({ auditLog }) =>
      auditLog.list({ actionPrefix: 'user.', limit: 10, offset: 0 }),
    );
    expect(audit).toEqual([]);
  });
});
