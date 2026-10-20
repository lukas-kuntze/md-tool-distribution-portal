import { mkdir, readdir } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { publishRelease } from '../domain/entities/release.js';
import { releaseDirectoryKey } from '../domain/value-objects/storage-key.js';
import { processNextDeletionJob } from './process-next-deletion-job.js';
import { restoreQuarantinedRelease } from './restore-quarantined-release.js';
import { submitReleaseDeletion } from './submit-release-deletion.js';
import {
  auditActions,
  createDeletionScenario,
  RETENTION_MS,
  type DeletionScenario,
} from './testing/deletion-scenario.js';

const errorCode = (code: string): unknown => expect.objectContaining({ code });

describe('restoreQuarantinedRelease', (): void => {
  let scenario: DeletionScenario;

  beforeEach(async (): Promise<void> => {
    scenario = await createDeletionScenario('project-admin');
  });

  afterEach(async (): Promise<void> => {
    await scenario.cleanup();
  });

  async function quarantine(): Promise<void> {
    scenario.test.unitOfWork.transaction(({ releases }) =>
      releases.update(
        publishRelease(scenario.release, ['apk', 'ipa'], scenario.clock.now(), null),
        1,
        scenario.test.context,
      ),
    );
    submitReleaseDeletion(
      { unitOfWork: scenario.test.unitOfWork, clock: scenario.clock, ids: scenario.ids },
      {
        actor: scenario.actor,
        request: scenario.request,
        releaseId: scenario.release.id,
        expectedRowVersion: 2,
        confirmation: scenario.confirmation,
        reason: 'Versehentlich',
      },
    );
    await processNextDeletionJob({
      unitOfWork: scenario.test.unitOfWork,
      storage: scenario.storage,
      clock: scenario.clock,
      workerId: 'worker-1',
      leaseMs: 60_000,
      quarantineRetentionMs: RETENTION_MS,
    });
  }

  const restore = (): Promise<void> =>
    restoreQuarantinedRelease(
      { unitOfWork: scenario.test.unitOfWork, storage: scenario.storage, clock: scenario.clock },
      { actor: scenario.actor, request: scenario.request, releaseId: scenario.release.id },
    );

  const releaseDirectory = (): string =>
    scenario.resolver.resolve(releaseDirectoryKey(scenario.release.applicationId, scenario.release.id));

  it('moves the files back and returns the release withdrawn', async (): Promise<void> => {
    await quarantine();
    await restore();

    expect(await readdir(releaseDirectory())).toHaveLength(2);
    expect(
      scenario.test.unitOfWork.read(({ releases }) => ({
        release: releases.findById(scenario.release.id)?.value,
        artifacts: releases.listArtifacts(scenario.release.id).map((artifact) => artifact.storageState),
      })),
    ).toMatchObject({
      release: { lifecycleState: 'active', publicationStatus: 'withdrawn', deletionRequestedAt: null },
      artifacts: ['stored', 'stored'],
    });
    expect(
      scenario.test.unitOfWork.read(({ deletionJobs }) => deletionJobs.findOpenByRelease(scenario.release.id)),
    ).toBeNull();
    expect(auditActions(scenario).at(-1)).toBe('release.delete.restored:success');
  });

  it('keeps the release in quarantine when its directory cannot be restored', async (): Promise<void> => {
    await quarantine();
    await mkdir(releaseDirectory(), { recursive: true });

    await expect(restore()).rejects.toThrow(errorCode('restore_failed'));
    expect(
      scenario.test.unitOfWork.read(({ deletionJobs }) => deletionJobs.findOpenByRelease(scenario.release.id))?.value,
    ).toMatchObject({ state: 'quarantined', lastErrorCode: 'both_locations_exist' });
    expect(auditActions(scenario).at(-1)).toBe('release.delete.restored:failed');
  });

  it('refuses users without the restore permission', async (): Promise<void> => {
    await scenario.cleanup();
    scenario = await createDeletionScenario('release-manager');
    await quarantine();
    scenario.test.database
      .prepare('UPDATE role_assignments SET revoked_at = ?')
      .run(scenario.clock.now().toISOString());

    await expect(restore()).rejects.toThrow(errorCode('permission_denied'));
    expect(auditActions(scenario).at(-1)).toBe('authz.denied:denied');
  });

  it('only restores releases that wait in quarantine', async (): Promise<void> => {
    await expect(restore()).rejects.toThrow(errorCode('deletion_job_not_found'));
  });
});
