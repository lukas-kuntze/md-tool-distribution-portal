import { disableUser, enableUser, type User } from '../domain/entities/user.js';
import type { UserListFilter, UserSummary } from '../domain/ports/user-repository.js';
import type { Repositories } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { UserId } from '../domain/value-objects/identifier.js';
import { GLOBAL, type Scope } from '../domain/value-objects/scope.js';
import { auditChange, authorizedRead, authorizedTransaction } from './authorization.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';

type Dependencies = Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>;

/** A role a user holds right now, directly or through a team. */
export interface HeldRole {
  readonly roleKey: string;
  readonly scope: Scope;
  /** Name of the project or application; empty for the platform. */
  readonly scopeName: string;
  readonly viaTeam: boolean;
  readonly expiresAt: Date | null;
}

export interface UserOverviewEntry {
  readonly summary: UserSummary;
  readonly roles: readonly HeldRole[];
}

/**
 * Everybody known to the platform with their last sign-in and current roles, for the user administration.
 * Reserved to platform-wide `permissions.manage`, as it reveals who has access to what across all projects.
 */
export function listUsers(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  filter: UserListFilter,
): { readonly entries: readonly UserOverviewEntry[]; readonly total: number } {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, guard) => {
    guard.require('permissions.manage', GLOBAL, { type: 'user', id: null });

    const page = repositories.users.list(filter);
    const now = dependencies.clock.now();

    return {
      total: page.total,
      entries: page.entries.map((summary) => ({ summary, roles: rolesOf(repositories, summary.user.id, now) })),
    };
  });
}

/** Disables or re-enables an account. Disabling ends every session at once; roles and audit history remain. */
export function setUserStatus(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: { readonly userId: UserId; readonly status: User['status'] },
): UserSummary {
  const context = contextOf(dependencies, actor, request);

  return authorizedTransaction(context, (repositories, guard) => {
    guard.require('permissions.manage', GLOBAL, { type: 'user', id: input.userId });

    const user = repositories.users.findById(input.userId);

    if (user === null) {
      throw new DomainError('user_not_found', 'The user does not exist.');
    }

    if (input.status === 'disabled') {
      assertDisableAllowed(repositories, actor, user, context.now);
    }

    const changed = input.status === 'disabled' ? disableUser(user) : enableUser(user);
    repositories.users.update(changed);

    if (changed.status === 'disabled') {
      repositories.sessions.revokeAllOfUser(user.id, context.now);
    }

    repositories.auditLog.append(
      auditChange(
        context,
        changed.status === 'disabled' ? 'user.disabled' : 'user.enabled',
        GLOBAL,
        { type: 'user', id: user.id },
        { displayName: user.displayName },
      ),
    );

    const summary = repositories.users.findSummary(user.id);

    if (summary === null) {
      throw new DomainError('user_not_found', 'The user does not exist.');
    }

    return summary;
  });
}

/** Nobody locks themselves out, and the platform always keeps an active administrator. */
function assertDisableAllowed(repositories: Repositories, actor: Actor, user: User, now: Date): void {
  if (user.id === actor.userId) {
    throw new DomainError('cannot_disable_self', 'You cannot disable your own account.');
  }

  const admins = repositories.access.activeGlobalPlatformAdminUserIds(now);

  if (admins.includes(user.id) && admins.length <= 1) {
    throw new DomainError('last_platform_admin', 'The last active platform administrator cannot be disabled.');
  }
}

/** Roles the user holds right now, with the name of their project or application. */
export function rolesOf(repositories: Repositories, userId: UserId, now: Date): readonly HeldRole[] {
  return repositories.access
    .grantsForUser(userId)
    .filter((grant) => grant.expiresAt === null || grant.expiresAt.getTime() > now.getTime())
    .map((grant) => ({
      roleKey: grant.roleKey,
      scope: grant.scope,
      scopeName: scopeName(repositories, grant.scope),
      viaTeam: grant.principal.type === 'team',
      expiresAt: grant.expiresAt,
    }));
}

function scopeName(repositories: Repositories, scope: Scope): string {
  switch (scope.type) {
    case 'global':
      return '';
    case 'project':
      return repositories.projects.findById(scope.projectId)?.value.name ?? '';
    case 'application':
      return repositories.applications.findById(scope.applicationId)?.value.name ?? '';
  }
}
