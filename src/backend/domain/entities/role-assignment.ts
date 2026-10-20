import { DomainError } from '../value-objects/domain-error.js';
import type { RoleId } from '../value-objects/identifier.js';
import type { EffectivePermissions, Grant } from '../value-objects/effective-permissions.js';
import { isPermissionAllowedAt, isPrivileged, type Permission } from '../value-objects/permission.js';
import type { Target } from '../value-objects/scope.js';

export const PLATFORM_ADMIN_ROLE_KEY = 'platform-admin';

export interface Role {
  readonly id: RoleId;
  readonly key: string;
  readonly permissions: ReadonlySet<Permission>;
}

/**
 * Guards against privilege escalation: a user can only hand out what they hold themselves at the target,
 * and privileged roles only from the global or project level, never from an application-level delegation.
 */
export function assertGrantAllowed(granter: EffectivePermissions, role: Role, target: Target): void {
  const applicable = [...role.permissions].filter((permission) => isPermissionAllowedAt(permission, target.type));

  if (applicable.length === 0) {
    throw new DomainError('role_not_applicable', 'None of the permissions of this role take effect at this scope.');
  }

  if (!granter.allows('permissions.manage', target)) {
    throw new DomainError('permission_denied', 'Managing permissions at this scope is not allowed.');
  }

  if (applicable.some((permission) => !granter.allows(permission, target))) {
    throw new DomainError(
      'privilege_escalation',
      'A role can only be granted by someone who holds all of its permissions.',
    );
  }

  const managesAboveApplication = granter
    .grantsFor('permissions.manage', target)
    .some((grant) => grant.scope.type !== 'application');

  if (isPrivileged(role.permissions) && !managesAboveApplication) {
    throw new DomainError(
      'privilege_escalation',
      'Privileged roles can only be granted with permission management at global or project level.',
    );
  }
}

/** The last global platform administrator cannot be removed, so the platform never ends up without one. */
export function assertRevokeAllowed(grant: Grant, activeGlobalPlatformAdmins: number): void {
  const isGlobalPlatformAdmin = grant.roleKey === PLATFORM_ADMIN_ROLE_KEY && grant.scope.type === 'global';

  if (isGlobalPlatformAdmin && activeGlobalPlatformAdmins <= 1) {
    throw new DomainError('last_platform_admin', 'The last platform administrator cannot be removed.');
  }
}
