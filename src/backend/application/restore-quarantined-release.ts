import { completeRestore, failRestore, startRestore } from '../domain/entities/deletion-job.js';
import { markArtifactRestored } from '../domain/entities/release-artifact.js';
import { restoreRelease } from '../domain/entities/release.js';
import type { ArtifactStorage } from '../domain/ports/artifact-storage.js';
import type { Clock } from '../domain/ports/clock.js';
import type { UnitOfWork } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { ReleaseId } from '../domain/value-objects/identifier.js';
import { quarantineDirectoryKey, releaseDirectoryKey } from '../domain/value-objects/storage-key.js';
import { applicationTarget, auditChange, authorizedTransaction } from './authorization.js';
import { requireRelease } from './lookups.js';
import type { Actor, RequestContext } from './request-context.js';

export interface RestoreQuarantinedReleaseDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly storage: ArtifactStorage;
  readonly clock: Clock;
}

export interface RestoreQuarantinedReleaseInput {
  readonly actor: Actor;
  readonly request: RequestContext;
  readonly releaseId: ReleaseId;
}

/**
 * Takes a release back out of quarantine. It returns withdrawn, so that it is published again deliberately.
 * Setting the job to `restoring` first keeps the worker from purging the release while its files move back.
 */
export async function restoreQuarantinedRelease(
  dependencies: RestoreQuarantinedReleaseDependencies,
  input: RestoreQuarantinedReleaseInput,
): Promise<void> {
  const { unitOfWork, storage, clock } = dependencies;
  const context = { unitOfWork, actor: input.actor, request: input.request, now: clock.now() };

  const { restoring, rowVersion, application } = authorizedTransaction(context, (repositories, guard) => {
    const { stored, application } = requireRelease(repositories, input.releaseId);

    guard.require('releases.restore', applicationTarget(application), { type: 'release', id: stored.value.id });

    const job = repositories.deletionJobs.findOpenByRelease(stored.value.id);

    if (job === null) {
      throw new DomainError('deletion_job_not_found', 'The release is not waiting in quarantine.');
    }

    const started = startRestore(job.value);
    return { restoring: started, rowVersion: repositories.deletionJobs.update(started, job.rowVersion), application };
  });

  const outcome = await storage.restoreFromQuarantine(
    quarantineDirectoryKey(restoring.id, restoring.releaseId),
    releaseDirectoryKey(application.id, restoring.releaseId),
    restoring.artifactSnapshot,
  );
  const finished = { ...context, now: clock.now() };
  const subject = { type: 'release', id: restoring.releaseId };

  unitOfWork.transaction((repositories) => {
    if (!outcome.ok) {
      repositories.deletionJobs.update(failRestore(restoring, outcome.failure.errorCode), rowVersion);
      repositories.auditLog.append({
        ...auditChange(finished, 'release.delete.restored', applicationTarget(application), subject, {
          deletionJobId: restoring.id,
          errorCode: outcome.failure.errorCode,
        }),
        outcome: 'failed',
      });
      return;
    }

    const { stored } = requireRelease(repositories, restoring.releaseId);
    repositories.releases.update(restoreRelease(stored.value), stored.rowVersion, {
      actor: input.actor.userId,
      at: finished.now,
    });

    // Only the files of this job come back; artifacts removed on their own stay in their quarantine.
    const restored = new Set(restoring.artifactSnapshot.map((entry) => entry.artifactId));

    for (const artifact of repositories.releases.listArtifacts(restoring.releaseId)) {
      if (artifact.storageState === 'quarantined' && restored.has(artifact.id)) {
        repositories.releases.updateArtifactState(markArtifactRestored(artifact));
      }
    }

    repositories.deletionJobs.update(completeRestore(restoring, finished.now), rowVersion);
    repositories.auditLog.append(
      auditChange(finished, 'release.delete.restored', applicationTarget(application), subject, {
        deletionJobId: restoring.id,
      }),
    );
  });

  if (!outcome.ok) {
    throw new DomainError(
      'restore_failed',
      'The release could not be moved back out of quarantine; it stays quarantined.',
    );
  }
}
