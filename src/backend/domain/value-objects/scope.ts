import type { ApplicationId, ProjectId } from './identifier.js';

/** Where a role assignment takes effect. An application scope does not store its project, because applications can move. */
export type Scope =
  | { readonly type: 'global' }
  | { readonly type: 'project'; readonly projectId: ProjectId }
  | { readonly type: 'application'; readonly applicationId: ApplicationId };

/** A concrete place in the hierarchy, resolved together with its ancestors at the time of the check. */
export type Target =
  | { readonly type: 'global' }
  | { readonly type: 'project'; readonly projectId: ProjectId }
  | { readonly type: 'application'; readonly projectId: ProjectId; readonly applicationId: ApplicationId };

export const GLOBAL = { type: 'global' } as const;

/** Permissions are inherited downwards: global → project → application (and everything below it). */
export function covers(scope: Scope, target: Target): boolean {
  switch (scope.type) {
    case 'global':
      return true;
    case 'project':
      return target.type !== 'global' && target.projectId === scope.projectId;
    case 'application':
      return target.type === 'application' && target.applicationId === scope.applicationId;
  }
}

export function scopeOf(target: Target): Scope {
  switch (target.type) {
    case 'global':
      return GLOBAL;
    case 'project':
      return { type: 'project', projectId: target.projectId };
    case 'application':
      return { type: 'application', applicationId: target.applicationId };
  }
}
