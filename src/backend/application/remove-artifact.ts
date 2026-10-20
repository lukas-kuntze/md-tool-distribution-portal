import { completeRestore, createDeletionJob, failRestore, startRestore } from '../domain/entities/deletion-job.js';
import { markArtifactRestored } from '../domain/entities/release-artifact.js';
import type { ArtifactStorage } from '../domain/ports/artifact-storage.js';
import type { Clock } from '../domain/ports/clock.js';
import type { IdGenerator } from '../domain/ports/id-generator.js';
import type { Repositories, UnitOfWork } from '../domain/ports/unit-of-work.js';
import { artifactKindSpec } from '../domain/value-objects/artifact-kind.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { ArtifactId, DeletionJobId } from '../domain/value-objects/identifier.js';
import { quarantineDirectoryKey } from '../domain/value-objects/storage-key.js';
import { applicationTarget, auditChange, authorizedTransaction } from './authorization.js';
import { requireRelease, type ReleaseContext } from './lookups.js';
import type { Actor, RequestContext } from './request-context.js';

export interface RemoveArtifactDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * Removes a single artifact, e.g. an IPA uploaded by mistake, through the same quarantine as a release: the
 * file disappears from downloads, the deletion worker moves it into quarantine and purges it after the
 * retention period; until then it can be restored. Needs `artifacts.delete`.
 *
 * A published release must stay installable, so its platform builds (APK, AAB, IPA) can only be removed after
 * withdrawing it; files such as dSYM or mapping files can be removed at any time.
 */
export function requestArtifactRemoval(
  dependencies: RemoveArtifactDependencies,
  actor: Actor,
  request: RequestContext,
  input: { readonly artifactId: ArtifactId; readonly reason: string },
): { readonly deletionJobId: DeletionJobId } {
  const { unitOfWork, clock, ids } = dependencies;
  const context = { unitOfWork, actor, request, now: clock.now() };

  return authorizedTransaction(context, (repositories, guard) => {
    const { artifact, release, target } = requireArtifact(repositories, input.artifactId);

    guard.require('artifacts.delete', target, { type: 'artifact', id: artifact.id });

    if (artifact.storageState !== 'stored') {
      throw new DomainError('invalid_artifact_state', 'Only stored artifacts can be removed.');
    }

    if (release.stored.value.lifecycleState !== 'active') {
      throw new DomainError('invalid_release_state', 'Artifacts of a release in deletion cannot be removed.');
    }

    if (
      release.stored.value.publicationStatus === 'published' &&
      artifactKindSpec(artifact.kind).providesPlatformBuild
    ) {
      throw new DomainError(
        'artifact_locked_after_publication',
        'Platform builds cannot be removed from a published release; withdraw it first.',
      );
    }

    const job = createDeletionJob(
      {
        id: ids.next(),
        releaseId: artifact.releaseId,
        artifactId: artifact.id,
        requestedBy: actor.userId,
        reason: input.reason,
        artifactSnapshot: [
          {
            artifactId: artifact.id,
            storageKey: artifact.storageKey,
            sizeBytes: artifact.sizeBytes,
            sha256: artifact.sha256,
          },
        ],
      },
      context.now,
    );

    repositories.deletionJobs.insert(job);
    repositories.auditLog.append(
      auditChange(
        context,
        'artifact.delete.requested',
        target,
        { type: 'artifact', id: artifact.id },
        {
          deletionJobId: job.id,
          releaseId: artifact.releaseId,
          kind: artifact.kind,
          sizeBytes: artifact.sizeBytes,
          sha256: artifact.sha256,
          reason: job.reason,
        },
      ),
    );

    return { deletionJobId: job.id };
  });
}

/** Moves a removed artifact back out of quarantine; needs `releases.restore`, like restoring a release. */
export async function restoreRemovedArtifact(
  dependencies: Omit<RemoveArtifactDependencies, 'ids'> & { readonly storage: ArtifactStorage },
  actor: Actor,
  request: RequestContext,
  input: { readonly artifactId: ArtifactId },
): Promise<void> {
  const { unitOfWork, storage, clock } = dependencies;
  const context = { unitOfWork, actor, request, now: clock.now() };

  const { restoring, rowVersion, target } = authorizedTransaction(context, (repositories, guard) => {
    const found = requireArtifact(repositories, input.artifactId);

    guard.require('releases.restore', found.target, { type: 'artifact', id: found.artifact.id });

    if (found.release.stored.value.lifecycleState !== 'active') {
      throw new DomainError('invalid_release_state', 'Restore the release first; its artifacts follow with it.');
    }

    const job = repositories.deletionJobs.findOpenByArtifact(found.artifact.id);

    if (job === null) {
      throw new DomainError('deletion_job_not_found', 'The artifact is not waiting in quarantine.');
    }

    const started = startRestore(job.value);
    return {
      restoring: started,
      rowVersion: repositories.deletionJobs.update(started, job.rowVersion),
      target: found.target,
    };
  });

  const [entry] = restoring.artifactSnapshot;
  const outcome =
    entry === undefined
      ? ({ ok: false, failure: { errorCode: 'snapshot_empty', securityViolation: true } } as const)
      : await storage.restoreArtifact(quarantineDirectoryKey(restoring.id, restoring.releaseId), entry);
  const finished = { ...context, now: clock.now() };
  const subject = { type: 'artifact', id: input.artifactId };

  unitOfWork.transaction((repositories) => {
    if (!outcome.ok) {
      repositories.deletionJobs.update(failRestore(restoring, outcome.failure.errorCode), rowVersion);
      repositories.auditLog.append({
        ...auditChange(finished, 'artifact.delete.restored', target, subject, {
          deletionJobId: restoring.id,
          errorCode: outcome.failure.errorCode,
        }),
        outcome: 'failed',
      });
      return;
    }

    const artifact = repositories.releases.findArtifact(input.artifactId);

    if (artifact?.storageState === 'quarantined') {
      repositories.releases.updateArtifactState(markArtifactRestored(artifact));
    }

    repositories.deletionJobs.update(completeRestore(restoring, finished.now), rowVersion);
    repositories.auditLog.append(
      auditChange(finished, 'artifact.delete.restored', target, subject, { deletionJobId: restoring.id }),
    );
  });

  if (!outcome.ok) {
    throw new DomainError('restore_failed', 'The artifact could not be moved back out of quarantine.');
  }
}

function requireArtifact(
  repositories: Repositories,
  artifactId: ArtifactId,
): {
  readonly artifact: NonNullable<ReturnType<Repositories['releases']['findArtifact']>>;
  readonly release: ReleaseContext;
  readonly target: ReturnType<typeof applicationTarget>;
} {
  const artifact = repositories.releases.findArtifact(artifactId);

  if (artifact === null) {
    throw new DomainError('artifact_not_found', 'The artifact does not exist.');
  }

  const release = requireRelease(repositories, artifact.releaseId);
  return { artifact, release, target: applicationTarget(release.application) };
}
