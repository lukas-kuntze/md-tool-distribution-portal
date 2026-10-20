import type { Role } from '../entities/role-assignment.js';
import type { Grant, Principal } from '../value-objects/effective-permissions.js';
import type { RoleAssignmentId, RoleId, TeamId, UserId } from '../value-objects/identifier.js';
import type { Scope } from '../value-objects/scope.js';
import type { ChangeContext } from './stored.js';

export interface NewRoleAssignment {
  readonly id: RoleAssignmentId;
  readonly roleId: RoleId;
  readonly principal: Principal;
  readonly scope: Scope;
  readonly reason: string;
  readonly expiresAt: Date | null;
  /** `configuration` marks the bootstrap administrators that are ensured from the server configuration. */
  readonly source: 'manual' | 'configuration';
}

/** A role assignment as shown in the administration, including who granted it and why. */
export interface AssignmentRecord {
  readonly grant: Grant;
  readonly roleId: RoleId;
  readonly source: NewRoleAssignment['source'];
  readonly reason: string;
  readonly grantedAt: Date;
  readonly grantedBy: UserId | null;
}

export interface AssignmentQuery {
  /** Assignments made exactly at this scope; inherited ones are resolved by the caller. */
  readonly scope?: Scope;
  readonly userId?: UserId;
  readonly includeRevoked: boolean;
}

export interface AccessRepository {
  listAssignments(query: AssignmentQuery): readonly AssignmentRecord[];
  listRoles(): readonly Role[];
  findRoleByKey(key: string): Role | null;

  /** Fails with `role_already_assigned` if the same role is already active for the principal at the scope. */
  insertAssignment(assignment: NewRoleAssignment, context: ChangeContext): void;
  /** Assignments are revoked, never deleted. Returns `false` if it was not active. */
  revokeAssignment(id: RoleAssignmentId, context: ChangeContext): boolean;
  findGrant(id: RoleAssignmentId): Grant | null;

  /** Every unrevoked grant of the user and of the teams the user belongs to. */
  grantsForUser(userId: UserId): readonly Grant[];
  teamIdsOf(userId: UserId): ReadonlySet<TeamId>;
  countActiveGlobalPlatformAdmins(now: Date): number;
  /** Active users holding the platform administrator role directly at global scope. */
  activeGlobalPlatformAdminUserIds(now: Date): readonly UserId[];
}
