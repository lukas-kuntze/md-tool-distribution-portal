import { assertGrantAllowed, assertRevokeAllowed, type Role } from '../domain/entities/role-assignment.js';
import type { AssignmentRecord } from '../domain/ports/access-repository.js';
import type { UserSummary } from '../domain/ports/user-repository.js';
import type { Repositories } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { Grant } from '../domain/value-objects/effective-permissions.js';
import type { ApplicationId, ProjectId, RoleAssignmentId, RoleId, UserId } from '../domain/value-objects/identifier.js';
import { PERMISSIONS, type Permission } from '../domain/value-objects/permission.js';
import { GLOBAL, scopeOf, type Scope, type Target } from '../domain/value-objects/scope.js';
import { auditChange, authorizedRead, authorizedTransaction, permissionsOf } from './authorization.js';
import { requireApplication, requireProject } from './lookups.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';

type Dependencies = Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>;

/** Scope as sent by a client; an application scope is resolved to its project on the server. */
export type ScopeInput =
  | { readonly type: 'global' }
  | { readonly type: 'project'; readonly projectId: ProjectId }
  | { readonly type: 'application'; readonly applicationId: ApplicationId };

export interface AssignmentView {
  readonly record: AssignmentRecord;
  readonly role: Role | null;
  readonly principal: UserSummary | null;
  /** Assigned at an enclosing scope and therefore inherited by the requested one. */
  readonly inherited: boolean;
}

export function listRoles(dependencies: Dependencies, actor: Actor, request: RequestContext): readonly Role[] {
  return authorizedRead(contextOf(dependencies, actor, request), ({ access }) => access.listRoles());
}

/** Assignments that take effect at a scope, including those inherited from the project and the platform. */
export function listAssignments(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: { readonly scope: ScopeInput; readonly includeRevoked: boolean },
): readonly AssignmentView[] {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, guard) => {
    const target = resolveTarget(repositories, input.scope);
    guard.require('permissions.manage', target, { type: 'scope', id: scopeId(target) });

    const roles = new Map(repositories.access.listRoles().map((role) => [role.id, role]));
    const own = scopeOf(target);

    return enclosingScopes(target).flatMap((scope) =>
      repositories.access.listAssignments({ scope, includeRevoked: input.includeRevoked }).map((record) => ({
        record,
        role: roles.get(record.roleId) ?? null,
        principal:
          record.grant.principal.type === 'user' ? repositories.users.findSummary(record.grant.principal.userId) : null,
        inherited: JSON.stringify(scope) !== JSON.stringify(own),
      })),
    );
  });
}

export interface GrantRoleInput {
  readonly roleId: RoleId;
  readonly userId: UserId;
  readonly scope: ScopeInput;
  readonly reason: string;
  readonly expiresAt: Date | null;
}

export function grantRole(
  dependencies: UseCaseDependencies,
  actor: Actor,
  request: RequestContext,
  input: GrantRoleInput,
): { readonly assignmentId: RoleAssignmentId } {
  const context = contextOf(dependencies, actor, request);

  return authorizedTransaction(context, (repositories, guard) => {
    const target = resolveTarget(repositories, input.scope);
    guard.require('permissions.manage', target, { type: 'scope', id: scopeId(target) });

    const role = repositories.access.listRoles().find((candidate) => candidate.id === input.roleId);
    const user = repositories.users.findById(input.userId);
    const reason = input.reason.trim();

    if (role === undefined) {
      throw new DomainError('role_not_found', 'The role does not exist.');
    }

    if (user === null) {
      throw new DomainError('user_not_found', 'The user does not exist.');
    }

    if (reason.length === 0) {
      throw new DomainError('reason_required', 'Granting a role requires a reason.');
    }

    if (input.expiresAt !== null && input.expiresAt.getTime() <= context.now.getTime()) {
      throw new DomainError('invalid_request', 'The expiry date must lie in the future.');
    }

    assertGrantAllowed(guard.permissions, role, target);

    const assignmentId = dependencies.ids.next<'RoleAssignment'>();
    repositories.access.insertAssignment(
      {
        id: assignmentId,
        roleId: role.id,
        principal: { type: 'user', userId: user.id },
        scope: scopeOf(target),
        reason,
        expiresAt: input.expiresAt,
        source: 'manual',
      },
      { actor: actor.userId, at: context.now },
    );
    repositories.auditLog.append(
      auditChange(
        context,
        'role_assignment.granted',
        target,
        { type: 'role_assignment', id: assignmentId },
        {
          role: role.key,
          userId: user.id,
          scope: scopeOf(target),
          reason,
          expiresAt: input.expiresAt?.toISOString() ?? null,
        },
      ),
    );

    return { assignmentId };
  });
}

