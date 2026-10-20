import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AccountDto, ApiErrorDto, CurrentUserDto, PreferencesDto } from '../../../../shared/types/api.js';
import { ADMIN_GITHUB_ID, createHttpFixture, json, profile, type HttpFixture } from '../testing/http-fixture.js';

describe('account', (): void => {
  let fixture: HttpFixture;

  beforeEach(async (): Promise<void> => {
    fixture = await createHttpFixture();
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  const accountOf = async (cookie: string): Promise<AccountDto> =>
    json<AccountDto>(await fixture.call(cookie, { method: 'GET', url: '/api/account' }));

  it('shows profile, roles with their permissions and the open sessions', async (): Promise<void> => {
    const first = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');
    const second = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');

    const account = await accountOf(second);

    expect(account.user).toMatchObject({ login: 'admin' });
    expect(account.preferences).toEqual({ theme: 'system', startPage: 'dashboard' });
    expect(account.roles).toEqual([expect.objectContaining({ roleKey: 'platform-admin', scope: { type: 'global' } })]);
    expect(account.roles[0]?.permissions).toEqual(expect.arrayContaining(['settings.manage', 'projects.create']));
    expect(account.sessions).toHaveLength(2);
    expect(account.sessions.filter((session) => session.current)).toHaveLength(1);

    // Ending the other session signs that browser out; the current one goes on.
    const other = account.sessions.find((session) => !session.current);
    const ended = await fixture.call(second, {
      method: 'POST',
      url: `/api/account/sessions/${other?.id ?? ''}/revoke`,
    });
    expect(ended.statusCode).toBe(204);
    expect((await fixture.call(first, { method: 'GET', url: '/api/session' })).statusCode).toBe(401);
    expect((await accountOf(second)).sessions).toHaveLength(1);
  });

  it('never ends sessions of somebody else', async (): Promise<void> => {
    const admin = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');
    const member = await fixture.signIn('3000', 'member');
    const adminSession = (await accountOf(admin)).sessions[0]?.id ?? '';

    const refused = await fixture.call(member, { method: 'POST', url: `/api/account/sessions/${adminSession}/revoke` });

    expect(json<ApiErrorDto>(refused).error.code).toBe('session_not_found');
    expect((await fixture.call(admin, { method: 'GET', url: '/api/session' })).statusCode).toBe(200);
    // A member without roles sees an empty list of roles, not an error.
    expect((await accountOf(member)).roles).toEqual([]);
  });

  it('signs out everywhere, the current session included', async (): Promise<void> => {
    const first = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');
    const second = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');

    expect((await fixture.call(second, { method: 'POST', url: '/api/account/sessions/revoke-all' })).statusCode).toBe(
      204,
    );

    for (const cookie of [first, second]) {
      expect((await fixture.call(cookie, { method: 'GET', url: '/api/session' })).statusCode).toBe(401);
    }

    const audit = fixture.test.unitOfWork.read(({ auditLog }) =>
      auditLog.list({ actionPrefix: 'session.', limit: 5, offset: 0 }),
    );
    expect(audit.map((entry) => entry.action)).toContain('session.revoked_all');
  });

  it('saves preferences, shares them with the session and starts on the chosen page', async (): Promise<void> => {
    const admin = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');

    const saved = json<PreferencesDto>(
      await fixture.call(admin, {
        method: 'PATCH',
        url: '/api/account/preferences',
        payload: { theme: 'dark', startPage: 'apps' },
      }),
    );
    expect(saved).toEqual({ theme: 'dark', startPage: 'apps' });
    expect(json<CurrentUserDto>(await fixture.call(admin, { method: 'GET', url: '/api/session' })).preferences).toEqual(
      saved,
    );

    const invalid = await fixture.call(admin, {
      method: 'PATCH',
      url: '/api/account/preferences',
      payload: { theme: 'pink' },
    });
    expect(invalid.statusCode).toBe(400);

    // Signing in again lands on the chosen start page.
    fixture.identity.next = { profile: profile(ADMIN_GITHUB_ID, 'admin'), isOrganizationMember: true };
    const start = await fixture.app.inject({ method: 'GET', url: '/auth/github/login' });
    const stateCookie = start.cookies.find((cookie) => cookie.name.endsWith('md-oauth-state'));
    const callback = await fixture.app.inject({
      method: 'GET',
      url: `/auth/github/callback?code=code&state=${new URL(String(start.headers.location)).searchParams.get('state') ?? ''}`,
      cookies: stateCookie === undefined ? {} : { [stateCookie.name]: stateCookie.value },
    });
    expect(callback.headers.location).toBe('/apps.html');
  });
});
