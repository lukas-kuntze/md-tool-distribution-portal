import { describe, expect, it } from 'vitest';

import {
  completeQuarantine,
  createDeletionJob,
  failAttempt,
  startQuarantine,
  type DeletionJob,
} from '../../domain/entities/deletion-job.js';
import type { Release } from '../../domain/entities/release.js';
import type { Stored } from '../../domain/ports/stored.js';
import {
  buildRelease,
  buildStoredArtifact,
  createTestDatabase,
  nextId,
  NOW,
  seedApplication,
  type TestDatabase,
} from './testing/sqlite-fixtures.js';

const errorCode = (code: string): unknown => expect.objectContaining({ code });
const minutes = (count: number): Date => new Date(NOW.getTime() + count * 60_000);

function setup(): { test: TestDatabase; release: Release; job: DeletionJob } {
  const test = createTestDatabase();
  const release = buildRelease(seedApplication(test));
  const artifact = buildStoredArtifact(release, 'apk');
  const job = createDeletionJob(
    {
      id: nextId(),
      releaseId: release.id,
      requestedBy: test.userId,
      reason: 'Absturz beim Start',
      artifactSnapshot: [
        {
          artifactId: artifact.id,
          storageKey: artifact.storageKey,
          sizeBytes: artifact.sizeBytes,
          sha256: artifact.sha256,
        },
      ],
    },
    NOW,
  );

  test.unitOfWork.transaction(({ releases, deletionJobs }) => {
    releases.insert(release, test.context);
    releases.insertArtifact(artifact);
    deletionJobs.insert(job);
  });

  return { test, release, job };
}

describe('SqliteDeletionJobRepository', (): void => {
  it('round-trips a job including its artifact snapshot', (): void => {
    const { test, release, job } = setup();

    expect(test.unitOfWork.read(({ deletionJobs }) => deletionJobs.findById(job.id))).toEqual({
      value: job,
      rowVersion: 1,
    });
    expect(test.unitOfWork.read(({ deletionJobs }) => deletionJobs.findOpenByRelease(release.id))?.value).toEqual(job);
    expect(test.unitOfWork.read(({ deletionJobs }) => deletionJobs.listByState(['requested']))).toHaveLength(1);
  });

  it('allows only one open job per release', (): void => {
    const { test, job } = setup();

    expect(() =>
      test.unitOfWork.transaction(({ deletionJobs }) => deletionJobs.insert({ ...job, id: nextId() })),
    ).toThrow(errorCode('deletion_already_requested'));
  });

  it('persists state transitions with optimistic locking', (): void => {
    const { test, job } = setup();
    const failed = failAttempt(startQuarantine(job), NOW, { errorCode: 'reparse_point', securityViolation: true });

    test.unitOfWork.transaction(({ deletionJobs }) => deletionJobs.update(failed, 1));

    expect(test.unitOfWork.read(({ deletionJobs }) => deletionJobs.findById(job.id))).toEqual({
      value: failed,
      rowVersion: 2,
    });
    expect(() => test.unitOfWork.transaction(({ deletionJobs }) => deletionJobs.update(failed, 1))).toThrow(
      errorCode('concurrent_modification'),
    );
  });

  describe('claimNextDue', (): void => {
    it('leases a due job to exactly one worker until the lease runs out', (): void => {
      const { test, job } = setup();
      const claim = (worker: string, at: Date): Stored<DeletionJob> | null => claimWith(test, worker, at);

      const first = claim('worker-a', NOW);

      expect(first).toEqual({ value: job, rowVersion: 2 });
      expect(claim('worker-b', minutes(1))).toBeNull();
      expect(claim('worker-b', minutes(5))?.rowVersion).toBe(3);
    });

    it('can be handed back explicitly', (): void => {
      const { test, job } = setup();

      claimWith(test, 'worker-a', NOW);
      test.unitOfWork.transaction(({ deletionJobs }) => deletionJobs.releaseLease(job.id, 'worker-b'));
      expect(claimWith(test, 'worker-b', minutes(1))).toBeNull();

      test.unitOfWork.transaction(({ deletionJobs }) => deletionJobs.releaseLease(job.id, 'worker-a'));
      expect(claimWith(test, 'worker-b', minutes(1))).not.toBeNull();
    });

    it('ignores jobs that are not due yet', (): void => {
      const { test, job } = setup();
      const quarantined = completeQuarantine(startQuarantine(job), NOW, 14 * 24 * 60 * 60_000);
      test.unitOfWork.transaction(({ deletionJobs }) => deletionJobs.update(quarantined, 1));

      expect(claimWith(test, 'worker-a', minutes(60))).toBeNull();
      expect(claimWith(test, 'worker-a', minutes(14 * 24 * 60))?.value.state).toBe('quarantined');
    });
  });
});

function claimWith(test: TestDatabase, workerId: string, at: Date): Stored<DeletionJob> | null {
  return test.unitOfWork.transaction(({ deletionJobs }) => deletionJobs.claimNextDue(at, workerId, 5 * 60_000));
}