/** Revoking needs the same standing as granting, so delegates cannot remove roles they could not hand out. */
export function revokeRole(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: { readonly assignmentId: RoleAssignmentId },
): void {
  const context = contextOf(dependencies, actor, request);

  authorizedTransaction(context, (repositories, guard) => {
    const grant = repositories.access.findGrant(input.assignmentId);

    if (grant === null || grant.revokedAt !== null) {
      throw new DomainError('assignment_not_found', 'The role assignment does not exist or was already revoked.');
    }

    const target = resolveTarget(repositories, grant.scope);
    const role = repositories.access.findRoleByKey(grant.roleKey);

    guard.require('permissions.manage', target, { type: 'role_assignment', id: grant.assignmentId });

    if (role !== null) {
      assertGrantAllowed(guard.permissions, role, target);
    }

    assertRevokeAllowed(grant, repositories.access.countActiveGlobalPlatformAdmins(context.now));
    repositories.access.revokeAssignment(grant.assignmentId, { actor: actor.userId, at: context.now });
    repositories.auditLog.append(
      auditChange(
        context,
        'role_assignment.revoked',
        target,
        { type: 'role_assignment', id: grant.assignmentId },
        {
          role: grant.roleKey,
          principal: grant.principal,
          scope: grant.scope,
        },
      ),
    );
  });
}

/** Users the platform knows, i.e. who signed in at least once; for anyone managing permissions somewhere. */
export function searchUsers(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: { readonly query: string; readonly limit: number },
): readonly UserSummary[] {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, guard) => {
    const managesSomewhere = repositories.access
      .grantsForUser(actor.userId)
      .some((grant) => grant.permissions.has('permissions.manage'));

    if (!managesSomewhere) {
      guard.require('permissions.manage', GLOBAL, { type: 'user', id: null });
    }

    return repositories.users.search(input.query, input.limit);
  });
}

export interface PermissionExplanation {
  readonly permission: Permission;
  readonly allowed: boolean;
  readonly grants: readonly Grant[];
}

/** "Why may this user do that?": every permission at a scope together with the grants it derives from. */
export function explainPermissions(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: { readonly userId: UserId; readonly scope: ScopeInput },
): readonly PermissionExplanation[] {
  const context = contextOf(dependencies, actor, request);

  return authorizedRead(context, (repositories, guard) => {
    const target = resolveTarget(repositories, input.scope);
    guard.require('permissions.manage', target, { type: 'user', id: input.userId });

    const permissions = permissionsOf(repositories, { userId: input.userId, label: '' }, context.now);

    return PERMISSIONS.map((permission) => {
      const grants = permissions.grantsFor(permission, target);
      return { permission, allowed: grants.length > 0, grants };
    });
  });
}

export function resolveTarget(repositories: Repositories, scope: ScopeInput): Target {
  switch (scope.type) {
    case 'global':
      return GLOBAL;
    case 'project':
      return { type: 'project', projectId: requireProject(repositories, scope.projectId).value.id };
    case 'application': {
      const application = requireApplication(repositories, scope.applicationId).value;
      return { type: 'application', projectId: application.projectId, applicationId: application.id };
    }
  }
}

function enclosingScopes(target: Target): readonly Scope[] {
  switch (target.type) {
    case 'global':
      return [GLOBAL];
    case 'project':
      return [{ type: 'project', projectId: target.projectId }, GLOBAL];
    case 'application':
      return [
        { type: 'application', applicationId: target.applicationId },
        { type: 'project', projectId: target.projectId },
        GLOBAL,
      ];
  }
}

function scopeId(target: Target): string | null {
  return target.type === 'global' ? null : target.type === 'project' ? target.projectId : target.applicationId;
}
