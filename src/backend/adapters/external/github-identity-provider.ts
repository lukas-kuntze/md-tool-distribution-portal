import { z } from 'zod';

import type { IdentityProvider, SignInResult } from '../../domain/ports/identity-provider.js';
import { DomainError } from '../../domain/value-objects/domain-error.js';

export interface GitHubSettings {
  /** Web address, `https://github.com` or a GitHub Enterprise host such as `https://github.example.com`. */
  readonly webUrl: string;
  /** REST API base: `https://api.github.com` (github.com, GHEC), `https://github.example.com/api/v3` (GHES). */
  readonly apiUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUrl: string;
  readonly organization: string;
}

const TOKEN_RESPONSE = z.object({ access_token: z.string().min(1) });

const USER_RESPONSE = z.object({
  id: z.number().int().positive(),
  node_id: z.string().nullish(),
  login: z.string().min(1),
  name: z.string().nullish(),
  email: z.string().nullish(),
  avatar_url: z.string().nullish(),
});

const MEMBERSHIP_RESPONSE = z.object({ state: z.string() });

type Fetch = typeof fetch;

/**
 * OAuth sign-in against github.com or GitHub Enterprise. Only `read:org` is requested, to check membership; the
 * access token is used for these two calls and then discarded, never stored.
 */
export class GitHubIdentityProvider implements IdentityProvider {
  public constructor(
    private readonly settings: GitHubSettings,
    private readonly fetchImplementation: Fetch = fetch,
  ) {}

  public authorizationUrl(state: string): string {
    const url = new URL('/login/oauth/authorize', this.settings.webUrl);

    url.search = new URLSearchParams({
      client_id: this.settings.clientId,
      redirect_uri: this.settings.redirectUrl,
      scope: 'read:org',
      state,
      allow_signup: 'false',
    }).toString();

    return url.toString();
  }

  public async completeSignIn(code: string): Promise<SignInResult> {
    const accessToken = await this.exchange(code);
    const user = USER_RESPONSE.parse(await this.api(accessToken, '/user'));
    const membership = await this.api(
      accessToken,
      `/user/memberships/orgs/${encodeURIComponent(this.settings.organization)}`,
      {
        allowNotFound: true,
      },
    );

    return {
      profile: {
        providerHost: new URL(this.settings.webUrl).host,
        subject: String(user.id),
        nodeId: user.node_id ?? null,
        login: user.login,
        displayName: user.name ?? user.login,
        email: user.email ?? null,
        avatarUrl: user.avatar_url ?? null,
      },
      isOrganizationMember: membership !== null && MEMBERSHIP_RESPONSE.parse(membership).state === 'active',
    };
  }

  private async exchange(code: string): Promise<string> {
    const response = await this.fetchImplementation(new URL('/login/oauth/access_token', this.settings.webUrl), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
        code,
        redirect_uri: this.settings.redirectUrl,
      }),
    });
    const parsed = TOKEN_RESPONSE.safeParse(response.ok ? await response.json() : null);

    if (!parsed.success) {
      // GitHub answers 200 with an `error` field for invalid or reused codes.
      throw new DomainError('sign_in_failed', 'GitHub did not accept the sign-in.');
    }

    return parsed.data.access_token;
  }

  private async api(accessToken: string, path: string, options: { allowNotFound?: boolean } = {}): Promise<unknown> {
    const response = await this.fetchImplementation(`${this.settings.apiUrl.replace(/\/$/, '')}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (options.allowNotFound === true && (response.status === 404 || response.status === 403)) {
      return null;
    }

    if (!response.ok) {
      throw new DomainError('sign_in_failed', 'GitHub could not be queried for the signed-in user.');
    }

    return response.json();
  }
}
