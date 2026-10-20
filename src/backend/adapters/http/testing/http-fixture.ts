import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Readable } from 'node:stream';

import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';

import type { PlatformSettings } from '../../../application/get-platform-settings.js';
import { MutableClock } from '../../../application/testing/deletion-scenario.js';
import {
  createReleaseArtifact,
  markArtifactStored,
  type ReleaseArtifact,
} from '../../../domain/entities/release-artifact.js';
import type { NewRelease, Release } from '../../../domain/entities/release.js';
import type { ArtifactKind } from '../../../domain/value-objects/artifact-kind.js';
import type { ApplicationId } from '../../../domain/value-objects/identifier.js';
import { artifactStorageKey } from '../../../domain/value-objects/storage-key.js';
import type { Logger } from '../../../domain/ports/logger.js';
import type { ExternalProfile, IdentityProvider, SignInResult } from '../../../domain/ports/identity-provider.js';
import type { CiJob, CiTokenVerifier } from '../../../domain/ports/ci-token-verifier.js';
import { DomainError } from '../../../domain/value-objects/domain-error.js';
import { ZipBinaryInspector } from '../../external/binaries/zip-binary-inspector.js';
import { CryptoTokenGenerator } from '../../external/crypto-token-generator.js';
import { HmacTokenSigner } from '../../external/hmac-token-signer.js';
import { FileSystemArtifactStorage } from '../../external/file-system-artifact-storage.js';
import { StoragePathResolver } from '../../external/storage-path-resolver.js';
import { UuidV7Generator } from '../../external/uuid-v7-generator.js';
import { buildRelease, createTestDatabase, NOW, type TestDatabase } from '../../persistence/testing/sqlite-fixtures.js';
import { buildServer } from '../server.js';

export const PUBLIC_URL = 'https://apps.example.com';
export const ADMIN_GITHUB_ID = '1000';
export const INSTALL_LINK_SECRET = 'a-signing-secret-of-at-least-32-characters';
export const INSTALL_LINK_LIFETIME_MS = 10 * 60_000;
export const MAX_UPLOAD_BYTES = 1024 * 1024;

/** Answers every sign-in with the profile that the test put in place before. */
export class FakeIdentityProvider implements IdentityProvider {
  public next: SignInResult | null = null;

  public authorizationUrl(state: string): string {
    return `https://github.example.com/login/oauth/authorize?state=${state}`;
  }

  public completeSignIn(): Promise<SignInResult> {
    if (this.next === null) {
      return Promise.reject(new Error('No sign-in prepared.'));
    }

    return Promise.resolve(this.next);
  }
}

/** Accepts the tokens the test registered, each standing for one job; everything else is refused. */
export class FakeCiTokenVerifier implements CiTokenVerifier {
  public readonly jobs = new Map<string, CiJob>();

  public verify(token: string): Promise<CiJob> {
    const job = this.jobs.get(token);
    return job === undefined
      ? Promise.reject(new DomainError('ci_token_invalid', 'The token signature is invalid.'))
      : Promise.resolve(job);
  }
}

/** Platform settings as the composition root would derive them; contains no secret. */
export const TEST_SETTINGS: PlatformSettings = {
  version: '0.1.0',
  nodeVersion: 'v24.0.0',
  publicUrl: PUBLIC_URL,
  gitHub: {
    webUrl: 'https://github.example.com',
    apiUrl: 'https://github.example.com/api/v3',
    organization: 'medifox',
  },
  bootstrapAdministrators: 1,
  ci: { issuer: 'https://github.example.com/_services/token', audience: PUBLIC_URL },
  storage: { databasePath: '/srv/data/distribution.db', storageRoot: '/srv/storage', servedAreas: [] },
  limits: {
    maxUploadBytes: MAX_UPLOAD_BYTES,
    quarantineRetentionMs: 7 * 24 * 60 * 60_000,
    installLinkLifetimeMs: INSTALL_LINK_LIFETIME_MS,
    sessionAbsoluteMs: 12 * 60 * 60_000,
    sessionIdleMs: 2 * 60 * 60_000,
  },
  worker: { pollMs: 30_000, leaseMs: 15 * 60_000, reconcileMs: 24 * 60 * 60_000 },
};

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export function profile(subject: string, login: string): ExternalProfile {
  return {
    providerHost: 'github.example.com',
    subject,
    nodeId: null,
    login,
    displayName: login,
    email: null,
    avatarUrl: null,
  };
}

export interface HttpFixture {
  readonly app: FastifyInstance;
  readonly test: TestDatabase;
  readonly identity: FakeIdentityProvider;
  readonly ciTokens: FakeCiTokenVerifier;
  readonly clock: MutableClock;
  readonly ids: UuidV7Generator;
  readonly storage: FileSystemArtifactStorage;
  readonly resolver: StoragePathResolver;
  /** Signs in through the real OAuth routes and returns the cookie header of the new session. */
  signIn(subject: string, login: string, options?: { readonly member?: boolean }): Promise<string>;
  /** API call from the platform's own origin, as the browser would send it. */
  call(cookie: string | null, options: InjectOptions): Promise<LightMyRequestResponse>;
  /** Draft release 4.13.0 (125) of the application's default flavor, as the CI upload would create it. */
  seedRelease(applicationId: ApplicationId, overrides?: Partial<NewRelease>): Release;
  /** Stores a file in the artifact storage and records it as artifact of the release. */
  storeArtifact(release: Release, kind: ArtifactKind, content: string): Promise<ReleaseArtifact>;
  close(): Promise<void>;
}

