import { createDeletionJob } from '../domain/entities/deletion-job.js';
import { assertDeletionConfirmed, requestReleaseDeletion } from '../domain/entities/release.js';
import type { Clock } from '../domain/ports/clock.js';
import type { IdGenerator } from '../domain/ports/id-generator.js';
import type { UnitOfWork } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { DeletionJobId, ReleaseId } from '../domain/value-objects/identifier.js';
import { applicationTarget, auditChange, authorizedTransaction } from './authorization.js';
import { assertUnchanged, requireRelease } from './lookups.js';
import type { Actor, RequestContext } from './request-context.js';

export interface SubmitReleaseDeletionDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface SubmitReleaseDeletionInput {
  readonly actor: Actor;
  readonly request: RequestContext;
  readonly releaseId: ReleaseId;
  /** Version of the release the user saw when confirming, so that nobody deletes something that changed meanwhile. */
  readonly expectedRowVersion: number;
  readonly confirmation: string;
  readonly reason: string;
}

/**
 * First step of a deletion: the release disappears at once and a deletion job is queued in the same
 * transaction. Files are not touched here; the deletion worker moves them into quarantine.
 */
export function submitReleaseDeletion(
  dependencies: SubmitReleaseDeletionDependencies,
  input: SubmitReleaseDeletionInput,
): { readonly deletionJobId: DeletionJobId } {
  const { unitOfWork, clock, ids } = dependencies;
  const context = { unitOfWork, actor: input.actor, request: input.request, now: clock.now() };

  return authorizedTransaction(context, (repositories, guard) => {
    const { stored, application, flavor } = requireRelease(repositories, input.releaseId);
    const release = stored.value;
    const target = applicationTarget(application);

    guard.require('releases.delete', target, { type: 'release', id: release.id });
    assertUnchanged(stored, input.expectedRowVersion);
    assertDeletionConfirmed(
      {
        applicationSlug: application.slug,
        flavorKey: application.flavorsEnabled ? flavor.key : null,
        version: release.version,
        buildNumber: release.buildNumber,
      },
      input.confirmation,
    );

    // A file whose removal has not reached quarantine yet still lies in the release directory but belongs to
    // another job; deleting the release has to wait until it has been moved.
    const pendingRemoval = repositories.deletionJobs
      .listOpenArtifactJobs(release.id)
      .some(
        ({ value }) =>
          value.state === 'requested' || value.state === 'quarantining' || value.failedPhase === 'quarantine',
      );

    if (pendingRemoval) {
      throw new DomainError(
        'deletion_already_requested',
        'An artifact of this release is being removed; delete the release once it is in quarantine.',
      );
    }

    const snapshot = repositories.releases
      .listArtifacts(release.id)
      .filter((artifact) => artifact.storageState === 'stored')
      .map((artifact) => ({
        artifactId: artifact.id,
        storageKey: artifact.storageKey,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
      }));
    const job = createDeletionJob(
      {
        id: ids.next(),
        releaseId: release.id,
        requestedBy: input.actor.userId,
        reason: input.reason,
        artifactSnapshot: snapshot,
      },
      context.now,
    );

    repositories.releases.update(requestReleaseDeletion(release, context.now, input.actor.userId), stored.rowVersion, {
      actor: input.actor.userId,
      at: context.now,
    });
    repositories.deletionJobs.insert(job);
    repositories.auditLog.append(
      auditChange(
        context,
        'release.delete.requested',
        target,
        { type: 'release', id: release.id },
        {
          deletionJobId: job.id,
          flavorKey: flavor.key,
          version: release.version.value,
          buildNumber: release.buildNumber,
          publicationStatus: release.publicationStatus,
          reason: job.reason,
          artifacts: snapshot.length,
          bytes: snapshot.reduce((total, entry) => total + entry.sizeBytes, 0),
        },
      ),
    );

    return { deletionJobId: job.id };
  });
}
