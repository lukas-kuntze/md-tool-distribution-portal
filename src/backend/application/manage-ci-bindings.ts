import {
  createCiBinding as newCiBinding,
  revokeCiBinding as revoked,
  sameCiBinding,
  type CiBinding,
} from '../domain/entities/ci-binding.js';
import type { Repositories } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { ApplicationId, CiBindingId } from '../domain/value-objects/identifier.js';
import { applicationTarget, auditChange, authorizedRead, authorizedTransaction } from './authorization.js';
import { requireApplication } from './lookups.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';

/** A CI binding together with what the administration shows about it. */
export interface CiBindingView {
  readonly binding: CiBinding;
  readonly createdBy: string | null;
}

/** Bindings of an application, active ones first. Part of the application settings (`applications.manage`). */
export function listCiBindings(
  dependencies: Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>,
  actor: Actor,
  request: RequestContext,
  applicationId: ApplicationId,
): readonly CiBindingView[] {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, guard) => {
    const application = requireApplication(repositories, applicationId).value;
    guard.require('applications.manage', applicationTarget(application), { type: 'ci_binding', id: null });

    return [...repositories.ciBindings.listByApplication(application.id)]
      .sort((a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null))
      .map((binding) => viewOf(repositories, binding));
  });
}

/** Lets workflows of a repository upload builds into the application (concept 4.7). */
export function createCiBinding(
  dependencies: UseCaseDependencies,
  actor: Actor,
  request: RequestContext,
  input: {
    readonly applicationId: ApplicationId;
    readonly repositoryId: number;
    readonly repositoryName: string;
    readonly refPattern: string;
    readonly environment: string | null;
  },
): CiBindingView {
  const context = contextOf(dependencies, actor, request);

  return authorizedTransaction(context, (repositories, guard) => {
    const application = requireApplication(repositories, input.applicationId).value;
    const target = applicationTarget(application);
    guard.require('applications.manage', target, { type: 'ci_binding', id: null });

    if (application.status !== 'active') {
      throw new DomainError('invalid_ci_binding', 'Archived applications do not accept uploads.');
    }

    const binding = newCiBinding({ ...input, id: dependencies.ids.next<'CiBinding'>() }, context.now, actor.userId);
    const active = repositories.ciBindings
      .listByApplication(application.id)
      .filter((entry) => entry.revokedAt === null);

    if (active.some((entry) => sameCiBinding(entry, binding))) {
      throw new DomainError(
        'ci_binding_exists',
        'An active binding with the same repository, ref and environment exists.',
      );
    }

    repositories.ciBindings.insert(binding);
    repositories.auditLog.append(
      auditChange(context, 'ci_binding.created', target, { type: 'ci_binding', id: binding.id }, describe(binding)),
    );
    return viewOf(repositories, binding);
  });
}

export function revokeCiBinding(
  dependencies: Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>,
  actor: Actor,
  request: RequestContext,
  input: { readonly ciBindingId: CiBindingId },
): void {
  const context = contextOf(dependencies, actor, request);

  authorizedTransaction(context, (repositories, guard) => {
    const binding = repositories.ciBindings.findById(input.ciBindingId);

    if (binding === null) {
      throw new DomainError('ci_binding_not_found', 'The CI binding does not exist or was already revoked.');
    }

    const target = applicationTarget(requireApplication(repositories, binding.applicationId).value);
    guard.require('applications.manage', target, { type: 'ci_binding', id: binding.id });

    repositories.ciBindings.update(revoked(binding, context.now, actor.userId));
    repositories.auditLog.append(
      auditChange(context, 'ci_binding.revoked', target, { type: 'ci_binding', id: binding.id }, describe(binding)),
    );
  });
}

function describe(binding: CiBinding): Readonly<Record<string, unknown>> {
  return {
    repositoryId: binding.repositoryId,
    repositoryName: binding.repositoryName,
    refPattern: binding.refPattern,
    environment: binding.environment,
  };
}

function viewOf(repositories: Repositories, binding: CiBinding): CiBindingView {
  return { binding, createdBy: repositories.users.findById(binding.createdBy)?.displayName ?? null };
}
