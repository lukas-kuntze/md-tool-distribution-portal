import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CurrentUserDto } from '../../../../shared/types/api.js';
import { ADMIN_GITHUB_ID, createHttpFixture, json, type HttpFixture } from '../testing/http-fixture.js';

describe('authentication routes', (): void => {
  let fixture: HttpFixture;

  beforeEach(async (): Promise<void> => {
    fixture = await createHttpFixture();
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  const audit = (): readonly string[] =>
    fixture.test.database
      .prepare<[], { action: string; outcome: string }>('SELECT action, outcome FROM audit_logs ORDER BY id')
      .all()
      .map((row) => `${row.action}:${row.outcome}`);

  it('redirects to GitHub with a state bound to an HttpOnly cookie', async (): Promise<void> => {
    const response = await fixture.app.inject({ method: 'GET', url: '/auth/github/login' });
    const cookie = response.cookies[0];

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toMatch(/^https:\/\/github\.example\.com\/login\/oauth\/authorize\?state=/);
    expect(cookie).toMatchObject({
      name: '__Host-md-oauth-state',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    });
  });

  it('signs in, reports the user and signs out again', async (): Promise<void> => {
    const cookie = await fixture.signIn('2000', 'octocat');
    const session = await fixture.call(cookie, { method: 'GET', url: '/api/session' });

    expect(session.statusCode).toBe(200);
    expect(json<CurrentUserDto>(session)).toMatchObject({
      login: 'octocat',
      capabilities: { createProjects: false, managePermissions: false },
    });

    expect((await fixture.call(cookie, { method: 'POST', url: '/api/session/sign-out' })).statusCode).toBe(204);
    expect((await fixture.call(cookie, { method: 'GET', url: '/api/session' })).statusCode).toBe(401);
    expect(audit()).toEqual(['auth.sign_in:success', 'auth.sign_out:success']);
  });

  it('makes configured bootstrap administrators platform administrators', async (): Promise<void> => {
    const cookie = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');
    await fixture.signIn(ADMIN_GITHUB_ID, 'admin-renamed');

    const session = json<CurrentUserDto>(await fixture.call(cookie, { method: 'GET', url: '/api/session' }));

    expect(session.capabilities).toEqual({
      createProjects: true,
      managePermissions: true,
      readAudit: true,
      manageStorage: true,
      manageSettings: true,
      purgeReleases: true,
      managesAnyPermissions: true,
      administers: true,
    });
    expect(
      fixture.test.database
        .prepare("SELECT count(*) AS count FROM role_assignments WHERE source = 'configuration'")
        .get(),
    ).toEqual({
      count: 1,
    });
  });

  it('follows renamed logins through the stable GitHub id', async (): Promise<void> => {
    await fixture.signIn('2000', 'octocat');
    const renamed = await fixture.signIn('2000', 'mona');

    expect(json<CurrentUserDto>(await fixture.call(renamed, { method: 'GET', url: '/api/session' })).login).toBe(
      'mona',
    );
    expect(fixture.test.database.prepare('SELECT count(*) AS count FROM external_identities').get()).toEqual({
      count: 1,
    });
  });

  it('refuses people outside the organisation and records it', async (): Promise<void> => {
    await expect(fixture.signIn('3000', 'outsider', { member: false })).rejects.toThrow(
      'error=not_organization_member',
    );
    expect(audit()).toEqual(['auth.sign_in:denied']);
  });

  it('refuses disabled accounts', async (): Promise<void> => {
    await fixture.signIn('2000', 'octocat');
    fixture.test.database.prepare("UPDATE users SET status = 'disabled' WHERE display_name = 'octocat'").run();

    await expect(fixture.signIn('2000', 'octocat')).rejects.toThrow('error=user_disabled');
  });

  it('rejects a callback whose state does not match the cookie', async (): Promise<void> => {
    const response = await fixture.app.inject({
      method: 'GET',
      url: '/auth/github/callback?code=x&state=forged',
      cookies: { '__Host-md-oauth-state': 'original' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/login.html?error=sign_in_failed');
  });

  it('ends sessions after the idle timeout', async (): Promise<void> => {
    const cookie = await fixture.signIn('2000', 'octocat');
    fixture.clock.advance(2 * 60 * 60_000);

    expect((await fixture.call(cookie, { method: 'GET', url: '/api/session' })).statusCode).toBe(401);
  });

  it('rejects state-changing requests from other origins', async (): Promise<void> => {
    const cookie = await fixture.signIn('2000', 'octocat');
    const response = await fixture.app.inject({
      method: 'POST',
      url: '/api/session/sign-out',
      headers: { cookie, origin: 'https://evil.example.com' },
    });

    expect(response.statusCode).toBe(403);
    expect((await fixture.call(cookie, { method: 'GET', url: '/api/session' })).statusCode).toBe(200);
  });

  it('answers unknown routes and anonymous API calls with JSON errors', async (): Promise<void> => {
    expect(json(await fixture.call(null, { method: 'GET', url: '/api/session' }))).toEqual({
      error: { code: 'unauthenticated', message: 'Sign in to continue.' },
    });
    expect((await fixture.call(null, { method: 'GET', url: '/api/nothing' })).statusCode).toBe(401);
    const cookie = await fixture.signIn('2000', 'octocat');
    expect((await fixture.call(cookie, { method: 'GET', url: '/api/nothing' })).statusCode).toBe(404);
  });
});

describe('anonymous API calls', (): void => {
  it('are rejected before their input is looked at', async (): Promise<void> => {
    const fixture = await createHttpFixture();
    const response = await fixture.call(null, { method: 'POST', url: '/api/projects', payload: {} });

    expect(response.statusCode).toBe(401);
    expect(json(response)).toEqual({ error: { code: 'unauthenticated', message: 'Sign in to continue.' } });
    await fixture.close();
  });
});
