import { describe, expect, it } from 'vitest';

import type { Role } from '../../domain/entities/role-assignment.js';
import type { NewRoleAssignment } from '../../domain/ports/access-repository.js';
import { EffectivePermissions } from '../../domain/value-objects/effective-permissions.js';
import type { Scope, Target } from '../../domain/value-objects/scope.js';
import {
  buildApplication,
  buildDefaultFlavor,
  createTestDatabase,
  nextId,
  NOW,
  seedApplication,
  type TestDatabase,
} from './testing/sqlite-fixtures.js';

const errorCode = (code: string): unknown => expect.objectContaining({ code });

function role(test: TestDatabase, key: string): Role {
  const found = test.unitOfWork.read(({ access }) => access.findRoleByKey(key));

  if (found === null) {
    throw new Error(`Seeded role ${key} is missing.`);
  }

  return found;
}

function assignment(
  test: TestDatabase,
  roleKey: string,
  scope: Scope,
  overrides: Partial<NewRoleAssignment> = {},
): NewRoleAssignment {
  return {
    id: nextId(),
    roleId: role(test, roleKey).id,
    principal: { type: 'user', userId: test.userId },
    scope,
    reason: 'Release-Verantwortung',
    expiresAt: null,
    source: 'manual',
    ...overrides,
  };
}

describe('SqliteAccessRepository', (): void => {
  it('lists the seeded system roles with their permissions', (): void => {
    const test = createTestDatabase();
    const roles = test.unitOfWork.read(({ access }) => access.listRoles());

    expect(roles.map((candidate) => candidate.key)).toEqual(
      expect.arrayContaining(['platform-admin', 'project-admin', 'release-manager', 'developer', 'tester', 'viewer']),
    );
    expect(role(test, 'release-manager').permissions.has('releases.delete')).toBe(true);
    expect(test.unitOfWork.read(({ access }) => access.findRoleByKey('unknown'))).toBeNull();
  });

  it('grants a release manager deletion for K Mobile only', (): void => {
    const test = createTestDatabase();
    const kMobile = seedApplication(test);
    const dokuAirPad = buildApplication(kMobile.project);
    test.unitOfWork.transaction(({ applications }) =>
      applications.insert(dokuAirPad, buildDefaultFlavor(dokuAirPad), test.context),
    );
    test.unitOfWork.transaction(({ access }) =>
      access.insertAssignment(
        assignment(test, 'release-manager', { type: 'application', applicationId: kMobile.application.id }),
        test.context,
      ),
    );

    const grants = test.unitOfWork.read(({ access }) => access.grantsForUser(test.userId));
    const permissions = new EffectivePermissions({ userId: test.userId, teamIds: new Set() }, grants, NOW);
    const target = (applicationId: typeof dokuAirPad.id): Target => ({
      type: 'application',
      projectId: kMobile.project.id,
      applicationId,
    });

    expect(permissions.allows('releases.delete', target(kMobile.application.id))).toBe(true);
    expect(permissions.allows('releases.delete', target(dokuAirPad.id))).toBe(false);
  });

  it('rejects a duplicate active assignment but allows it again after revocation', (): void => {
    const test = createTestDatabase();
    const first = assignment(test, 'tester', { type: 'global' });
    test.unitOfWork.transaction(({ access }) => access.insertAssignment(first, test.context));

    const assignAgain = (): void =>
      test.unitOfWork.transaction(({ access }) =>
        access.insertAssignment(assignment(test, 'tester', { type: 'global' }), test.context),
      );

    expect(assignAgain).toThrow(errorCode('role_already_assigned'));
    expect(test.unitOfWork.transaction(({ access }) => access.revokeAssignment(first.id, test.context))).toBe(true);
    expect(test.unitOfWork.transaction(({ access }) => access.revokeAssignment(first.id, test.context))).toBe(false);
    expect(test.unitOfWork.read(({ access }) => access.findGrant(first.id))?.revokedAt).toEqual(NOW);
    expect(test.unitOfWork.read(({ access }) => access.grantsForUser(test.userId))).toEqual([]);
    expect(assignAgain).not.toThrow();
  });

  it('includes grants of active teams the user belongs to', (): void => {
    const test = createTestDatabase();
    const { project } = seedApplication(test);
    const teamId = nextId<'Team'>();
    const archivedTeamId = nextId<'Team'>();

    test.database
      .prepare("INSERT INTO teams (id, name, created_at) VALUES (?, 'Pflege-Team', ?)")
      .run(teamId, NOW.toISOString());
    test.database
      .prepare("INSERT INTO teams (id, name, archived_at, created_at) VALUES (?, 'Alt', ?, ?)")
      .run(archivedTeamId, NOW.toISOString(), NOW.toISOString());
    for (const id of [teamId, archivedTeamId]) {
      test.database
        .prepare('INSERT INTO team_members (team_id, user_id, added_at) VALUES (?, ?, ?)')
        .run(id, test.userId, NOW.toISOString());
    }

    test.unitOfWork.transaction(({ access }) => {
      access.insertAssignment(
        assignment(test, 'tester', { type: 'project', projectId: project.id }, { principal: { type: 'team', teamId } }),
        test.context,
      );
      access.insertAssignment(
        assignment(
          test,
          'release-manager',
          { type: 'global' },
          { principal: { type: 'team', teamId: archivedTeamId } },
        ),
        test.context,
      );
    });

    const grants = test.unitOfWork.read(({ access }) => access.grantsForUser(test.userId));

    expect(test.unitOfWork.read(({ access }) => access.teamIdsOf(test.userId))).toEqual(new Set([teamId]));
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      roleKey: 'tester',
      principal: { type: 'team', teamId },
      scope: { projectId: project.id },
    });
  });

  it('counts active global platform administrators', (): void => {
    const test = createTestDatabase();
    const count = (at = NOW): number =>
      test.unitOfWork.read(({ access }) => access.countActiveGlobalPlatformAdmins(at));

    expect(count()).toBe(0);
    test.unitOfWork.transaction(({ access }) => {
      access.insertAssignment(
        assignment(test, 'platform-admin', { type: 'global' }, { source: 'configuration' }),
        test.context,
      );
      access.insertAssignment(
        assignment(test, 'project-admin', { type: 'global' }, { expiresAt: new Date(NOW.getTime() + 60_000) }),
        test.context,
      );
    });

    expect(count()).toBe(1);
    expect(count(new Date(NOW.getTime() + 120_000))).toBe(1);
  });
});
