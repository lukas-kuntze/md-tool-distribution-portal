import { describe, expect, it } from 'vitest';

import { EffectivePermissions, type Grant } from '../value-objects/effective-permissions.js';
import { parseId, type RoleId } from '../value-objects/identifier.js';
import type { Permission } from '../value-objects/permission.js';
import { GLOBAL, type Scope, type Target } from '../value-objects/scope.js';
import { assertGrantAllowed, assertRevokeAllowed, PLATFORM_ADMIN_ROLE_KEY, type Role } from './role-assignment.js';

const now = new Date('2026-10-17T10:00:00Z');
const userId = parseId<'User'>('0192f3a4-0000-7000-8000-000000000001');
const mdAmbulant = parseId<'Project'>('0192f3a4-0000-7000-8000-000000000010');
const kMobile = parseId<'Application'>('0192f3a4-0000-7000-8000-000000000020');
const kMobileTarget: Target = { type: 'application', projectId: mdAmbulant, applicationId: kMobile };
const projectTarget: Target = { type: 'project', projectId: mdAmbulant };

const tester: Role = { id: roleId(1), key: 'tester', permissions: new Set(['releases.read', 'artifacts.download']) };
const releaseDeleter: Role = {
  id: roleId(2),
  key: 'release-deleter',
  permissions: new Set(['releases.read', 'releases.delete']),
};
const projectCreator: Role = { id: roleId(3), key: 'project-creator', permissions: new Set(['projects.create']) };

function roleId(n: number): RoleId {
  return parseId(`0192f3a4-0000-7000-8000-${String(n).padStart(12, '0')}`);
}

const errorCode = (code: string): unknown => expect.objectContaining({ code });

function grant(scope: Scope, permissions: readonly Permission[], roleKey = 'custom'): Grant {
  return {
    assignmentId: parseId('0192f3a4-0000-7000-8000-000000000300'),
    roleKey,
    principal: { type: 'user', userId },
    scope,
    permissions: new Set(permissions),
    expiresAt: null,
    revokedAt: null,
  };
}

function granter(...grants: readonly Grant[]): EffectivePermissions {
  return new EffectivePermissions({ userId, teamIds: new Set() }, grants, now);
}

describe('assertGrantAllowed', (): void => {
  it('lets a project administrator grant the delete permission for one application', (): void => {
    const projectAdmin = granter(
      grant({ type: 'project', projectId: mdAmbulant }, ['permissions.manage', 'releases.read', 'releases.delete']),
    );

    expect((): void => assertGrantAllowed(projectAdmin, releaseDeleter, kMobileTarget)).not.toThrow();
  });

  it('requires permission management at the target', (): void => {
    const releaseManager = granter(grant(GLOBAL, ['releases.read', 'artifacts.download']));

    expect((): void => assertGrantAllowed(releaseManager, tester, kMobileTarget)).toThrow(
      errorCode('permission_denied'),
    );
  });

  it('prevents granting permissions the granter does not hold', (): void => {
    const delegate = granter(
      grant({ type: 'project', projectId: mdAmbulant }, ['permissions.manage', 'releases.read']),
    );

    expect((): void => assertGrantAllowed(delegate, releaseDeleter, kMobileTarget)).toThrow(
      errorCode('privilege_escalation'),
    );
  });

  it('lets an application-level delegate grant non-privileged roles only', (): void => {
    const appDelegate = granter(
      grant({ type: 'application', applicationId: kMobile }, [
        'permissions.manage',
        'releases.read',
        'releases.delete',
        'artifacts.download',
      ]),
    );

    expect((): void => assertGrantAllowed(appDelegate, tester, kMobileTarget)).not.toThrow();
    expect((): void => assertGrantAllowed(appDelegate, releaseDeleter, kMobileTarget)).toThrow(
      errorCode('privilege_escalation'),
    );
  });

  it('rejects roles that take no effect at the target scope', (): void => {
    const platformAdmin = granter(grant(GLOBAL, ['permissions.manage', 'projects.create']));

    expect((): void => assertGrantAllowed(platformAdmin, projectCreator, projectTarget)).toThrow(
      errorCode('role_not_applicable'),
    );
    expect((): void => assertGrantAllowed(platformAdmin, projectCreator, GLOBAL)).not.toThrow();
  });
});

describe('assertRevokeAllowed', (): void => {
  const adminGrant = grant(GLOBAL, ['permissions.manage'], PLATFORM_ADMIN_ROLE_KEY);

  it('keeps the last global platform administrator', (): void => {
    expect((): void => assertRevokeAllowed(adminGrant, 1)).toThrow(errorCode('last_platform_admin'));
    expect((): void => assertRevokeAllowed(adminGrant, 2)).not.toThrow();
  });

  it('does not restrict other grants', (): void => {
    expect((): void => assertRevokeAllowed(grant(GLOBAL, ['releases.read']), 1)).not.toThrow();
    expect((): void =>
      assertRevokeAllowed(grant(projectTarget, ['permissions.manage'], PLATFORM_ADMIN_ROLE_KEY), 1),
    ).not.toThrow();
  });
});
