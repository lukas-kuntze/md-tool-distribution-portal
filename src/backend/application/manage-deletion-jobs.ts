import {
  expediteQuarantine,
  retryFailedJob,
  type DeletionJob,
  type DeletionJobState,
} from '../domain/entities/deletion-job.js';
import type { Stored } from '../domain/ports/stored.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { DeletionJobId } from '../domain/value-objects/identifier.js';
import { auditChange, authorizedRead, authorizedTransaction, GLOBAL_TARGET } from './authorization.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';

type Dependencies = Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>;

/** Deletion jobs for the storage view, e.g. the failed ones that need a manual review. */
export function listDeletionJobs(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: { readonly states: readonly DeletionJobState[] },
): readonly Stored<DeletionJob>[] {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, guard) => {
    guard.require('storage.manage', GLOBAL_TARGET, { type: 'deletion_job', id: null });
    return repositories.deletionJobs.listByState(input.states);
  });
}

/** Resumes a failed job after an administrator has looked into its cause. */
export function retryDeletionJob(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: { readonly deletionJobId: DeletionJobId },
): Stored<DeletionJob> {
  const context = contextOf(dependencies, actor, request);

  return authorizedTransaction(context, (repositories, guard) => {
    guard.require('storage.manage', GLOBAL_TARGET, { type: 'deletion_job', id: input.deletionJobId });

    const stored = repositories.deletionJobs.findById(input.deletionJobId);

    if (stored === null) {
      throw new DomainError('deletion_job_not_found', 'The deletion job does not exist.');
    }

    const retried = retryFailedJob(stored.value, context.now);
    const rowVersion = repositories.deletionJobs.update(retried, stored.rowVersion);
    repositories.auditLog.append(
      auditChange(
        context,
        'release.delete.retried',
        GLOBAL_TARGET,
        { type: 'release', id: retried.releaseId },
        {
          deletionJobId: retried.id,
          failedPhase: stored.value.failedPhase,
          lastErrorCode: stored.value.lastErrorCode,
        },
      ),
    );

    return { value: retried, rowVersion };
  });
}

/**
 * Ends the quarantine of a job early, e.g. for a build that must not stay on disk (`releases.purge`, global only).
 * The release can no longer be restored; the worker purges it on its next run.
 */
export function purgeDeletionJobNow(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: { readonly deletionJobId: DeletionJobId },
): Stored<DeletionJob> {
  const context = contextOf(dependencies, actor, request);

  return authorizedTransaction(context, (repositories, guard) => {
    guard.require('releases.purge', GLOBAL_TARGET, { type: 'deletion_job', id: input.deletionJobId });

    const stored = repositories.deletionJobs.findById(input.deletionJobId);

    if (stored === null) {
      throw new DomainError('deletion_job_not_found', 'The deletion job does not exist.');
    }

    const expedited = expediteQuarantine(stored.value, context.now);
    const rowVersion = repositories.deletionJobs.update(expedited, stored.rowVersion);
    repositories.auditLog.append(
      auditChange(
        context,
        'release.delete.expedited',
        GLOBAL_TARGET,
        { type: 'release', id: expedited.releaseId },
        {
          deletionJobId: expedited.id,
          artifactId: expedited.artifactId,
          scheduledPurgeAfter: stored.value.purgeAfter?.toISOString() ?? null,
        },
      ),
    );

    return { value: expedited, rowVersion };
  });
}
