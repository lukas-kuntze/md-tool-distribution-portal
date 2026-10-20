import { createPublicKey, verify, type KeyObject } from 'node:crypto';

import { z } from 'zod';

import type { Clock } from '../../domain/ports/clock.js';
import type { CiJob, CiTokenVerifier } from '../../domain/ports/ci-token-verifier.js';
import { DomainError } from '../../domain/value-objects/domain-error.js';

export interface OidcSettings {
  /** Token issuer, e.g. `https://token.actions.githubusercontent.com`; see `defaultOidcIssuer`. */
  readonly issuer: string;
  /** Audience the action requests; the portal's public origin unless configured otherwise. */
  readonly audience: string;
  /** Web address of GitHub, for links to the workflow run. */
  readonly webUrl: string;
}

/** Tolerated clock difference between GitHub and this server. */
const CLOCK_SKEW_MS = 60_000;
/** Unknown key ids trigger a reload of the keys, but not more often than this. */
const KEY_RELOAD_INTERVAL_MS = 60_000;

const HEADER = z.object({ alg: z.literal('RS256'), kid: z.string().min(1) });

const DIGITS = z.string().regex(/^\d{1,18}$/);

const CLAIMS = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  nbf: z.number().optional(),
  iat: z.number(),
  repository: z.string().min(1).max(201),
  repository_id: DIGITS,
  ref: z.string().min(1).max(1024),
  environment: z.string().max(255).optional(),
  sha: z.string().regex(/^[0-9a-f]{40}$|^[0-9a-f]{64}$/),
  run_id: DIGITS,
  run_attempt: DIGITS,
  actor: z.string().max(100).default(''),
});

const DISCOVERY = z.object({ jwks_uri: z.url() });

const JWKS = z.object({
  keys: z.array(
    z.object({ kid: z.string().optional(), kty: z.string(), n: z.string().optional(), e: z.string().optional() }),
  ),
});

type Fetch = typeof fetch;

/**
 * GitHub's issuer for Actions OIDC tokens: github.com and GHE.com data residency use a `token.actions.`
 * host, GitHub Enterprise Server issues them under `/_services/token`.
 */
export function defaultOidcIssuer(webUrl: string): string {
  const { origin, host } = new URL(webUrl);

  if (host === 'github.com') {
    return 'https://token.actions.githubusercontent.com';
  }

  if (host.endsWith('.ghe.com')) {
    return `https://token.actions.${host}`;
  }

  return `${origin}/_services/token`;
}

/**
 * Verifies the OIDC tokens of GitHub Actions jobs (concept 4.7). The signing keys are taken from the issuer's
 * OpenID configuration and cached; a token signed with an unknown key reloads them, which covers key rotation.
 */
export class GitHubOidcVerifier implements CiTokenVerifier {
  private keys = new Map<string, KeyObject>();
  private loadedAt: number | null = null;

  public constructor(
    private readonly settings: OidcSettings,
    private readonly clock: Clock,
    private readonly fetchImplementation: Fetch = fetch,
  ) {}

  public async verify(token: string): Promise<CiJob> {
    const parts = token.split('.');

    if (parts.length !== 3) {
      throw invalid('The token is not a signed JWT.');
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = HEADER.safeParse(decodeJson(encodedHeader));

    if (!header.success) {
      throw invalid('Only RS256 tokens with a key id are accepted.');
    }

    const key = await this.keyFor(header.data.kid);
    const signed = Buffer.from(`${encodedHeader}.${encodedPayload}`);

    if (!verify('RSA-SHA256', signed, key, Buffer.from(encodedSignature, 'base64url'))) {
      throw invalid('The token signature is invalid.');
    }

    const claims = CLAIMS.safeParse(decodeJson(encodedPayload));

    if (!claims.success) {
      throw invalid('The token lacks claims of a GitHub Actions job.');
    }

    this.assertValid(claims.data);

    const { data } = claims;
    const runId = Number(data.run_id);
    const attempt = Number(data.run_attempt);

    return {
      repositoryId: Number(data.repository_id),
      repository: data.repository,
      ref: data.ref,
      environment: data.environment ?? null,
      sha: data.sha,
      actor: data.actor,
      workflowRun: {
        id: runId,
        attempt,
        url: new URL(`/${data.repository}/actions/runs/${runId}/attempts/${attempt}`, this.settings.webUrl).toString(),
      },
    };
  }

  private assertValid(claims: z.infer<typeof CLAIMS>): void {
    const now = this.clock.now().getTime();
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

    if (claims.iss !== this.settings.issuer) {
      throw invalid('The token was issued by another issuer.');
    }

    if (!audiences.includes(this.settings.audience)) {
      throw invalid('The token was issued for another audience.');
    }

    if (claims.exp * 1000 <= now - CLOCK_SKEW_MS) {
      throw invalid('The token has expired.');
    }

    if ((claims.nbf ?? claims.iat) * 1000 > now + CLOCK_SKEW_MS) {
      throw invalid('The token is not valid yet.');
    }
  }

  private async keyFor(kid: string): Promise<KeyObject> {
    const cached = this.keys.get(kid);

    if (cached !== undefined) {
      return cached;
    }

    const now = this.clock.now().getTime();

    if (this.loadedAt === null || now - this.loadedAt >= KEY_RELOAD_INTERVAL_MS) {
      this.keys = await this.loadKeys();
      this.loadedAt = now;
    }

    const loaded = this.keys.get(kid);

    if (loaded === undefined) {
      throw invalid('The token was signed with an unknown key.');
    }

    return loaded;
  }

  private async loadKeys(): Promise<Map<string, KeyObject>> {
    const discovery = DISCOVERY.parse(
      await this.getJson(`${this.settings.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`),
    );
    const jwks = JWKS.parse(await this.getJson(discovery.jwks_uri));
    const keys = new Map<string, KeyObject>();

    for (const jwk of jwks.keys) {
      if (jwk.kid !== undefined && jwk.kty === 'RSA' && jwk.n !== undefined && jwk.e !== undefined) {
        keys.set(jwk.kid, createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' }));
      }
    }

    return keys;
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.fetchImplementation(url, { headers: { accept: 'application/json' } });

    if (!response.ok) {
      throw new Error(`Loading the OIDC signing keys failed with HTTP ${response.status}.`);
    }

    return response.json();
  }
}

function decodeJson(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function invalid(message: string): DomainError {
  return new DomainError('ci_token_invalid', message);
}
