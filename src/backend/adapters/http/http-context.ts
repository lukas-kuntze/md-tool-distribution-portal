import type { FastifyRequest } from 'fastify';

import type { ResolvedSession } from '../../application/manage-session.js';
import type { RequestContext } from '../../application/request-context.js';
import type { SessionPolicy } from '../../domain/entities/session.js';
import type { ArtifactStorage } from '../../domain/ports/artifact-storage.js';
import type { BinaryInspector } from '../../domain/ports/binary-inspector.js';
import type { CiTokenVerifier } from '../../domain/ports/ci-token-verifier.js';
import type { PlatformSettings } from '../../application/get-platform-settings.js';
import type { Clock } from '../../domain/ports/clock.js';
import type { IdGenerator } from '../../domain/ports/id-generator.js';
import type { IdentityProvider } from '../../domain/ports/identity-provider.js';
import type { Logger } from '../../domain/ports/logger.js';
import type { TokenGenerator } from '../../domain/ports/token-generator.js';
import type { TokenSigner } from '../../domain/ports/token-signer.js';
import type { UnitOfWork } from '../../domain/ports/unit-of-work.js';
import { DomainError } from '../../domain/value-objects/domain-error.js';

declare module 'fastify' {
  interface FastifyRequest {
    session: ResolvedSession | null;
  }
}

export interface HttpDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly storage: ArtifactStorage;
  /** Reads package name or bundle identifier, version and build number from uploaded binaries. */
  readonly inspector: BinaryInspector;
  readonly maxUploadBytes: number;
  readonly identityProvider: IdentityProvider;
  /** Verifies the OIDC tokens of GitHub Actions jobs uploading through `/api/ci/`. */
  readonly ciTokens: CiTokenVerifier;
  /** Audience the portal expects in those tokens. */
  readonly ciAudience: string;
  readonly tokens: TokenGenerator;
  /** Signs the tokens of iOS installation links. */
  readonly signer: TokenSigner;
  readonly installLinkLifetimeMs: number;
  readonly sessionPolicy: SessionPolicy;
  readonly bootstrapAdminGitHubIds: ReadonlySet<string>;
  /** Public origin as seen by browsers, e.g. `https://apps.example.com`; used for redirects and CSRF checks. */
  readonly publicUrl: string;
  /** Read client addresses from `X-Forwarded-For`, as set by IIS/ARR in front of the service. */
  readonly trustProxy: boolean;
  /** Read-only configuration for the platform settings page; never contains secrets. */
  readonly settings: PlatformSettings;
  readonly logger: Logger;
}

export function requireSession(request: FastifyRequest): ResolvedSession {
  if (request.session === null) {
    throw new DomainError('unauthenticated', 'Sign in to continue.');
  }

  return request.session;
}

export function requestContextOf(request: FastifyRequest): RequestContext {
  const userAgent = request.headers['user-agent'];
  return { correlationId: request.id, clientIp: request.ip, userAgent: userAgent?.slice(0, 512) ?? null };
}

export interface CookieNames {
  readonly session: string;
  readonly state: string;
  readonly secure: boolean;
}

/** `__Host-` cookies are only accepted over HTTPS, bound to the host and path `/`. */
export function cookieNames(publicUrl: string): CookieNames {
  const secure = new URL(publicUrl).protocol === 'https:';
  return {
    session: secure ? '__Host-md-session' : 'md-session',
    state: secure ? '__Host-md-oauth-state' : 'md-oauth-state',
    secure,
  };
}
