import type { Database } from 'better-sqlite3';

import type { ArtifactSnapshotEntry, DeletionJob, DeletionJobState } from '../../domain/entities/deletion-job.js';
import type { DeletionJobRepository } from '../../domain/ports/deletion-job-repository.js';
import type { Stored } from '../../domain/ports/stored.js';
import type { ArtifactId, DeletionJobId, ReleaseId, UserId } from '../../domain/value-objects/identifier.js';
import { parseStorageKey } from '../../domain/value-objects/storage-key.js';
import {
  assertRowUpdated,
  fromDbBoolean,
  fromDbTime,
  toDbBoolean,
  toDbTime,
  translateConstraints,
} from './sqlite-values.js';

interface DeletionJobRow {
  readonly id: string;
  readonly release_id: string;
  readonly artifact_id: string | null;
  readonly requested_at: string;
  readonly requested_by: string;
  readonly reason: string;
  readonly artifact_snapshot: string;
  readonly state: DeletionJobState;
  readonly attempts: number;
  readonly next_attempt_at: string | null;
  readonly purge_after: string | null;
  readonly failed_phase: DeletionJob['failedPhase'];
  readonly last_error_code: string | null;
  readonly requires_manual_review: number;
  readonly completed_at: string | null;
  readonly row_version: number;
}

interface SnapshotJson {
  readonly artifactId: string;
  readonly storageKey: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

const OPEN_JOB_EXISTS = {
  constraint: 'deletion_jobs.release_id',
  code: 'deletion_already_requested',
  message: 'The deletion of this release has already been requested.',
} as const;

const OPEN_ARTIFACT_JOB_EXISTS = {
  constraint: 'deletion_jobs.artifact_id',
  code: 'deletion_already_requested',
  message: 'The removal of this artifact has already been requested.',
} as const;

export class SqliteDeletionJobRepository implements DeletionJobRepository {
  public constructor(private readonly database: Database) {}

  public insert(job: DeletionJob): void {
    translateConstraints(
      () =>
        this.database
          .prepare(
            `INSERT INTO deletion_jobs (
               id, release_id, artifact_id, requested_at, requested_by, reason, artifact_snapshot, state, attempts,
               next_attempt_at, purge_after, failed_phase, last_error_code, requires_manual_review, completed_at)
             VALUES (
               @id, @releaseId, @artifactId, @requestedAt, @requestedBy, @reason, @artifactSnapshot, @state, @attempts,
               @nextAttemptAt, @purgeAfter, @failedPhase, @lastErrorCode, @requiresManualReview, @completedAt)`,
          )
          .run(jobParameters(job)),
      [OPEN_JOB_EXISTS, OPEN_ARTIFACT_JOB_EXISTS],
    );
  }

  public update(job: DeletionJob, expectedRowVersion: number): number {
    const result = this.database
      .prepare(
        `UPDATE deletion_jobs
         SET state = @state, attempts = @attempts, next_attempt_at = @nextAttemptAt, purge_after = @purgeAfter,
             failed_phase = @failedPhase, last_error_code = @lastErrorCode,
             requires_manual_review = @requiresManualReview, completed_at = @completedAt,
             row_version = row_version + 1
         WHERE id = @id AND row_version = @expectedRowVersion`,
      )
      .run({ ...jobParameters(job), expectedRowVersion });

    assertRowUpdated(result.changes);
    return expectedRowVersion + 1;
  }

  public findById(id: DeletionJobId): Stored<DeletionJob> | null {
    const row = this.database.prepare<[string], DeletionJobRow>('SELECT * FROM deletion_jobs WHERE id = ?').get(id);
    return row === undefined ? null : toStoredJob(row);
  }

  public findOpenByRelease(releaseId: ReleaseId): Stored<DeletionJob> | null {
    const row = this.database
      .prepare<[string], DeletionJobRow>(
        `SELECT * FROM deletion_jobs
         WHERE release_id = ? AND artifact_id IS NULL AND state NOT IN ('completed', 'restored', 'cancelled')`,
      )
      .get(releaseId);
    return row === undefined ? null : toStoredJob(row);
  }

  public findOpenByArtifact(artifactId: ArtifactId): Stored<DeletionJob> | null {
    const row = this.database
      .prepare<[string], DeletionJobRow>(
        `SELECT * FROM deletion_jobs
         WHERE artifact_id = ? AND state NOT IN ('completed', 'restored', 'cancelled')`,
      )
      .get(artifactId);
    return row === undefined ? null : toStoredJob(row);
  }

