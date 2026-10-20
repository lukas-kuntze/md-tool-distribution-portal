import type { Application } from '../domain/entities/application.js';
import { acceptsJob, type CiBinding } from '../domain/entities/ci-binding.js';
import { updateReleaseTexts } from '../domain/entities/release.js';
import type { AuditEntry } from '../domain/ports/audit-log.js';
import type { CiJob, CiTokenVerifier } from '../domain/ports/ci-token-verifier.js';
import type { Repositories } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { ApplicationId, ReleaseId } from '../domain/value-objects/identifier.js';
import type { Permission } from '../domain/value-objects/permission.js';
import type { Target } from '../domain/value-objects/scope.js';
import { applicationTarget, type Denial } from './authorization.js';
import { requireApplication, requireRelease } from './lookups.js';
import type { RequestContext } from './request-context.js';
import {
  uploadBuildAs,
  uploadReleaseFileAs,
  type SupplementaryKind,
  type UploadDependencies,
  type UploadGuard,
  type Uploader,
  type UploadResult,
} from './upload-artifact.js';

export interface CiDependencies extends UploadDependencies {
  readonly ciTokens: CiTokenVerifier;
}

/** All a CI job may ever do, and only in the application of its binding; never delete or manage access. */
const CI_PERMISSIONS: ReadonlySet<Permission> = new Set(['releases.create', 'artifacts.upload']);

/** Uploads an APK, AAB or IPA from a workflow (GitHub Action in `src/action/`). */
export async function ciUploadBuild(
  dependencies: CiDependencies,
  token: string,
  request: RequestContext,
  input: {
    readonly applicationId: ApplicationId;
    readonly flavorKey: string | null;
    readonly fileName: string;
    readonly content: AsyncIterable<Uint8Array>;
  },
): Promise<UploadResult> {
  const { job, binding } = await authenticate(dependencies, token, request, input.applicationId);

  return uploadBuildAs(dependencies, ciUploader(dependencies, job, binding, request), {
    applicationId: input.applicationId,
    flavorId: null,
    flavorKey: input.flavorKey,
    fileName: input.fileName,
    commitSha: job.sha,
    content: input.content,
  });
}

/** Adds dSYM, mapping or metadata files to a release the same commit produced. */
export async function ciUploadReleaseFile(
  dependencies: CiDependencies,
  token: string,
  request: RequestContext,
  input: {
    readonly releaseId: ReleaseId;
    readonly kind: SupplementaryKind;
    readonly fileName: string;
    readonly content: AsyncIterable<Uint8Array>;
  },
): Promise<UploadResult> {
  const { job, binding } = await authenticateForRelease(dependencies, token, request, input.releaseId);
  return uploadReleaseFileAs(dependencies, ciUploader(dependencies, job, binding, request), input);
}

/**
 * Sets release notes and changelog of a draft that has none yet. Texts somebody has written or published in
 * the portal always win over those of a later workflow run.
 */
export async function ciUpdateReleaseTexts(
  dependencies: CiDependencies,
  token: string,
  request: RequestContext,
  input: { readonly releaseId: ReleaseId; readonly releaseNotes?: string; readonly changelog?: string },
): Promise<{ readonly applied: boolean }> {
  const { job, binding } = await authenticateForRelease(dependencies, token, request, input.releaseId);
  const uploader = ciUploader(dependencies, job, binding, request);

  return uploader.transaction((repositories, guard, now) => {
    const { stored, application, flavor } = requireRelease(repositories, input.releaseId);
    const release = stored.value;
    const target = applicationTarget(application);

    guard.require('releases.create', target, { type: 'release', id: release.id });

    if (release.publicationStatus !== 'draft' || release.lifecycleState !== 'active') {
      return { applied: false };
    }

    const changes = {
      ...(input.releaseNotes === undefined || release.metadata.releaseNotes !== ''
        ? {}
        : { releaseNotes: input.releaseNotes }),
      ...(input.changelog === undefined || release.metadata.changelog !== '' ? {} : { changelog: input.changelog }),
    };

    if (Object.keys(changes).length === 0) {
      return { applied: false };
    }

    const changed = updateReleaseTexts(release, changes);
    repositories.releases.update(changed, stored.rowVersion, { actor: null, at: now });
    repositories.auditLog.append(
      uploader.audit(
        now,
        'release.updated',
        target,
        { type: 'release', id: release.id },
        {
          flavorKey: flavor.key,
          version: release.version.value,
          buildNumber: release.buildNumber,
          fields: Object.keys(changes),
        },
      ),
    );
    return { applied: true };
  });
}

/* -- Authentication ---------------------------------------------------------------------------------------- */

interface Authenticated {
  readonly job: CiJob;
  readonly binding: CiBinding;
}

/**
 * A job is accepted for an application when its verified token matches an active binding of that application:
 * same repository id, a ref the pattern covers and, if the binding names one, the same environment.
 */
