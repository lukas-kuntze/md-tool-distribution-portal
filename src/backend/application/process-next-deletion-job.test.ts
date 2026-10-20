import { lstat, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ArtifactStorage, StorageOutcome } from '../domain/ports/artifact-storage.js';
import type { DeletionJobId } from '../domain/value-objects/identifier.js';
import { quarantineDirectoryKey, releaseDirectoryKey } from '../domain/value-objects/storage-key.js';
import { processNextDeletionJob, type DeletionWorkerDependencies } from './process-next-deletion-job.js';
import { submitReleaseDeletion } from './submit-release-deletion.js';
import {
  auditActions,
  createDeletionScenario,
  RETENTION_MS,
  type DeletionScenario,
} from './testing/deletion-scenario.js';

describe('processNextDeletionJob', (): void => {
  let scenario: DeletionScenario;

  beforeEach(async (): Promise<void> => {
    scenario = await createDeletionScenario();
  });

  afterEach(async (): Promise<void> => {
    await scenario.cleanup();
  });

  function dependencies(storage: ArtifactStorage = scenario.storage): DeletionWorkerDependencies {
    return {
      unitOfWork: scenario.test.unitOfWork,
      storage,
      clock: scenario.clock,
      workerId: 'worker-1',
      leaseMs: 5 * 60_000,
      quarantineRetentionMs: RETENTION_MS,
    };
  }

  function requestDeletion(): DeletionJobId {
    return submitReleaseDeletion(
      { unitOfWork: scenario.test.unitOfWork, clock: scenario.clock, ids: scenario.ids },
      {
        actor: scenario.actor,
        request: scenario.request,
        releaseId: scenario.release.id,
        expectedRowVersion: 1,
        confirmation: scenario.confirmation,
        reason: 'Absturz beim Start',
      },
    ).deletionJobId;
  }

  const releaseDirectory = (): string =>
    scenario.resolver.resolve(releaseDirectoryKey(scenario.release.applicationId, scenario.release.id));
  const exists = (target: string): Promise<boolean> =>
    lstat(target).then(
      () => true,
      () => false,
    );
  const state = (): { release: string | undefined; job: string | undefined; artifacts: readonly string[] } =>
    scenario.test.unitOfWork.read(({ releases, deletionJobs }) => ({
      release: releases.findById(scenario.release.id)?.value.lifecycleState,
      job: deletionJobs.listByState(['requested', 'quarantined', 'purging', 'completed', 'failed'])[0]?.value.state,
      artifacts: releases.listArtifacts(scenario.release.id).map((artifact) => artifact.storageState),
    }));

  it('does nothing when no job is due', async (): Promise<void> => {
    await expect(processNextDeletionJob(dependencies())).resolves.toBeNull();
  });

  it('quarantines the files, waits for the retention period and then purges them', async (): Promise<void> => {
    const jobId = requestDeletion();

    await expect(processNextDeletionJob(dependencies())).resolves.toEqual({ jobId, outcome: 'quarantined' });
    expect(await exists(releaseDirectory())).toBe(false);
    expect(await readdir(scenario.resolver.resolve(quarantineDirectoryKey(jobId, scenario.release.id)))).toHaveLength(
      2,
    );
    expect(state()).toEqual({ release: 'quarantined', job: 'quarantined', artifacts: ['quarantined', 'quarantined'] });

    scenario.clock.advance(RETENTION_MS - 1);
    await expect(processNextDeletionJob(dependencies())).resolves.toBeNull();

    scenario.clock.advance(1);
    await expect(processNextDeletionJob(dependencies())).resolves.toEqual({ jobId, outcome: 'purged' });
    expect(await readdir(path.join(scenario.resolver.root, 'quarantine'))).toEqual([]);
    expect(state()).toEqual({ release: 'purged', job: 'completed', artifacts: ['purged', 'purged'] });
    expect(auditActions(scenario)).toEqual([
      'release.delete.requested:success',
      'release.delete.quarantined:success',
      'release.delete.completed:success',
    ]);
    expect(scenario.test.database.prepare('SELECT locked_by FROM deletion_jobs').get()).toEqual({ locked_by: null });
  });

  it('stops for a manual review when the release directory was tampered with', async (): Promise<void> => {
    requestDeletion();
    await writeFile(path.join(releaseDirectory(), 'planted.exe'), 'x');

    await expect(processNextDeletionJob(dependencies())).resolves.toMatchObject({ outcome: 'failed' });
    expect(state()).toEqual({ release: 'pending_deletion', job: 'failed', artifacts: ['stored', 'stored'] });
    expect(await readdir(releaseDirectory())).toHaveLength(3);
    expect(
      scenario.test.unitOfWork.read(({ deletionJobs }) => deletionJobs.listByState(['failed'])[0]?.value),
    ).toMatchObject({ requiresManualReview: true, lastErrorCode: 'unexpected_entry', failedPhase: 'quarantine' });
    expect(auditActions(scenario).at(-1)).toBe('release.delete.failed:failed');
  });

  it('schedules a retry when files are locked and never reports the release as deleted', async (): Promise<void> => {
    requestDeletion();
    const locked: StorageOutcome = { ok: false, failure: { errorCode: 'io_ebusy', securityViolation: false } };
    const lockedStorage = withOverride(scenario.storage, {
      moveToQuarantine: (): Promise<StorageOutcome> => Promise.resolve(locked),
    });

    await expect(processNextDeletionJob(dependencies(lockedStorage))).resolves.toMatchObject({
      outcome: 'retry_scheduled',
    });
    expect(state()).toEqual({ release: 'pending_deletion', job: 'requested', artifacts: ['stored', 'stored'] });
    await expect(processNextDeletionJob(dependencies(lockedStorage))).resolves.toBeNull();

    scenario.clock.advance(60_000);
    await expect(processNextDeletionJob(dependencies())).resolves.toMatchObject({ outcome: 'quarantined' });
    expect(auditActions(scenario)).toContain('release.delete.retry_scheduled:failed');
  });

  it('backs off when the job was changed by someone else meanwhile', async (): Promise<void> => {
    const jobId = requestDeletion();
    const interfering = withOverride(scenario.storage, {
      moveToQuarantine: (): Promise<StorageOutcome> => {
        scenario.test.database.prepare('UPDATE deletion_jobs SET row_version = row_version + 1').run();
        return Promise.resolve({ ok: true });
      },
    });

    await expect(processNextDeletionJob(dependencies(interfering))).resolves.toEqual({ jobId, outcome: 'superseded' });
    expect(scenario.test.database.prepare('SELECT locked_by FROM deletion_jobs').get()).toEqual({ locked_by: null });
  });
});

/** The real storage with single operations replaced, keeping every other method of the instance. */
function withOverride(storage: ArtifactStorage, overrides: Partial<ArtifactStorage>): ArtifactStorage {
  return Object.assign(Object.create(storage) as ArtifactStorage, overrides);
}
