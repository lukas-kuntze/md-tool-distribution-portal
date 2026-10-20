import { describe, expect, it } from 'vitest';

import {
  isPermission,
  isPermissionAllowedAt,
  isPrivileged,
  parsePermission,
  PERMISSIONS,
  type Permission,
} from './permission.js';

describe('permission catalog', (): void => {
  it('contains the release deletion permission', (): void => {
    expect(PERMISSIONS).toContain('releases.delete');
  });

  it('recognises catalog entries only', (): void => {
    expect(isPermission('releases.delete')).toBe(true);
    expect(isPermission('toString')).toBe(false);
    expect(parsePermission('audit.read')).toBe('audit.read');
    expect((): Permission => parsePermission('releases.nuke')).toThrow(
      expect.objectContaining({ code: 'unknown_permission' }),
    );
  });

  it('restricts creating projects to the global scope', (): void => {
    expect(isPermissionAllowedAt('projects.create', 'global')).toBe(true);
    expect(isPermissionAllowedAt('projects.create', 'project')).toBe(false);
  });

  it('treats anything beyond reading and downloading as privileged', (): void => {
    expect(isPrivileged(['projects.read', 'releases.read', 'artifacts.download'])).toBe(false);
    expect(isPrivileged(['releases.read', 'releases.delete'])).toBe(true);
  });
});
