import type { Application } from '../domain/entities/application.js';
import type { Project } from '../domain/entities/project.js';
import type { AuditEntry } from '../domain/ports/audit-log.js';
import type { Repositories, UnitOfWork } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import { EffectivePermissions } from '../domain/value-objects/effective-permissions.js';
import type { Permission } from '../domain/value-objects/permission.js';
import { GLOBAL, type Target } from '../domain/value-objects/scope.js';
import type { Actor, RequestContext } from './request-context.js';

export interface Denial {
  readonly permission: Permission;
  readonly target: Target;
  readonly subject: { readonly type: string; readonly id: string | null };
}

export interface Guard {
  readonly permissions: EffectivePermissions;
  /** Aborts the surrounding transaction unless the actor holds the permission at the target. */
  require(permission: Permission, target: Target, subject: Denial['subject']): void;
}

/** Everything a use case needs to run work on behalf of a signed-in user. */
export interface ActorContext {
  readonly unitOfWork: UnitOfWork;
  readonly actor: Actor;
  readonly request: RequestContext;
  readonly now: Date;
}

/**
 * Runs work in a read-write transaction with a guard. A refused permission rolls the transaction back,
 * is recorded in an audit transaction of its own and surfaces as `permission_denied`.
 */
export function authorizedTransaction<Result>(
  context: ActorContext,
  work: (repositories: Repositories, guard: Guard) => Result,
): Result {
  return withDenialRecording(context, () =>
    context.unitOfWork.transaction((repositories) => work(repositories, guardFor(repositories, context))),
  );
}

export function authorizedRead<Result>(
  context: ActorContext,
  work: (repositories: Repositories, guard: Guard) => Result,
): Result {
  return withDenialRecording(context, () =>
    context.unitOfWork.read((repositories) => work(repositories, guardFor(repositories, context))),
  );
}

export function permissionsOf(repositories: Repositories, actor: Actor, now: Date): EffectivePermissions {
  const { access } = repositories;
  return new EffectivePermissions(
    { userId: actor.userId, teamIds: access.teamIdsOf(actor.userId) },
    access.grantsForUser(actor.userId),
    now,
  );
}

export function applicationTarget(application: Application): Target {
  return { type: 'application', projectId: application.projectId, applicationId: application.id };
}

export function projectTarget(project: Pick<Project, 'id'>): Target {
  return { type: 'project', projectId: project.id };
}

export const GLOBAL_TARGET: Target = GLOBAL;

type EntryFields = Pick<AuditEntry, 'action' | 'target' | 'projectId' | 'applicationId' | 'outcome' | 'details'>;

export function userAuditEntry(actor: Actor, request: RequestContext, now: Date, fields: EntryFields): AuditEntry {
  return {
    ...fields,
    occurredAt: now,
    actor: { type: 'user', userId: actor.userId, label: actor.label },
    correlationId: request.correlationId,
    clientIp: request.clientIp,
    userAgent: request.userAgent,
  };
}

export function systemAuditEntry(label: string, now: Date, fields: EntryFields): AuditEntry {
  return {
    ...fields,
    occurredAt: now,
    actor: { type: 'system', label },
    correlationId: null,
    clientIp: null,
    userAgent: null,
  };
}

/** Audit entry of the acting user for a change to a project, an application or something inside one. */
export function auditChange(
  context: ActorContext,
  action: string,
  target: Target,
  subject: Denial['subject'],
  details: Readonly<Record<string, unknown>>,
): AuditEntry {
  return userAuditEntry(context.actor, context.request, context.now, {
    action,
    target: subject,
    projectId: target.type === 'global' ? null : target.projectId,
    applicationId: target.type === 'application' ? target.applicationId : null,
    outcome: 'success',
    details,
  });
}

class DenialSignal extends Error {
  public constructor(public readonly denial: Denial) {
    super('Permission denied.');
    this.name = 'DenialSignal';
  }
}

function guardFor(repositories: Repositories, context: ActorContext): Guard {
  const permissions = permissionsOf(repositories, context.actor, context.now);

  return {
    permissions,
    require(permission: Permission, target: Target, subject: Denial['subject']): void {
      if (!permissions.allows(permission, target)) {
        throw new DenialSignal({ permission, target, subject });
      }
    },
  };
}

function withDenialRecording<Result>(context: ActorContext, work: () => Result): Result {
  try {
    return work();
  } catch (error) {
    if (!(error instanceof DenialSignal)) {
      throw error;
    }

    const { denial } = error;
    context.unitOfWork.transaction(({ auditLog }) =>
      auditLog.append(
        userAuditEntry(context.actor, context.request, context.now, {
          action: 'authz.denied',
          target: denial.subject,
          projectId: denial.target.type === 'global' ? null : denial.target.projectId,
          applicationId: denial.target.type === 'application' ? denial.target.applicationId : null,
          outcome: 'denied',
          details: { permission: denial.permission },
        }),
      ),
    );

    throw new DomainError('permission_denied', 'The action is not permitted for this user at this scope.');
  }
}
