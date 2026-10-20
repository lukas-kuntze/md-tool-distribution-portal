import { describe, expect, it } from 'vitest';

import { GitHubIdentityProvider, type GitHubSettings } from './github-identity-provider.js';

const settings: GitHubSettings = {
  webUrl: 'https://github.example.com',
  apiUrl: 'https://github.example.com/api/v3/',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUrl: 'https://apps.example.com/auth/github/callback',
  organization: 'md-ambulant',
};

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function fakeGitHub(routes: Readonly<Record<string, { status?: number; body: unknown }>>): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fakeFetch: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init });
    const route = routes[url];
    return Promise.resolve(
      route === undefined
        ? new Response('not found', { status: 404 })
        : new Response(JSON.stringify(route.body), { status: route.status ?? 200 }),
    );
  };

  return { fetch: fakeFetch, calls };
}

const TOKEN_URL = 'https://github.example.com/login/oauth/access_token';
const USER_URL = 'https://github.example.com/api/v3/user';
const MEMBERSHIP_URL = 'https://github.example.com/api/v3/user/memberships/orgs/md-ambulant';

describe('GitHubIdentityProvider', (): void => {
  it('builds the authorization URL with read:org and the state', (): void => {
    const url = new URL(new GitHubIdentityProvider(settings).authorizationUrl('state-123'));

    expect(url.origin + url.pathname).toBe('https://github.example.com/login/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-id',
      redirect_uri: settings.redirectUrl,
      scope: 'read:org',
      state: 'state-123',
      allow_signup: 'false',
    });
  });

  it('returns the profile with the stable numeric id and the membership', async (): Promise<void> => {
    const { fetch, calls } = fakeGitHub({
      [TOKEN_URL]: { body: { access_token: 'gho_secret' } },
      [USER_URL]: {
        body: { id: 4711, node_id: 'MDQ6VXNlcjQ3MTE=', login: 'octocat', name: 'Mona', email: null, avatar_url: null },
      },
      [MEMBERSHIP_URL]: { body: { state: 'active' } },
    });

    await expect(new GitHubIdentityProvider(settings, fetch).completeSignIn('code-1')).resolves.toEqual({
      profile: {
        providerHost: 'github.example.com',
        subject: '4711',
        nodeId: 'MDQ6VXNlcjQ3MTE=',
        login: 'octocat',
        displayName: 'Mona',
        email: null,
        avatarUrl: null,
      },
      isOrganizationMember: true,
    });
    expect(JSON.parse(calls[0]?.init?.body as string)).toMatchObject({
      code: 'code-1',
      client_secret: 'client-secret',
    });
    expect(new Headers(calls[1]?.init?.headers).get('authorization')).toBe('Bearer gho_secret');
  });

  it.each([
    ['no membership', { status: 404, body: {} }],
    ['a pending invitation', { body: { state: 'pending' } }],
  ])('reports %s as not a member', async (_case, membership): Promise<void> => {
    const { fetch } = fakeGitHub({
      [TOKEN_URL]: { body: { access_token: 'gho_secret' } },
      [USER_URL]: { body: { id: 4711, login: 'octocat' } },
      [MEMBERSHIP_URL]: membership,
    });

    const result = await new GitHubIdentityProvider(settings, fetch).completeSignIn('code-1');

    expect(result).toMatchObject({ isOrganizationMember: false, profile: { displayName: 'octocat' } });
  });

  it('fails when the code is rejected or the user cannot be read', async (): Promise<void> => {
    const rejected = fakeGitHub({ [TOKEN_URL]: { body: { error: 'bad_verification_code' } } });
    const unreadable = fakeGitHub({
      [TOKEN_URL]: { body: { access_token: 'gho_secret' } },
      [USER_URL]: { status: 500, body: {} },
    });

    await expect(new GitHubIdentityProvider(settings, rejected.fetch).completeSignIn('x')).rejects.toThrow(
      expect.objectContaining({ code: 'sign_in_failed' }),
    );
    await expect(new GitHubIdentityProvider(settings, unreadable.fetch).completeSignIn('x')).rejects.toThrow(
      expect.objectContaining({ code: 'sign_in_failed' }),
    );
  });
});
