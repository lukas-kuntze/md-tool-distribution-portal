import {
  completePurge,
  completeQuarantine,
  failAttempt,
  startPurge,
  startQuarantine,
  type DeletionJob,
  type FailureDetails,
} from '../domain/entities/deletion-job.js';
import {
  markArtifactPurged,
  markArtifactQuarantined,
  type ReleaseArtifact,
} from '../domain/entities/release-artifact.js';
import { markReleasePurged, markReleaseQuarantined, type Release } from '../domain/entities/release.js';
import type { ArtifactStorage, StorageOutcome } from '../domain/ports/artifact-storage.js';
import type { Clock } from '../domain/ports/clock.js';
import type { Stored } from '../domain/ports/stored.js';
import type { Repositories, UnitOfWork } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { DeletionJobId } from '../domain/value-objects/identifier.js';
import { quarantineDirectoryKey, releaseDirectoryKey } from '../domain/value-objects/storage-key.js';
import { systemAuditEntry } from './authorization.js';

export interface DeletionWorkerDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly storage: ArtifactStorage;
  readonly clock: Clock;
  /** Identifies this worker process in leases, e.g. host name and process id. */
  readonly workerId: string;
  /** How long a claimed job stays reserved; must exceed the longest expected file operation. */
  readonly leaseMs: number;
  readonly quarantineRetentionMs: number;
}

export type DeletionStepResult =
  | { readonly jobId: DeletionJobId; readonly outcome: 'quarantined' | 'purged' | 'retry_scheduled' | 'failed' }
  /** Someone else changed the job meanwhile, e.g. a user restored the release; nothing was done. */
  | { readonly jobId: DeletionJobId; readonly outcome: 'superseded' };

const WORKER_LABEL = 'deletion-worker';

/**
 * Processes the deletion job that has been due the longest, if any. Database changes happen in short
 * transactions before and after the file operation, never around it. Returns `null` when nothing is due.
 */
export async function processNextDeletionJob(
  dependencies: DeletionWorkerDependencies,
): Promise<DeletionStepResult | null> {
  const { unitOfWork, clock, workerId, leaseMs } = dependencies;
  const claimed = unitOfWork.transaction(({ deletionJobs }) =>
    deletionJobs.claimNextDue(clock.now(), workerId, leaseMs),
  );

  if (claimed === null) {
    return null;
  }

  try {
    return claimed.value.state === 'requested'
      ? await runPhase(dependencies, claimed, 'quarantine')
      : await runPhase(dependencies, claimed, 'purge');
  } catch (error) {
    if (error instanceof DomainError && error.code === 'concurrent_modification') {
      return { jobId: claimed.value.id, outcome: 'superseded' };
    }

    throw error;
  } finally {
    unitOfWork.transaction(({ deletionJobs }) => deletionJobs.releaseLease(claimed.value.id, workerId));
  }
}

async function runPhase(
  dependencies: DeletionWorkerDependencies,
  claimed: Stored<DeletionJob>,
  phase: 'quarantine' | 'purge',
): Promise<DeletionStepResult> {
  const { unitOfWork, storage, clock } = dependencies;
  const running = phase === 'quarantine' ? startQuarantine(claimed.value) : startPurge(claimed.value, clock.now());

  const { rowVersion, applicationId } = unitOfWork.transaction(({ deletionJobs, releases }) => {
    const release = releases.findById(running.releaseId);

    if (release === null) {
      throw new DomainError('release_not_found', 'The release of the deletion job does not exist.');
    }

    return { rowVersion: deletionJobs.update(running, claimed.rowVersion), applicationId: release.value.applicationId };
  });

  const releaseDirectory = releaseDirectoryKey(applicationId, running.releaseId);
  const quarantineDirectory = quarantineDirectoryKey(running.id, running.releaseId);
  const [single] = running.artifactSnapshot;
  const outcome: StorageOutcome =
    phase === 'purge'
      ? await storage.purge(quarantineDirectory, running.artifactSnapshot)
      : running.artifactId !== null && single !== undefined
        ? await storage.quarantineArtifact(single, quarantineDirectory)
        : await storage.moveToQuarantine(releaseDirectory, quarantineDirectory, running.artifactSnapshot);
  const finishedAt = clock.now();

  return unitOfWork.transaction((repositories) => {
    if (!outcome.ok) {
      return recordFailure(repositories, running, rowVersion, finishedAt, phase, outcome.failure);
    }

    return phase === 'quarantine'
      ? recordQuarantine(repositories, running, rowVersion, finishedAt, dependencies.quarantineRetentionMs)
      : recordPurge(repositories, running, rowVersion, finishedAt);
  });
}

