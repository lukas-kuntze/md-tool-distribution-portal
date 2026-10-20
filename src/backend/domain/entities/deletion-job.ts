import { DomainError } from '../value-objects/domain-error.js';
import type { ArtifactId, DeletionJobId, ReleaseId, UserId } from '../value-objects/identifier.js';
import type { StorageKey } from '../value-objects/storage-key.js';

export const DELETION_JOB_STATES = [
  'requested',
  'quarantining',
  'quarantined',
  'restoring',
  'restored',
  'purging',
  'completed',
  'failed',
  'cancelled',
] as const;

export type DeletionJobState = (typeof DELETION_JOB_STATES)[number];

export type DeletionPhase = 'quarantine' | 'purge';

/** Waiting time after the n-th failed attempt of a phase; one more failure marks the job as failed. */
export const RETRY_DELAYS_MS: readonly number[] = [
  60_000, // 1 minute
  5 * 60_000, // 5 minutes
  30 * 60_000, // 30 minutes
  2 * 60 * 60_000, // 2 hours
  12 * 60 * 60_000, // 12 hours
];

export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/**
 * Drives the removal of a release, or of a single artifact of it, from storage. The job is written in the same transaction that marks
 * the release for deletion and is then worked off step by step, so every step can be retried safely.
 */
export interface DeletionJob {
  readonly id: DeletionJobId;
  readonly releaseId: ReleaseId;
  /** Set when the job removes a single artifact instead of the whole release. */
  readonly artifactId: ArtifactId | null;
  readonly requestedAt: Date;
  readonly requestedBy: UserId;
  readonly reason: string;
  /** The stored objects validated when the deletion was requested; nothing outside this list is ever removed. */
  readonly artifactSnapshot: readonly ArtifactSnapshotEntry[];
  readonly state: DeletionJobState;
  readonly attempts: number;
  readonly nextAttemptAt: Date | null;
  readonly purgeAfter: Date | null;
  readonly failedPhase: DeletionPhase | null;
  /** Machine-readable cause of the last failure. Never contains paths, names or other user data. */
  readonly lastErrorCode: string | null;
  /** Set when a safety check aborted the job; it is not retried automatically. */
  readonly requiresManualReview: boolean;
  readonly completedAt: Date | null;
}

export interface FailureDetails {
  readonly errorCode: string;
  /** A reparse point, unexpected file or path mismatch was found. */
  readonly securityViolation: boolean;
}

