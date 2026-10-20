import { describe, expect, it } from 'vitest';

import { EffectivePermissions, type Grant, type Principal, type Subject } from './effective-permissions.js';
import { parseId } from './identifier.js';
import type { Permission } from './permission.js';
import { GLOBAL, type Scope, type Target } from './scope.js';

const now = new Date('2026-10-17T10:00:00Z');
const userId = parseId<'User'>('0192f3a4-0000-7000-8000-000000000001');
const otherUserId = parseId<'User'>('0192f3a4-0000-7000-8000-000000000002');
const teamId = parseId<'Team'>('0192f3a4-0000-7000-8000-000000000003');
const mdAmbulant = parseId<'Project'>('0192f3a4-0000-7000-8000-000000000010');
const otherProject = parseId<'Project'>('0192f3a4-0000-7000-8000-000000000011');
const kMobile = parseId<'Application'>('0192f3a4-0000-7000-8000-000000000020');
const dokuAirPad = parseId<'Application'>('0192f3a4-0000-7000-8000-000000000021');

const kMobileTarget: Target = { type: 'application', projectId: mdAmbulant, applicationId: kMobile };
const dokuAirPadTarget: Target = { type: 'application', projectId: mdAmbulant, applicationId: dokuAirPad };
const subject: Subject = { userId, teamIds: new Set([teamId]) };

let sequence = 0;

function grant(scope: Scope, permissions: readonly Permission[], overrides: Partial<Grant> = {}): Grant {
  sequence += 1;
  const principal: Principal = { type: 'user', userId };

  return {
    assignmentId: parseId(`0192f3a4-0000-7000-8000-${String(sequence).padStart(12, '0')}`),
    roleKey: 'release-manager',
    principal,
    scope,
    permissions: new Set(permissions),
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('EffectivePermissions', (): void => {
  it('lets a release manager of K Mobile delete its releases but not those of Doku AirPad', (): void => {
    const permissions = new EffectivePermissions(
      subject,
      [grant({ type: 'application', applicationId: kMobile }, ['releases.delete'])],
      now,
    );

    expect(permissions.allows('releases.delete', kMobileTarget)).toBe(true);
    expect(permissions.allows('releases.delete', dokuAirPadTarget)).toBe(false);
  });

  it('inherits project grants to every application of the project', (): void => {
    const permissions = new EffectivePermissions(
      subject,
      [grant({ type: 'project', projectId: mdAmbulant }, ['releases.read'])],
      now,
    );

    expect(permissions.allows('releases.read', kMobileTarget)).toBe(true);
    expect(permissions.allows('releases.read', { type: 'project', projectId: mdAmbulant })).toBe(true);
    expect(permissions.allows('releases.read', { type: 'project', projectId: otherProject })).toBe(false);
    expect(permissions.allows('releases.read', GLOBAL)).toBe(false);
  });

  it('inherits global grants everywhere', (): void => {
    const permissions = new EffectivePermissions(subject, [grant(GLOBAL, ['releases.purge'])], now);

    expect(permissions.allows('releases.purge', kMobileTarget)).toBe(true);
  });

  it('ignores grants at scopes where the permission takes no effect', (): void => {
    const permissions = new EffectivePermissions(
      subject,
      [grant({ type: 'project', projectId: mdAmbulant }, ['projects.create', 'releases.purge'])],
      now,
    );

    expect(permissions.allows('projects.create', { type: 'project', projectId: mdAmbulant })).toBe(false);
    expect(permissions.allows('releases.purge', kMobileTarget)).toBe(false);
  });

  it('applies grants made to a team of the subject', (): void => {
    const permissions = new EffectivePermissions(
      subject,
      [grant(GLOBAL, ['releases.read'], { principal: { type: 'team', teamId } })],
      now,
    );

    expect(permissions.allows('releases.read', kMobileTarget)).toBe(true);
  });

  it('ignores grants of other users, revoked grants and expired grants', (): void => {
    const permissions = new EffectivePermissions(
      subject,
      [
        grant(GLOBAL, ['releases.delete'], { principal: { type: 'user', userId: otherUserId } }),
        grant(GLOBAL, ['releases.delete'], { revokedAt: new Date('2026-10-01T00:00:00Z') }),
        grant(GLOBAL, ['releases.delete'], { expiresAt: now }),
      ],
      now,
    );

    expect(permissions.allows('releases.delete', kMobileTarget)).toBe(false);
  });

  it('honours grants that expire in the future', (): void => {
    const permissions = new EffectivePermissions(
      subject,
      [grant(GLOBAL, ['releases.delete'], { expiresAt: new Date('2026-12-31T00:00:00Z') })],
      now,
    );

    expect(permissions.allows('releases.delete', kMobileTarget)).toBe(true);
  });

  it('explains which grants a permission derives from', (): void => {
    const projectGrant = grant({ type: 'project', projectId: mdAmbulant }, ['releases.delete']);
    const unrelated = grant({ type: 'application', applicationId: dokuAirPad }, ['releases.delete']);
    const permissions = new EffectivePermissions(subject, [projectGrant, unrelated], now);

    expect(permissions.grantsFor('releases.delete', kMobileTarget)).toEqual([projectGrant]);
  });
});