async function authenticate(
  dependencies: CiDependencies,
  token: string,
  request: RequestContext,
  applicationId: ApplicationId,
): Promise<Authenticated> {
  const job = await dependencies.ciTokens.verify(token);
  const binding = dependencies.unitOfWork.read((repositories) => {
    requireApplication(repositories, applicationId);
    return repositories.ciBindings.listByApplication(applicationId).find((entry) => acceptsJob(entry, job)) ?? null;
  });

  if (binding === null) {
    dependencies.unitOfWork.transaction(({ applications, auditLog }) => {
      const application = applications.findById(applicationId)?.value;
      auditLog.append(
        ciAuditEntry(job, request, dependencies.clock.now(), {
          action: 'ci.denied',
          target: { type: 'application', id: applicationId },
          projectId: application?.projectId ?? null,
          applicationId,
          outcome: 'denied',
          details: {
            repository: job.repository,
            repositoryId: job.repositoryId,
            ref: job.ref,
            environment: job.environment,
          },
        }),
      );
    });
    throw new DomainError(
      'ci_not_bound',
      'No CI binding of the application accepts this repository, ref and environment.',
    );
  }

  return { job, binding };
}

async function authenticateForRelease(
  dependencies: CiDependencies,
  token: string,
  request: RequestContext,
  releaseId: ReleaseId,
): Promise<Authenticated> {
  const release = dependencies.unitOfWork.read((repositories) => requireRelease(repositories, releaseId).stored.value);
  const authenticated = await authenticate(dependencies, token, request, release.applicationId);

  // A run may only add to releases built from its own commit, not touch any release of the application.
  if (authenticated.job.sha !== release.gitCommitSha) {
    throw new DomainError('artifact_commit_mismatch', 'The release was built from a different commit than this run.');
  }

  return authenticated;
}

/* -- Uploader ---------------------------------------------------------------------------------------------- */

class CiDenial extends Error {
  public constructor(public readonly denial: Denial) {
    super('Permission denied.');
    this.name = 'CiDenial';
  }
}

function ciUploader(
  dependencies: Pick<CiDependencies, 'unitOfWork' | 'clock'>,
  job: CiJob,
  binding: CiBinding,
  request: RequestContext,
): Uploader {
  const guard: UploadGuard = {
    require(permission: Permission, target: Target, subject: Denial['subject']): void {
      const inBinding = target.type === 'application' && target.applicationId === binding.applicationId;

      if (!inBinding || !CI_PERMISSIONS.has(permission)) {
        throw new CiDenial({ permission, target, subject });
      }
    },
  };

  const guarded = <Result>(work: () => Result): Result => {
    try {
      return work();
    } catch (error) {
      if (!(error instanceof CiDenial)) {
        throw error;
      }

      const { denial } = error;
      dependencies.unitOfWork.transaction(({ auditLog }) =>
        auditLog.append(
          ciAuditEntry(job, request, dependencies.clock.now(), {
            action: 'authz.denied',
            target: denial.subject,
            projectId: denial.target.type === 'global' ? null : denial.target.projectId,
            applicationId: denial.target.type === 'application' ? denial.target.applicationId : null,
            outcome: 'denied',
            details: { permission: denial.permission, ciBindingId: binding.id },
          }),
        ),
      );
      throw new DomainError('ci_not_bound', 'The CI binding does not allow this action.');
    }
  };

  const [kind, ...rest] = job.ref.replace(/^refs\//, '').split('/');
  const refName = rest.join('/');

  return {
    source: 'ci',
    userId: null,
    origin: {
      gitRepository: job.repository,
      gitBranch: kind === 'heads' ? refName : null,
      gitTag: kind === 'tags' ? refName : null,
      workflowRun: job.workflowRun,
    },
    read: (work) => guarded(() => dependencies.unitOfWork.read((repositories) => work(repositories, guard))),
    transaction: (work) =>
      guarded(() => {
        const now = dependencies.clock.now();
        return dependencies.unitOfWork.transaction((repositories) => work(repositories, guard, now));
      }),
    application: (repositories: Repositories, applicationId: ApplicationId): Application => {
      if (applicationId !== binding.applicationId) {
        throw new DomainError('ci_not_bound', 'The CI binding does not allow this action.');
      }

      return requireApplication(repositories, applicationId).value;
    },
    audit: (now, action, target, subject, details) =>
      ciAuditEntry(job, request, now, {
        action,
        target: subject,
        projectId: target.type === 'global' ? null : target.projectId,
        applicationId: target.type === 'application' ? target.applicationId : null,
        outcome: 'success',
        details: { ...details, ciBindingId: binding.id, workflowRunUrl: job.workflowRun.url },
      }),
  };
}

type EntryFields = Pick<AuditEntry, 'action' | 'target' | 'projectId' | 'applicationId' | 'outcome' | 'details'>;

/** The audit log names the job by repository and ref, and the GitHub user who started it. */
function ciAuditEntry(job: CiJob, request: RequestContext, now: Date, fields: EntryFields): AuditEntry {
  return {
    ...fields,
    details: { ...fields.details, triggeredBy: job.actor },
    occurredAt: now,
    actor: { type: 'ci', label: `${job.repository}@${job.ref}` },
    correlationId: request.correlationId,
    clientIp: request.clientIp,
    userAgent: request.userAgent,
  };
}
