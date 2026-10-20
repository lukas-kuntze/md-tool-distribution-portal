import type { Database } from 'better-sqlite3';

import { PLATFORM_ADMIN_ROLE_KEY, type Role } from '../../domain/entities/role-assignment.js';
import type {
  AccessRepository,
  AssignmentQuery,
  AssignmentRecord,
  NewRoleAssignment,
} from '../../domain/ports/access-repository.js';
import type { ChangeContext } from '../../domain/ports/stored.js';
import type { Grant, Principal } from '../../domain/value-objects/effective-permissions.js';
import type {
  ApplicationId,
  ProjectId,
  RoleAssignmentId,
  RoleId,
  TeamId,
  UserId,
} from '../../domain/value-objects/identifier.js';
import { isPermission, type Permission, type ScopeType } from '../../domain/value-objects/permission.js';
import type { Scope } from '../../domain/value-objects/scope.js';
import { fromDbTime, toDbTime, translateConstraints } from './sqlite-values.js';

interface RoleRow {
  readonly id: string;
  readonly key: string;
  readonly permissions: string;
}

interface GrantRow {
  readonly id: string;
  readonly role_key: string;
  readonly permissions: string;
  readonly user_id: string | null;
  readonly team_id: string | null;
  readonly scope_type: ScopeType;
  readonly project_id: string | null;
  readonly application_id: string | null;
  readonly expires_at: string | null;
  readonly revoked_at: string | null;
  readonly role_id: string;
  readonly source: NewRoleAssignment['source'];
  readonly reason: string;
  readonly granted_at: string;
  readonly granted_by: string | null;
}

const ROLE_SELECT = `
  SELECT r.id, r.key,
         (SELECT json_group_array(permission_key) FROM role_permissions WHERE role_id = r.id) AS permissions
  FROM roles r`;

const GRANT_SELECT = `
  SELECT a.id, r.key AS role_key, a.user_id, a.team_id, a.scope_type, a.project_id, a.application_id,
         a.expires_at, a.revoked_at, a.role_id, a.source, a.reason, a.granted_at, a.granted_by,
         (SELECT json_group_array(permission_key) FROM role_permissions WHERE role_id = a.role_id) AS permissions
  FROM role_assignments a
  JOIN roles r ON r.id = a.role_id`;

const ALREADY_ASSIGNED = {
  constraint: "index 'role_assignments_active'",
  code: 'role_already_assigned',
  message: 'This role is already assigned to the principal at this scope.',
} as const;

export class SqliteAccessRepository implements AccessRepository {
  public constructor(private readonly database: Database) {}

  public listAssignments(query: AssignmentQuery): readonly AssignmentRecord[] {
    const scope = query.scope;

    return this.database
      .prepare<Record<string, unknown>, GrantRow>(
        `${GRANT_SELECT}
         WHERE (@includeRevoked = 1 OR a.revoked_at IS NULL)
           AND (@userId IS NULL OR a.user_id = @userId)
           AND (@scopeType IS NULL OR a.scope_type = @scopeType)
           AND (@projectId IS NULL OR a.project_id = @projectId)
           AND (@applicationId IS NULL OR a.application_id = @applicationId)
         ORDER BY a.granted_at DESC`,
      )
      .all({
        includeRevoked: query.includeRevoked ? 1 : 0,
        userId: query.userId ?? null,
        scopeType: scope?.type ?? null,
        projectId: scope?.type === 'project' ? scope.projectId : null,
        applicationId: scope?.type === 'application' ? scope.applicationId : null,
      })
      .map((row) => ({
        grant: toGrant(row),
        roleId: row.role_id as RoleId,
        source: row.source,
        reason: row.reason,
        grantedAt: fromDbTime(row.granted_at),
        grantedBy: row.granted_by as UserId | null,
      }));
  }

  public listRoles(): readonly Role[] {
    return this.database.prepare<[], RoleRow>(`${ROLE_SELECT} ORDER BY r.is_system DESC, r.name`).all().map(toRole);
  }

  public findRoleByKey(key: string): Role | null {
    const row = this.database.prepare<[string], RoleRow>(`${ROLE_SELECT} WHERE r.key = ?`).get(key);
    return row === undefined ? null : toRole(row);
  }

