import type { DeletionJob, DeletionJobState } from '../entities/deletion-job.js';
import type { ArtifactId, DeletionJobId, ReleaseId } from '../value-objects/identifier.js';
import type { Stored } from './stored.js';

export interface DeletionJobRepository {
  /** Fails with `deletion_already_requested` while another job of the release (or artifact) is still open. */
  insert(job: DeletionJob): void;
  update(job: DeletionJob, expectedRowVersion: number): number;
  findById(id: DeletionJobId): Stored<DeletionJob> | null;
  /** The job deleting the whole release that is neither completed, restored nor cancelled. */
  findOpenByRelease(releaseId: ReleaseId): Stored<DeletionJob> | null;
  /** The open job removing a single artifact. */
  findOpenByArtifact(artifactId: ArtifactId): Stored<DeletionJob> | null;
  /** Open jobs removing single artifacts of the release. */
  listOpenArtifactJobs(releaseId: ReleaseId): readonly Stored<DeletionJob>[];
  listByState(states: readonly DeletionJobState[]): readonly Stored<DeletionJob>[];

  /**
   * Atomically leases the job that has been due the longest, so that concurrent workers never process
   * the same job. A lease that ran out (crashed worker) can be taken over.
   */
  claimNextDue(now: Date, workerId: string, leaseMs: number): Stored<DeletionJob> | null;
  releaseLease(id: DeletionJobId, workerId: string): void;
}
