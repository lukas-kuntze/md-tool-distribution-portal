import type {
  AssignmentDto,
  PermissionExplanationDto,
  RoleDto,
  RoleGrantedDto,
  ScopeDto,
  UserOverviewDto,
  UserSummaryDto,
} from '../../shared/types/api.js';
import { api, apiPage, type Page } from './api-client.js';

/** Scope as query parameters, e.g. `?scope=application&id=…`. */
export function scopeQuery(scope: ScopeDto): { readonly scope: string; readonly id?: string } {
  switch (scope.type) {
    case 'global':
      return { scope: 'global' };
    case 'project':
      return { scope: 'project', id: scope.projectId };
    case 'application':
      return { scope: 'application', id: scope.applicationId };
  }
}

export const access = {
  roles: (): Promise<RoleDto[]> => api.get('/api/roles'),
  assignments: (scope: ScopeDto, includeRevoked: boolean): Promise<AssignmentDto[]> =>
    api.get('/api/role-assignments', { ...scopeQuery(scope), includeRevoked }),
  grant: (input: {
    readonly roleId: string;
    readonly userId: string;
    readonly scope: ScopeDto;
    readonly reason: string;
    readonly expiresAt: string | null;
  }): Promise<RoleGrantedDto> => api.post('/api/role-assignments', input),
  revoke: (assignmentId: string): Promise<undefined> => api.post(`/api/role-assignments/${assignmentId}/revoke`),
  searchUsers: (query: string): Promise<UserSummaryDto[]> => api.get('/api/users', { query, limit: 20 }),
  explain: (userId: string, scope: ScopeDto): Promise<PermissionExplanationDto[]> =>
    api.get(`/api/users/${userId}/permissions`, scopeQuery(scope)),
  directory: (filter: {
    readonly query: string;
    readonly status: 'active' | 'disabled' | null;
    readonly limit: number;
    readonly offset: number;
  }): Promise<Page<UserOverviewDto>> => apiPage('/api/user-directory', filter),
  setStatus: (userId: string, status: 'active' | 'disabled'): Promise<UserSummaryDto> =>
    api.post(`/api/users/${userId}/status`, { status }),
};
