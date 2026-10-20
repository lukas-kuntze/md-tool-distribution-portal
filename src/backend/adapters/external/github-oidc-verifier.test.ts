import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { MutableClock } from '../../application/testing/deletion-scenario.js';
import { defaultOidcIssuer, GitHubOidcVerifier } from './github-oidc-verifier.js';

const ISSUER = 'https://token.actions.githubusercontent.com';
const AUDIENCE = 'https://apps.example.com';
const NOW = new Date('2026-10-18T10:00:00Z');
const seconds = (date: Date): number => Math.floor(date.getTime() / 1000);

const claims = {
  iss: ISSUER,
  aud: AUDIENCE,
  iat: seconds(NOW) - 10,
  nbf: seconds(NOW) - 10,
  exp: seconds(NOW) + 300,
  repository: 'medifox/pflege-mobil',
  repository_id: '4711',
  ref: 'refs/heads/main',
  environment: 'production',
  sha: 'b'.repeat(40),
  run_id: '9001',
  run_attempt: '2',
  actor: 'octocat',
};

function keyPair(): { readonly privateKey: KeyObject; readonly jwk: object } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey, jwk: publicKey.export({ format: 'jwk' }) };
}

function jwt(privateKey: KeyObject, payload: object, header: object = { alg: 'RS256', kid: 'k1' }): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signed = `${encode(header)}.${encode(payload)}`;
  return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url')}`;
}

describe('GitHub OIDC verifier', (): void => {
  const first = keyPair();
  const second = keyPair();
  let published: object[];
  let requests: string[];
  let clock: MutableClock;
  let verifier: GitHubOidcVerifier;

  beforeEach((): void => {
    published = [{ ...first.jwk, kid: 'k1' }];
    requests = [];
    clock = new MutableClock(NOW);
    verifier = new GitHubOidcVerifier(
      { issuer: ISSUER, audience: AUDIENCE, webUrl: 'https://github.com' },
      clock,
      (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        requests.push(url);
        const body = url.endsWith('/openid-configuration')
          ? { jwks_uri: `${ISSUER}/.well-known/jwks` }
          : { keys: published };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      },
    );
  });

  const refused = (token: string): Promise<unknown> =>
    expect(verifier.verify(token)).rejects.toMatchObject({ code: 'ci_token_invalid' });

  it('derives the issuer from the GitHub web address', (): void => {
    expect(defaultOidcIssuer('https://github.com')).toBe(ISSUER);
    expect(defaultOidcIssuer('https://octo.ghe.com')).toBe('https://token.actions.octo.ghe.com');
    expect(defaultOidcIssuer('https://github.example.com/')).toBe('https://github.example.com/_services/token');
  });

  it('accepts a valid token and describes the job', async (): Promise<void> => {
    await expect(verifier.verify(jwt(first.privateKey, claims))).resolves.toEqual({
      repositoryId: 4711,
      repository: 'medifox/pflege-mobil',
      ref: 'refs/heads/main',
      environment: 'production',
      sha: 'b'.repeat(40),
      actor: 'octocat',
      workflowRun: {
        id: 9001,
        attempt: 2,
        url: 'https://github.com/medifox/pflege-mobil/actions/runs/9001/attempts/2',
      },
    });
    // The keys are cached.
    await verifier.verify(jwt(first.privateKey, { ...claims, aud: [AUDIENCE, 'other'] }));
    expect(requests).toHaveLength(2);
  });

  it('refuses forged, foreign and expired tokens', async (): Promise<void> => {
    await refused('not-a-token');
    await refused(jwt(second.privateKey, claims));
    await refused(jwt(first.privateKey, claims, { alg: 'HS256', kid: 'k1' }));
    await refused(jwt(first.privateKey, { ...claims, iss: 'https://evil.example.com' }));
    await refused(jwt(first.privateKey, { ...claims, aud: 'https://other.example.com' }));
    await refused(jwt(first.privateKey, { ...claims, exp: seconds(NOW) - 120 }));
    await refused(jwt(first.privateKey, { ...claims, nbf: seconds(NOW) + 120 }));
    await refused(jwt(first.privateKey, { ...claims, repository_id: undefined }));
  });

  it('reloads the keys for an unknown key id, at most once a minute', async (): Promise<void> => {
    await verifier.verify(jwt(first.privateKey, claims));
    published = [
      { ...first.jwk, kid: 'k1' },
      { ...second.jwk, kid: 'k2' },
    ];

    // Within a minute of the last load, an unknown key is refused without asking GitHub again.
    await refused(jwt(second.privateKey, claims, { alg: 'RS256', kid: 'k2' }));
    expect(requests).toHaveLength(2);

    clock.advance(60_000);
    await expect(verifier.verify(jwt(second.privateKey, claims, { alg: 'RS256', kid: 'k2' }))).resolves.toMatchObject({
      repositoryId: 4711,
    });
    expect(requests).toHaveLength(4);
  });
});
