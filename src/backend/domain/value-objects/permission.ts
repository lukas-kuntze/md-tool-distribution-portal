import { DomainError } from './domain-error.js';

export const SCOPE_TYPES = ['global', 'project', 'application'] as const;

export type ScopeType = (typeof SCOPE_TYPES)[number];

const ANY_SCOPE = SCOPE_TYPES;

/** The permission catalog and the scope types at which each permission may take effect. */
const PERMISSION_SCOPES = {
  'projects.read': ['global', 'project'],
  'projects.create': ['global'],
  'projects.update': ['global', 'project'],
  'projects.delete': ['global'],
  'applications.manage': ANY_SCOPE,
  'flavors.manage': ANY_SCOPE,
  'releases.read': ANY_SCOPE,
  'releases.create': ANY_SCOPE,
  'releases.update': ANY_SCOPE,
  'releases.publish': ANY_SCOPE,
  'releases.delete': ANY_SCOPE,
  'releases.restore': ANY_SCOPE,
  'releases.purge': ['global'],
  'artifacts.upload': ANY_SCOPE,
  'artifacts.download': ANY_SCOPE,
  'artifacts.delete': ANY_SCOPE,
  'build_numbers.release': ['global', 'project'],
  'permissions.manage': ANY_SCOPE,
  'audit.read': ANY_SCOPE,
  'storage.manage': ['global'],
  'shares.manage': ANY_SCOPE,
  'settings.manage': ['global'],
} as const satisfies Record<string, readonly ScopeType[]>;

export type Permission = keyof typeof PERMISSION_SCOPES;

export const PERMISSIONS = Object.keys(PERMISSION_SCOPES) as readonly Permission[];

/** Permissions that only let a user look at and install what they were given access to. */
const NON_PRIVILEGED: ReadonlySet<Permission> = new Set(['projects.read', 'releases.read', 'artifacts.download']);

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSION_SCOPES, value);
}

export function parsePermission(value: string): Permission {
  if (!isPermission(value)) {
    throw new DomainError('unknown_permission', 'Permission is not part of the permission catalog.');
  }

  return value;
}

export function isPermissionAllowedAt(permission: Permission, scopeType: ScopeType): boolean {
  return (PERMISSION_SCOPES[permission] as readonly ScopeType[]).includes(scopeType);
}

/** A set of permissions is privileged as soon as it allows anything beyond reading and downloading. */
export function isPrivileged(permissions: Iterable<Permission>): boolean {
  return [...permissions].some((permission) => !NON_PRIVILEGED.has(permission));
}
