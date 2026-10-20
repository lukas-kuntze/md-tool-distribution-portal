import type { DeletionJob } from '../domain/entities/deletion-job.js';
import { markArtifactMissing, markArtifactStored, type ReleaseArtifact } from '../domain/entities/release-artifact.js';
import type { MissingArtifact, OrphanedEntry, StorageReport } from '../domain/entities/storage-report.js';
import type { ArtifactStorage, StoredObject } from '../domain/ports/artifact-storage.js';
import type { Clock } from '../domain/ports/clock.js';
import type { IdGenerator } from '../domain/ports/id-generator.js';
import type { StorageUsage } from '../domain/ports/statistics-queries.js';
import type { Repositories, UnitOfWork } from '../domain/ports/unit-of-work.js';
import {
  RELEASE_MANIFEST_FILE_NAME,
  quarantineDirectoryKey,
  storageKeySegments,
} from '../domain/value-objects/storage-key.js';
import { authorizedRead, GLOBAL_TARGET, systemAuditEntry, userAuditEntry } from './authorization.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf } from './use-case.js';

export interface ReconcileDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly storage: ArtifactStorage;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** Jobs that hold files in their quarantine directory. */
const QUARANTINE_HOLDING = new Set(['quarantining', 'quarantined', 'restoring', 'purging', 'failed']);

interface Expectation {
  readonly artifact: ReleaseArtifact;
  readonly quarantined: boolean;
}

/**
 * Compares the database with the storage areas (concept 5.6). Stored artifacts without their file (or with a
 * different size) become `missing` and raise an audit entry; missing ones whose file is back become `stored`
 * again. Files and entries nobody accounts for are reported, never removed. Runs daily in the worker and on
 * demand from the storage view.
 */
export async function reconcileStorage(
  dependencies: ReconcileDependencies,
  trigger:
    | { readonly type: 'schedule' }
    | { readonly type: 'manual'; readonly actor: Actor; readonly request: RequestContext },
): Promise<StorageReport> {
  const { unitOfWork, storage, clock, ids } = dependencies;
  const startedAt = clock.now();

  if (trigger.type === 'manual') {
    authorizedRead(contextOf(dependencies, trigger.actor, trigger.request), (_repositories, guard) =>
      guard.require('storage.manage', GLOBAL_TARGET, { type: 'storage', id: null }),
    );
  }

  const inventory = await storage.inventory();
  const finishedAt = clock.now();

  return unitOfWork.transaction((repositories) => {
    const expected = expectations(repositories);
    const found = new Map(inventory.filter((entry) => entry.type === 'file').map((entry) => [entry.path, entry]));
    const missing: MissingArtifact[] = [];
    const recovered: StorageReport['recovered'][number][] = [];
    const applications = new Map<string, string>();

    for (const [path, { artifact, quarantined }] of expected) {
      const file = found.get(path);
      const intact = file !== undefined && file.sizeBytes === artifact.sizeBytes;

      if (artifact.storageState === 'missing' && intact) {
        repositories.releases.updateArtifactState(markArtifactStored(artifact));
        recovered.push({ artifactId: artifact.id, releaseId: artifact.releaseId });
        continue;
      }

      if (intact) {
        continue;
      }

      const applicationId = applicationOf(repositories, applications, artifact);
      missing.push({
        artifactId: artifact.id,
        releaseId: artifact.releaseId,
        applicationId: applicationId as MissingArtifact['applicationId'],
        expectedPath: path,
        sizeBytes: artifact.sizeBytes,
        problem: file === undefined ? 'missing' : 'size_mismatch',
        quarantined,
      });

      if (artifact.storageState === 'stored') {
        repositories.releases.updateArtifactState(markArtifactMissing(artifact));
      }
    }

    const orphaned = inventory.filter((entry) => isOrphan(entry, expected));
    const report: StorageReport = {
      id: ids.next<'StorageReport'>(),
      trigger: trigger.type,
      startedAt,
      finishedAt,
      filesChecked: inventory.length,
      bytesChecked: inventory.reduce((total, entry) => total + entry.sizeBytes, 0),
      missing,
      recovered,
      orphaned: orphaned.map(({ path, sizeBytes, type }): OrphanedEntry => ({ path, sizeBytes, type })),
    };
    const fields = {
      action: 'storage.reconciled',
      target: { type: 'storage_report', id: report.id },
      projectId: null,
      applicationId: null,
      outcome: missing.length === 0 ? ('success' as const) : ('failed' as const),
      details: {
        filesChecked: report.filesChecked,
        missing: missing.map((entry) => ({ artifactId: entry.artifactId, problem: entry.problem })),
        recovered: recovered.length,
        orphaned: orphaned.length,
      },
    };

    repositories.storageReports.insert(report);
    repositories.auditLog.append(
      trigger.type === 'manual'
        ? userAuditEntry(trigger.actor, trigger.request, finishedAt, fields)
        : systemAuditEntry('storage-reconciliation', finishedAt, fields),
    );
    return report;
  });
}