function recordQuarantine(
  repositories: Repositories,
  job: DeletionJob,
  rowVersion: number,
  now: Date,
  retentionMs: number,
): DeletionStepResult {
  const done = completeQuarantine(job, now, retentionMs);
  // Removing a single artifact leaves its release untouched.
  const release =
    job.artifactId === null
      ? updateRelease(repositories, job, now, markReleaseQuarantined)
      : requireReleaseOf(repositories, job);

  for (const artifact of snapshotArtifacts(repositories, job)) {
    if (artifact.storageState === 'stored' || artifact.storageState === 'missing') {
      repositories.releases.updateArtifactState(markArtifactQuarantined(artifact));
    }
  }

  repositories.deletionJobs.update(done, rowVersion);
  repositories.auditLog.append(
    systemAuditEntry(WORKER_LABEL, now, {
      action: `${subjectOf(job).type}.delete.quarantined`,
      target: subjectOf(job),
      projectId: null,
      applicationId: release.applicationId,
      outcome: 'success',
      details: { deletionJobId: job.id, purgeAfter: done.purgeAfter?.toISOString() ?? null },
    }),
  );

  return { jobId: job.id, outcome: 'quarantined' };
}

function recordPurge(repositories: Repositories, job: DeletionJob, rowVersion: number, now: Date): DeletionStepResult {
  const release =
    job.artifactId === null
      ? updateRelease(repositories, job, now, (current) => markReleasePurged(current, now))
      : requireReleaseOf(repositories, job);

  for (const artifact of snapshotArtifacts(repositories, job)) {
    if (artifact.storageState === 'quarantined' || artifact.storageState === 'uploading') {
      repositories.releases.updateArtifactState(markArtifactPurged(artifact, now));
    }
  }

  repositories.deletionJobs.update(completePurge(job, now), rowVersion);
  repositories.auditLog.append(
    systemAuditEntry(WORKER_LABEL, now, {
      action: `${subjectOf(job).type}.delete.completed`,
      target: subjectOf(job),
      projectId: null,
      applicationId: release.applicationId,
      outcome: 'success',
      details: {
        deletionJobId: job.id,
        artifacts: job.artifactSnapshot.map((entry) => ({ artifactId: entry.artifactId, sha256: entry.sha256 })),
      },
    }),
  );

  return { jobId: job.id, outcome: 'purged' };
}

function recordFailure(
  repositories: Repositories,
  job: DeletionJob,
  rowVersion: number,
  now: Date,
  phase: 'quarantine' | 'purge',
  failure: FailureDetails,
): DeletionStepResult {
  const failed = failAttempt(job, now, failure);
  const release = repositories.releases.findById(job.releaseId)?.value;

  repositories.deletionJobs.update(failed, rowVersion);
  repositories.auditLog.append(
    systemAuditEntry(WORKER_LABEL, now, {
      action: `${subjectOf(job).type}.delete.${failed.state === 'failed' ? 'failed' : 'retry_scheduled'}`,
      target: subjectOf(job),
      projectId: null,
      applicationId: release?.applicationId ?? null,
      outcome: 'failed',
      details: {
        deletionJobId: job.id,
        phase,
        errorCode: failure.errorCode,
        attempts: failed.attempts,
        requiresManualReview: failed.requiresManualReview,
        nextAttemptAt: failed.nextAttemptAt?.toISOString() ?? null,
      },
    }),
  );

  return { jobId: job.id, outcome: failed.state === 'failed' ? 'failed' : 'retry_scheduled' };
}

function updateRelease(
  repositories: Repositories,
  job: DeletionJob,
  now: Date,
  change: (release: Release) => Release,
): Release {
  const stored = repositories.releases.findById(job.releaseId);

  if (stored === null) {
    throw new DomainError('release_not_found', 'The release of the deletion job does not exist.');
  }

  const changed = change(stored.value);
  repositories.releases.update(changed, stored.rowVersion, { actor: null, at: now });
  return changed;
}

/** What the job removes: the release, or one artifact of it. */
function subjectOf(job: DeletionJob): { readonly type: 'release' | 'artifact'; readonly id: string } {
  return job.artifactId === null ? { type: 'release', id: job.releaseId } : { type: 'artifact', id: job.artifactId };
}

/**
 * The artifacts the job is about. A release deletion leaves alone artifacts that are quarantined by a removal
 * of their own, which keeps both jobs from marking each other's files.
 */
function snapshotArtifacts(repositories: Repositories, job: DeletionJob): readonly ReleaseArtifact[] {
  const ids = new Set(job.artifactSnapshot.map((entry) => entry.artifactId));
  return repositories.releases
    .listArtifacts(job.releaseId)
    .filter(
      (artifact) =>
        ids.has(artifact.id) ||
        (job.artifactId === null && (artifact.storageState === 'uploading' || artifact.storageState === 'missing')),
    );
}

function requireReleaseOf(repositories: Repositories, job: DeletionJob): Release {
  const stored = repositories.releases.findById(job.releaseId);

  if (stored === null) {
    throw new DomainError('release_not_found', 'The release of the deletion job does not exist.');
  }

  return stored.value;
}
