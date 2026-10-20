import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';

import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';

import type { PlatformSettings } from '../application/get-platform-settings.js';
import { SettingsCache, seedSettings } from '../application/manage-settings.js';
import {
  quarantineRetentionMs,
  sessionPolicyOf,
  SETTING_RANGES,
  withDefaults,
  type Settings,
} from '../domain/entities/settings.js';
import { migrate } from '../db/migrate.js';
import { CryptoTokenGenerator } from '../adapters/external/crypto-token-generator.js';
import { FileSystemArtifactStorage } from '../adapters/external/file-system-artifact-storage.js';
import { ZipBinaryInspector } from '../adapters/external/binaries/zip-binary-inspector.js';
import { GitHubIdentityProvider } from '../adapters/external/github-identity-provider.js';
import { GitHubOidcVerifier } from '../adapters/external/github-oidc-verifier.js';
import { HmacTokenSigner } from '../adapters/external/hmac-token-signer.js';
import { JsonLogger } from '../adapters/external/json-logger.js';
import { StoragePathResolver } from '../adapters/external/storage-path-resolver.js';
import { SystemClock } from '../adapters/external/system-clock.js';
import { UuidV7Generator } from '../adapters/external/uuid-v7-generator.js';
import { buildServer } from '../adapters/http/server.js';
import { openDatabase } from '../adapters/persistence/sqlite-database.js';
import { SqliteUnitOfWork } from '../adapters/persistence/sqlite-unit-of-work.js';
import { runDeletionWorker } from '../adapters/scheduler/deletion-worker.js';
import type { Configuration } from './environment.js';

export interface Infrastructure {
  readonly database: Database;
  readonly unitOfWork: SqliteUnitOfWork;
  readonly storage: FileSystemArtifactStorage;
  readonly clock: SystemClock;
  readonly ids: UuidV7Generator;
}

/** Opens and migrates the database and validates the storage root; shared by web service and worker. */
export async function createInfrastructure(configuration: Configuration): Promise<Infrastructure> {
  const clock = new SystemClock();
  const resolver = new StoragePathResolver(path.resolve(configuration.storageRoot));

  await resolver.assertUsableRoot(configuration.servedAreas);

  const database = openDatabase(configuration.databasePath);
  migrate(database, clock.now());
  const unitOfWork = new SqliteUnitOfWork(database);
  // Only on the very first start; afterwards the settings page is authoritative.
  seedSettings(unitOfWork, startValues(configuration), clock.now());

  return {
    database,
    unitOfWork,
    storage: new FileSystemArtifactStorage(resolver),
    clock,
    ids: new UuidV7Generator(clock),
  };
}

export function createWebServer(configuration: Configuration, infrastructure: Infrastructure): FastifyInstance {
  const callbackUrl = new URL('/auth/github/callback', configuration.publicUrl).toString();
  const settings = new SettingsCache(infrastructure.unitOfWork, infrastructure.clock);

  return buildServer({
    ...infrastructure,
    inspector: new ZipBinaryInspector(),
    maxUploadBytes: configuration.maxUploadBytes,
    identityProvider: new GitHubIdentityProvider({ ...configuration.gitHub, redirectUrl: callbackUrl }),
    ciTokens: new GitHubOidcVerifier(
      { ...configuration.ci, webUrl: configuration.gitHub.webUrl },
      infrastructure.clock,
    ),
    ciAudience: configuration.ci.audience,
    settings: platformSettings(configuration),
    tokens: new CryptoTokenGenerator(),
    signer: new HmacTokenSigner(configuration.installLink.secret),
    // Read per request from the settings, so that a change applies without a restart.
    get installLinkLifetimeMs(): number {
      return settings.current().installLinkMinutes * 60_000;
    },
    get sessionPolicy(): ReturnType<typeof sessionPolicyOf> {
      return sessionPolicyOf(settings.current());
    },
    bootstrapAdminGitHubIds: configuration.bootstrapAdminGitHubIds,
    publicUrl: configuration.publicUrl,
    trustProxy: configuration.trustProxy,
    logger: new JsonLogger('web'),
  });
}

export function startDeletionWorker(
  configuration: Configuration,
  infrastructure: Infrastructure,
  signal: AbortSignal,
): Promise<void> {
  const settings = new SettingsCache(infrastructure.unitOfWork, infrastructure.clock);

  return runDeletionWorker(
    {
      ...infrastructure,
      workerId: `${hostname()}:${process.pid}`,
      leaseMs: configuration.worker.leaseMs,
      get quarantineRetentionMs(): number {
        return quarantineRetentionMs(settings.current());
      },
    },
    {
      pollMs: configuration.worker.pollMs,
      signal,
      logger: new JsonLogger('deletion-worker'),
      reconciliation: {
        get intervalMs(): number {
          return settings.current().reconcileHours * 60 * 60_000;
        },
        ids: infrastructure.ids,
      },
    },
  );
}

/** What the platform settings page shows: the configuration without any secret. */
export function platformSettings(configuration: Configuration): PlatformSettings {
  return {
    version: packageVersion(),
    nodeVersion: process.version,
    publicUrl: configuration.publicUrl,
    gitHub: {
      webUrl: configuration.gitHub.webUrl,
      apiUrl: configuration.gitHub.apiUrl,
      organization: configuration.gitHub.organization,
    },
    bootstrapAdministrators: configuration.bootstrapAdminGitHubIds.size,
    ci: configuration.ci,
    storage: {
      databasePath: configuration.databasePath,
      storageRoot: configuration.storageRoot,
      servedAreas: configuration.servedAreas,
    },
    limits: {
      maxUploadBytes: configuration.maxUploadBytes,
      quarantineRetentionMs: configuration.quarantineRetentionMs,
      installLinkLifetimeMs: configuration.installLink.lifetimeMs,
      sessionAbsoluteMs: configuration.session.absoluteMs,
      sessionIdleMs: configuration.session.idleMs,
    },
    worker: configuration.worker,
  };
}

/** Version from `package.json`, three levels above both `src/backend/config` and `dist/backend/config`. */
function packageVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      readonly version?: unknown;
    };
    return typeof manifest.version === 'string' ? manifest.version : 'unbekannt';
  } catch {
    return 'unbekannt';
  }
}

/**
 * Settings for the very first start, taken from the environment variables that configured these values before
 * the settings page existed; clamped to the ranges the settings page accepts.
 */
export function startValues(configuration: Configuration): Settings {
  const fit = (name: keyof typeof SETTING_RANGES, value: number): number => {
    const [min, max] = SETTING_RANGES[name];
    return Math.min(max, Math.max(min, Math.round(value)));
  };

  return withDefaults({
    quarantineDays: fit('quarantineDays', configuration.quarantineRetentionMs / (24 * 60 * 60_000)),
    sessionAbsoluteHours: fit('sessionAbsoluteHours', configuration.session.absoluteMs / (60 * 60_000)),
    sessionIdleMinutes: fit(
      'sessionIdleMinutes',
      Math.min(configuration.session.idleMs, configuration.session.absoluteMs) / 60_000,
    ),
    installLinkMinutes: fit('installLinkMinutes', configuration.installLink.lifetimeMs / 60_000),
    reconcileHours: fit('reconcileHours', configuration.worker.reconcileMs / (60 * 60_000)),
  });
}
