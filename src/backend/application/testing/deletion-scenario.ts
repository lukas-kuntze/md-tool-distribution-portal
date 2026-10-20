import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { FileSystemArtifactStorage } from '../../adapters/external/file-system-artifact-storage.js';
import { StoragePathResolver } from '../../adapters/external/storage-path-resolver.js';
import { UuidV7Generator } from '../../adapters/external/uuid-v7-generator.js';
import {
  buildRelease,
  createTestDatabase,
  NOW,
  seedApplication,
  type SeededApplication,
  type TestDatabase,
} from '../../adapters/persistence/testing/sqlite-fixtures.js';
import {
  createReleaseArtifact,
  markArtifactStored,
  type ReleaseArtifact,
} from '../../domain/entities/release-artifact.js';
import { deletionConfirmationPhrase, type Release } from '../../domain/entities/release.js';
import type { Clock } from '../../domain/ports/clock.js';
import { artifactKindSpec, type ArtifactKind } from '../../domain/value-objects/artifact-kind.js';
import { artifactStorageKey } from '../../domain/value-objects/storage-key.js';
import type { Actor, RequestContext } from '../request-context.js';

export const RETENTION_MS = 14 * 24 * 60 * 60_000;

export class MutableClock implements Clock {
  private current: Date;

  public constructor(start: Date) {
    this.current = start;
  }

  public now(): Date {
    return this.current;
  }

  public advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export interface DeletionScenario {
  readonly test: TestDatabase;
  readonly seeded: SeededApplication;
  readonly release: Release;
  readonly artifacts: readonly ReleaseArtifact[];
  readonly resolver: StoragePathResolver;
  readonly storage: FileSystemArtifactStorage;
  readonly clock: MutableClock;
  readonly ids: UuidV7Generator;
  readonly actor: Actor;
  readonly request: RequestContext;
  readonly confirmation: string;
  cleanup(): Promise<void>;
}

/** A release with an APK and an IPA on disk, and the test user holding `role` on its application. */
export async function createDeletionScenario(role: string | null = 'release-manager'): Promise<DeletionScenario> {
  const base = await mkdtemp(path.join(tmpdir(), 'deletion-scenario-'));
  const test = createTestDatabase();
  const seeded = seedApplication(test);
  const release = buildRelease(seeded);
  const clock = new MutableClock(NOW);
  const ids = new UuidV7Generator(clock);
  const resolver = new StoragePathResolver(path.join(base, 'storage'));
  const storage = new FileSystemArtifactStorage(resolver);

  test.unitOfWork.transaction(({ releases }) => releases.insert(release, test.context));

  const artifacts: ReleaseArtifact[] = [];

  for (const kind of ['apk', 'ipa'] as const satisfies readonly ArtifactKind[]) {
    artifacts.push(await upload(storage, ids, release, kind));
  }

  test.unitOfWork.transaction(({ releases, access }) => {
    for (const artifact of artifacts) {
      releases.insertArtifact(artifact);
    }

    const roleToGrant = role === null ? null : access.findRoleByKey(role);

    if (roleToGrant !== null) {
      access.insertAssignment(
        {
          id: ids.next(),
          roleId: roleToGrant.id,
          principal: { type: 'user', userId: test.userId },
          scope: { type: 'application', applicationId: seeded.application.id },
          reason: 'Test',
          expiresAt: null,
          source: 'manual',
        },
        test.context,
      );
    }
  });

  return {
    test,
    seeded,
    release,
    artifacts,
    resolver,
    storage,
    clock,
    ids,
    actor: { userId: test.userId, label: 'octocat' },
    request: { correlationId: 'test-correlation', clientIp: '10.0.0.1', userAgent: 'vitest' },
    confirmation: deletionConfirmationPhrase({
      applicationSlug: seeded.application.slug,
      flavorKey: null,
      version: release.version,
      buildNumber: release.buildNumber,
    }),
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

async function upload(
  storage: FileSystemArtifactStorage,
  ids: UuidV7Generator,
  release: Release,
  kind: ArtifactKind,
): Promise<ReleaseArtifact> {
  const uploadId = ids.next<'Upload'>();
  const id = ids.next<'Artifact'>();
  const key = artifactStorageKey(release.applicationId, release.id, id, kind);
  const received = await storage.receive(uploadId, Readable.from([Buffer.from(`${kind} build`)]), 1024);

  await storage.commit(uploadId, key);

  return markArtifactStored(
    createReleaseArtifact({
      id,
      releaseId: release.id,
      kind,
      abi: null,
      buildMode: 'release',
      originalFileName: `app.${artifactKindSpec(kind).extension}`,
      contentType: 'application/octet-stream',
      sizeBytes: received.sizeBytes,
      sha256: received.sha256,
      storageKey: key,
      gitCommitSha: release.gitCommitSha,
      workflowRunId: 4711,
      workflowRunAttempt: 1,
      uploadSource: 'ci',
      uploadedAt: NOW,
      uploadedBy: null,
    }),
  );
}

/** Actions recorded in the audit log, oldest first. */
export function auditActions(scenario: DeletionScenario): readonly string[] {
  return scenario.test.database
    .prepare<[], { action: string; outcome: string }>('SELECT action, outcome FROM audit_logs ORDER BY id')
    .all()
    .map((row) => `${row.action}:${row.outcome}`);
}