export interface ArtifactSnapshotEntry {
  readonly artifactId: ArtifactId;
  readonly storageKey: StorageKey;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface DeletionRequest {
  readonly id: DeletionJobId;
  readonly releaseId: ReleaseId;
  /** Only for removing a single artifact; its snapshot then holds exactly that artifact. */
  readonly artifactId?: ArtifactId;
  readonly requestedBy: UserId;
  readonly reason: string;
  readonly artifactSnapshot: readonly ArtifactSnapshotEntry[];
}

export function createDeletionJob(request: DeletionRequest, now: Date): DeletionJob {
  const reason = request.reason.trim();

  if (reason.length === 0) {
    throw new DomainError('reason_required', 'Deleting a release or an artifact requires a reason.');
  }

  if (
    request.artifactId !== undefined &&
    request.artifactSnapshot.some((entry) => entry.artifactId !== request.artifactId)
  ) {
    throw new DomainError(
      'invalid_deletion_job_state',
      'The snapshot of an artifact removal may only hold that artifact.',
    );
  }

  return {
    ...request,
    artifactId: request.artifactId ?? null,
    reason,
    requestedAt: now,
    state: 'requested',
    attempts: 0,
    nextAttemptAt: now,
    purgeAfter: null,
    failedPhase: null,
    lastErrorCode: null,
    requiresManualReview: false,
    completedAt: null,
  };
}

/** Whether the worker should pick the job up now. */
export function isDue(job: DeletionJob, now: Date): boolean {
  const waiting = job.state === 'requested' || job.state === 'quarantined';
  return waiting && job.nextAttemptAt !== null && job.nextAttemptAt.getTime() <= now.getTime();
}

export function startQuarantine(job: DeletionJob): DeletionJob {
  assertState(job, 'requested');
  return { ...job, state: 'quarantining', nextAttemptAt: null };
}

export function completeQuarantine(job: DeletionJob, now: Date, retentionMs: number): DeletionJob {
  assertState(job, 'quarantining');
  const purgeAfter = new Date(now.getTime() + retentionMs);

  return { ...job, state: 'quarantined', attempts: 0, lastErrorCode: null, purgeAfter, nextAttemptAt: purgeAfter };
}

export function startPurge(job: DeletionJob, now: Date): DeletionJob {
  assertState(job, 'quarantined');

  if (job.purgeAfter === null || job.purgeAfter.getTime() > now.getTime()) {
    throw new DomainError('purge_not_due', 'The quarantine period of this release has not ended yet.');
  }

  return { ...job, state: 'purging', nextAttemptAt: null };
}

/**
 * Ends the quarantine period now; reserved for `releases.purge`. The worker then purges the job on its next run
 * with the usual checks and retries, so no file is touched outside the worker.
 */
export function expediteQuarantine(job: DeletionJob, now: Date): DeletionJob {
  assertState(job, 'quarantined');
  return { ...job, purgeAfter: now, nextAttemptAt: now };
}

export function completePurge(job: DeletionJob, now: Date): DeletionJob {
  assertState(job, 'purging');
  return { ...job, state: 'completed', lastErrorCode: null, completedAt: now };
}

export function startRestore(job: DeletionJob): DeletionJob {
  assertState(job, 'quarantined');
  return { ...job, state: 'restoring', nextAttemptAt: null };
}

export function completeRestore(job: DeletionJob, now: Date): DeletionJob {
  assertState(job, 'restoring');
  return { ...job, state: 'restored', lastErrorCode: null, completedAt: now };
}

/** A failed restore leaves the release in quarantine; the user can trigger the restore again. */
export function failRestore(job: DeletionJob, errorCode: string): DeletionJob {
  assertState(job, 'restoring');
  return { ...job, state: 'quarantined', lastErrorCode: errorCode, nextAttemptAt: job.purgeAfter };
}

export function cancelDeletionJob(job: DeletionJob, now: Date): DeletionJob {
  assertState(job, 'requested');
  return { ...job, state: 'cancelled', nextAttemptAt: null, completedAt: now };
}

/**
 * Records a failed quarantine or purge attempt. The job returns to the state it started from and is retried
 * with increasing delays; safety violations and exhausted attempts end in `failed` and raise an alert.
 */
export function failAttempt(job: DeletionJob, now: Date, failure: FailureDetails): DeletionJob {
  if (job.state !== 'quarantining' && job.state !== 'purging') {
    throw new DomainError('invalid_deletion_job_state', 'Only a running quarantine or purge can fail.');
  }

  const phase: DeletionPhase = job.state === 'quarantining' ? 'quarantine' : 'purge';
  const attempts = job.attempts + 1;
  const delay = RETRY_DELAYS_MS[attempts - 1];

  if (failure.securityViolation || attempts >= MAX_ATTEMPTS || delay === undefined) {
    return {
      ...job,
      state: 'failed',
      attempts,
      nextAttemptAt: null,
      failedPhase: phase,
      lastErrorCode: failure.errorCode,
      requiresManualReview: failure.securityViolation,
    };
  }

  return {
    ...job,
    state: phase === 'quarantine' ? 'requested' : 'quarantined',
    attempts,
    nextAttemptAt: new Date(now.getTime() + delay),
    lastErrorCode: failure.errorCode,
  };
}

/** Manual "retry" after an administrator has looked into a failed job. */
export function retryFailedJob(job: DeletionJob, now: Date): DeletionJob {
  assertState(job, 'failed');

  return {
    ...job,
    state: job.failedPhase === 'purge' ? 'quarantined' : 'requested',
    attempts: 0,
    nextAttemptAt: now,
    failedPhase: null,
    requiresManualReview: false,
  };
}

function assertState(job: DeletionJob, expected: DeletionJobState): void {
  if (job.state !== expected) {
    throw new DomainError('invalid_deletion_job_state', `Operation requires the deletion job to be ${expected}.`);
  }
}