export async function createHttpFixture(): Promise<HttpFixture> {
  const base = await mkdtemp(path.join(tmpdir(), 'http-fixture-'));
  const test = createTestDatabase();
  const identity = new FakeIdentityProvider();
  const ciTokens = new FakeCiTokenVerifier();
  const clock = new MutableClock(NOW);
  const ids = new UuidV7Generator(clock);
  const resolver = new StoragePathResolver(path.join(base, 'storage'));
  const storage = new FileSystemArtifactStorage(resolver);
  const app = buildServer({
    unitOfWork: test.unitOfWork,
    clock,
    ids,
    storage,
    inspector: new ZipBinaryInspector(),
    maxUploadBytes: MAX_UPLOAD_BYTES,
    identityProvider: identity,
    ciTokens,
    ciAudience: PUBLIC_URL,
    settings: TEST_SETTINGS,
    tokens: new CryptoTokenGenerator(),
    signer: new HmacTokenSigner(INSTALL_LINK_SECRET),
    installLinkLifetimeMs: INSTALL_LINK_LIFETIME_MS,
    sessionPolicy: { absoluteMs: 12 * 60 * 60_000, idleMs: 2 * 60 * 60_000 },
    bootstrapAdminGitHubIds: new Set([ADMIN_GITHUB_ID]),
    publicUrl: PUBLIC_URL,
    trustProxy: false,
    logger: silentLogger,
  });

  await app.ready();

  return {
    app,
    test,
    identity,
    ciTokens,
    clock,
    ids,
    storage,
    resolver,
    async signIn(subject, login, options = {}): Promise<string> {
      identity.next = { profile: profile(subject, login), isOrganizationMember: options.member ?? true };

      const login1 = await app.inject({ method: 'GET', url: '/auth/github/login' });
      const stateCookie = login1.cookies.find((cookie) => cookie.name.endsWith('md-oauth-state'));
      const state = new URL(String(login1.headers.location)).searchParams.get('state') ?? '';
      const callback = await app.inject({
        method: 'GET',
        url: `/auth/github/callback?code=code&state=${state}`,
        cookies: stateCookie === undefined ? {} : { [stateCookie.name]: stateCookie.value },
      });
      const session = callback.cookies.find((cookie) => cookie.name.endsWith('md-session') && cookie.value !== '');

      if (session === undefined) {
        throw new Error(`Sign-in failed: ${String(callback.headers.location)}`);
      }

      return `${session.name}=${session.value}`;
    },
    call(cookie, options): Promise<LightMyRequestResponse> {
      return app.inject({
        ...options,
        headers: { origin: PUBLIC_URL, ...(cookie === null ? {} : { cookie }), ...options.headers },
      });
    },
    seedRelease(applicationId, overrides = {}): Release {
      const seeded = test.unitOfWork.read(({ applications, projects }) => {
        const application = applications.findById(applicationId)?.value;
        const flavor = application && applications.listFlavors(application.id)[0]?.value;
        const project = application && projects.findById(application.projectId)?.value;

        if (!application || !flavor || !project) {
          throw new Error('Seed data missing.');
        }

        return { application, flavor, project };
      });
      const release = buildRelease(seeded, overrides);

      test.unitOfWork.transaction(({ releases }) => releases.insert(release, test.context));
      return release;
    },
    async storeArtifact(release, kind, content): Promise<ReleaseArtifact> {
      const id = ids.next<'Artifact'>();
      const uploadId = ids.next<'Upload'>();
      const key = artifactStorageKey(release.applicationId, release.id, id, kind);
      const received = await storage.receive(uploadId, Readable.from([Buffer.from(content)]), 1024);

      await storage.commit(uploadId, key);

      const artifact = markArtifactStored(
        createReleaseArtifact({
          id,
          releaseId: release.id,
          kind,
          abi: null,
          buildMode: 'release',
          originalFileName: `app-release.${kind}`,
          contentType: 'application/octet-stream',
          sizeBytes: received.sizeBytes,
          sha256: received.sha256,
          storageKey: key,
          gitCommitSha: release.gitCommitSha,
          workflowRunId: null,
          workflowRunAttempt: null,
          uploadSource: 'ci',
          uploadedAt: NOW,
          uploadedBy: null,
        }),
      );

      test.unitOfWork.transaction(({ releases }) => releases.insertArtifact(artifact));
      return artifact;
    },
    async close(): Promise<void> {
      await app.close();
      await rm(base, { recursive: true, force: true });
    },
  };
}

/** Body of a JSON response, typed by the caller. */
export function json<Body>(response: LightMyRequestResponse): Body {
  return response.json<Body>();
}