  public insertAssignment(assignment: NewRoleAssignment, context: ChangeContext): void {
    const { principal, scope } = assignment;

    translateConstraints(
      () =>
        this.database
          .prepare(
            `INSERT INTO role_assignments (
               id, role_id, user_id, team_id, scope_type, project_id, application_id, source, reason,
               granted_at, granted_by, expires_at)
             VALUES (
               @id, @roleId, @userId, @teamId, @scopeType, @projectId, @applicationId, @source, @reason,
               @at, @actor, @expiresAt)`,
          )
          .run({
            id: assignment.id,
            roleId: assignment.roleId,
            userId: principal.type === 'user' ? principal.userId : null,
            teamId: principal.type === 'team' ? principal.teamId : null,
            scopeType: scope.type,
            projectId: scope.type === 'project' ? scope.projectId : null,
            applicationId: scope.type === 'application' ? scope.applicationId : null,
            source: assignment.source,
            reason: assignment.reason,
            at: toDbTime(context.at),
            actor: context.actor,
            expiresAt: toDbTime(assignment.expiresAt),
          }),
      [ALREADY_ASSIGNED],
    );
  }

  public revokeAssignment(id: RoleAssignmentId, context: ChangeContext): boolean {
    const result = this.database
      .prepare(
        'UPDATE role_assignments SET revoked_at = @at, revoked_by = @actor WHERE id = @id AND revoked_at IS NULL',
      )
      .run({ id, at: toDbTime(context.at), actor: context.actor });

    return result.changes > 0;
  }

  public findGrant(id: RoleAssignmentId): Grant | null {
    const row = this.database.prepare<[string], GrantRow>(`${GRANT_SELECT} WHERE a.id = ?`).get(id);
    return row === undefined ? null : toGrant(row);
  }

  public grantsForUser(userId: UserId): readonly Grant[] {
    return this.database
      .prepare<{ userId: string }, GrantRow>(
        `${GRANT_SELECT}
         WHERE a.revoked_at IS NULL
           AND (a.user_id = @userId OR a.team_id IN (${ACTIVE_TEAMS_OF_USER}))`,
      )
      .all({ userId })
      .map(toGrant);
  }

  public teamIdsOf(userId: UserId): ReadonlySet<TeamId> {
    const rows = this.database.prepare<{ userId: string }, { team_id: string }>(ACTIVE_TEAMS_OF_USER).all({ userId });
    return new Set(rows.map((row) => row.team_id as TeamId));
  }

  public countActiveGlobalPlatformAdmins(now: Date): number {
    const row = this.database
      .prepare<{ roleKey: string; now: string }, { count: number }>(
        `SELECT count(*) AS count
         FROM role_assignments a
         JOIN roles r ON r.id = a.role_id
         WHERE r.key = @roleKey AND a.scope_type = 'global' AND a.revoked_at IS NULL
           AND (a.expires_at IS NULL OR a.expires_at > @now)`,
      )
      .get({ roleKey: PLATFORM_ADMIN_ROLE_KEY, now: toDbTime(now) });

    return row?.count ?? 0;
  }

  public activeGlobalPlatformAdminUserIds(now: Date): readonly UserId[] {
    return this.database
      .prepare<{ roleKey: string; now: string }, { user_id: string }>(
        `SELECT DISTINCT a.user_id
         FROM role_assignments a
         JOIN roles r ON r.id = a.role_id
         JOIN users u ON u.id = a.user_id
         WHERE r.key = @roleKey AND a.scope_type = 'global' AND a.revoked_at IS NULL
           AND (a.expires_at IS NULL OR a.expires_at > @now) AND u.status = 'active'`,
      )
      .all({ roleKey: PLATFORM_ADMIN_ROLE_KEY, now: toDbTime(now) })
      .map((row) => row.user_id as UserId);
  }
}

const ACTIVE_TEAMS_OF_USER = `
  SELECT m.team_id FROM team_members m JOIN teams t ON t.id = m.team_id
  WHERE m.user_id = @userId AND t.archived_at IS NULL`;

function toRole(row: RoleRow): Role {
  return { id: row.id as RoleId, key: row.key, permissions: parsePermissions(row.permissions) };
}

function toGrant(row: GrantRow): Grant {
  const principal: Principal =
    row.user_id !== null
      ? { type: 'user', userId: row.user_id as UserId }
      : { type: 'team', teamId: row.team_id as TeamId };

  return {
    assignmentId: row.id as RoleAssignmentId,
    roleKey: row.role_key,
    principal,
    scope: toScope(row),
    permissions: parsePermissions(row.permissions),
    expiresAt: fromDbTime(row.expires_at),
    revokedAt: fromDbTime(row.revoked_at),
  };
}

function toScope(row: GrantRow): Scope {
  switch (row.scope_type) {
    case 'global':
      return { type: 'global' };
    case 'project':
      return { type: 'project', projectId: row.project_id as ProjectId };
    case 'application':
      return { type: 'application', applicationId: row.application_id as ApplicationId };
  }
}

/** Unknown keys (e.g. from a newer schema) are ignored rather than granted. */
function parsePermissions(json: string): ReadonlySet<Permission> {
  return new Set((JSON.parse(json) as readonly string[]).filter(isPermission));
}