  public listOpenArtifactJobs(releaseId: ReleaseId): readonly Stored<DeletionJob>[] {
    return this.database
      .prepare<[string], DeletionJobRow>(
        `SELECT * FROM deletion_jobs
         WHERE release_id = ? AND artifact_id IS NOT NULL AND state NOT IN ('completed', 'restored', 'cancelled')
         ORDER BY requested_at`,
      )
      .all(releaseId)
      .map(toStoredJob);
  }

  public listByState(states: readonly DeletionJobState[]): readonly Stored<DeletionJob>[] {
    return this.database
      .prepare<[string], DeletionJobRow>(
        'SELECT * FROM deletion_jobs WHERE state IN (SELECT value FROM json_each(?)) ORDER BY requested_at',
      )
      .all(JSON.stringify(states))
      .map(toStoredJob);
  }

  public claimNextDue(now: Date, workerId: string, leaseMs: number): Stored<DeletionJob> | null {
    // A single UPDATE … RETURNING is atomic in SQLite, so two workers can never lease the same job.
    const row = this.database
      .prepare<{ now: string; lockedUntil: string; workerId: string }, DeletionJobRow>(
        `UPDATE deletion_jobs
         SET locked_by = @workerId, locked_until = @lockedUntil, row_version = row_version + 1
         WHERE id = (
           SELECT id FROM deletion_jobs
           WHERE state IN ('requested', 'quarantined')
             AND next_attempt_at <= @now
             AND (locked_until IS NULL OR locked_until <= @now)
           ORDER BY next_attempt_at
           LIMIT 1)
         RETURNING *`,
      )
      .get({ now: toDbTime(now), lockedUntil: toDbTime(new Date(now.getTime() + leaseMs)), workerId });

    return row === undefined ? null : toStoredJob(row);
  }

  public releaseLease(id: DeletionJobId, workerId: string): void {
    this.database
      .prepare('UPDATE deletion_jobs SET locked_by = NULL, locked_until = NULL WHERE id = ? AND locked_by = ?')
      .run(id, workerId);
  }
}

function jobParameters(job: DeletionJob): Record<string, unknown> {
  const snapshot: readonly SnapshotJson[] = job.artifactSnapshot;

  return {
    id: job.id,
    releaseId: job.releaseId,
    artifactId: job.artifactId,
    requestedAt: toDbTime(job.requestedAt),
    requestedBy: job.requestedBy,
    reason: job.reason,
    artifactSnapshot: JSON.stringify(snapshot),
    state: job.state,
    attempts: job.attempts,
    nextAttemptAt: toDbTime(job.nextAttemptAt),
    purgeAfter: toDbTime(job.purgeAfter),
    failedPhase: job.failedPhase,
    lastErrorCode: job.lastErrorCode,
    requiresManualReview: toDbBoolean(job.requiresManualReview),
    completedAt: toDbTime(job.completedAt),
  };
}

function toStoredJob(row: DeletionJobRow): Stored<DeletionJob> {
  const snapshot = (JSON.parse(row.artifact_snapshot) as readonly SnapshotJson[]).map(
    (entry): ArtifactSnapshotEntry => ({
      artifactId: entry.artifactId as ArtifactId,
      // The snapshot decides what the worker deletes, so its keys are validated like any other key.
      storageKey: parseStorageKey(entry.storageKey),
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256,
    }),
  );

  return {
    value: {
      id: row.id as DeletionJobId,
      releaseId: row.release_id as ReleaseId,
      artifactId: row.artifact_id as ArtifactId | null,
      requestedAt: fromDbTime(row.requested_at),
      requestedBy: row.requested_by as UserId,
      reason: row.reason,
      artifactSnapshot: snapshot,
      state: row.state,
      attempts: row.attempts,
      nextAttemptAt: fromDbTime(row.next_attempt_at),
      purgeAfter: fromDbTime(row.purge_after),
      failedPhase: row.failed_phase,
      lastErrorCode: row.last_error_code,
      requiresManualReview: fromDbBoolean(row.requires_manual_review),
      completedAt: fromDbTime(row.completed_at),
    },
    rowVersion: row.row_version,
  };
}
