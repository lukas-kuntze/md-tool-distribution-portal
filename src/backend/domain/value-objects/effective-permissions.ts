import type { RoleAssignmentId, TeamId, UserId } from './identifier.js';
import { isPermissionAllowedAt, type Permission } from './permission.js';
import { covers, type Scope, type Target } from './scope.js';

export type Principal =
  { readonly type: 'user'; readonly userId: UserId } | { readonly type: 'team'; readonly teamId: TeamId };

/** A role assignment with the permissions of its role resolved. */
export interface Grant {
  readonly assignmentId: RoleAssignmentId;
  readonly roleKey: string;
  readonly principal: Principal;
  readonly scope: Scope;
  readonly permissions: ReadonlySet<Permission>;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

/** The authenticated user as identified by the platform, never by a GitHub login. */
export interface Subject {
  readonly userId: UserId;
  readonly teamIds: ReadonlySet<TeamId>;
}

/**
 * What a subject may do at a point in time. Grants only add permissions; there are no deny rules,
 * so the effective permissions at a target are the union of every active grant covering it.
 */
export class EffectivePermissions {
  private readonly grants: readonly Grant[];

  public constructor(subject: Subject, grants: readonly Grant[], now: Date) {
    this.grants = grants.filter((grant) => isActive(grant, now) && belongsTo(grant.principal, subject));
  }

  public allows(permission: Permission, target: Target): boolean {
    return this.grantsFor(permission, target).length > 0;
  }

  /** The grants a permission at a target derives from, e.g. to explain why a user may do something. */
  public grantsFor(permission: Permission, target: Target): readonly Grant[] {
    return this.grants.filter(
      (grant) =>
        grant.permissions.has(permission) &&
        isPermissionAllowedAt(permission, grant.scope.type) &&
        covers(grant.scope, target),
    );
  }
}

function isActive(grant: Grant, now: Date): boolean {
  return grant.revokedAt === null && (grant.expiresAt === null || grant.expiresAt.getTime() > now.getTime());
}

function belongsTo(principal: Principal, subject: Subject): boolean {
  return principal.type === 'user' ? principal.userId === subject.userId : subject.teamIds.has(principal.teamId);
}