export interface StorageOverview {
  readonly usage: StorageUsage;
  readonly latestReport: StorageReport | null;
}

/** Storage usage per project and the latest reconciliation; needs `storage.manage`. */
export function getStorageOverview(
  dependencies: Pick<ReconcileDependencies, 'unitOfWork' | 'clock'>,
  actor: Actor,
  request: RequestContext,
): StorageOverview {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, guard) => {
    guard.require('storage.manage', GLOBAL_TARGET, { type: 'storage', id: null });
    return { usage: repositories.statistics.storageUsage(), latestReport: repositories.storageReports.latest() };
  });
}

/** Whether the scheduled reconciliation is due, i.e. the last one finished longer ago than the interval. */
export function isReconciliationDue(repositories: Repositories, now: Date, intervalMs: number): boolean {
  const latest = repositories.storageReports.latest();
  return latest === null || now.getTime() - latest.finishedAt.getTime() >= intervalMs;
}

/** Where each artifact's file is expected: its storage key, or the quarantine directory of its job. */
function expectations(repositories: Repositories): ReadonlyMap<string, Expectation> {
  const quarantineJobs = new Map<string, DeletionJob>();

  for (const { value: job } of repositories.deletionJobs.listByState([
    ...QUARANTINE_HOLDING,
  ] as DeletionJob['state'][])) {
    for (const entry of job.artifactSnapshot) {
      quarantineJobs.set(entry.artifactId, job);
    }
  }

  const expected = new Map<string, Expectation>();

  for (const artifact of repositories.releases.listArtifactsByStorageState(['stored', 'missing', 'quarantined'])) {
    if (artifact.storageState !== 'quarantined') {
      expected.set(artifact.storageKey, { artifact, quarantined: false });
      continue;
    }

    const job = quarantineJobs.get(artifact.id);
    const fileName = storageKeySegments(artifact.storageKey).at(-1);

    if (job !== undefined && fileName !== undefined) {
      expected.set(`${quarantineDirectoryKey(job.id, job.releaseId)}/${fileName}`, { artifact, quarantined: true });
    }
  }

  return expected;
}

function isOrphan(entry: StoredObject, expected: ReadonlyMap<string, Expectation>): boolean {
  if (entry.type === 'other') {
    return true;
  }

  // The release manifest is written next to the artifacts and is no artifact of its own.
  return !expected.has(entry.path) && !entry.path.endsWith(`/${RELEASE_MANIFEST_FILE_NAME}`);
}

function applicationOf(repositories: Repositories, cache: Map<string, string>, artifact: ReleaseArtifact): string {
  const cached = cache.get(artifact.releaseId);

  if (cached !== undefined) {
    return cached;
  }

  const applicationId = repositories.releases.findById(artifact.releaseId)?.value.applicationId ?? '';
  cache.set(artifact.releaseId, applicationId);
  return applicationId;
}
