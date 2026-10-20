import type { SharedContentDto, ShareLinkCreatedDto, ShareLinkDto, ShareScopeDto } from '../../shared/types/api.js';
import { api } from './api-client.js';

export const shares = {
  list: (scope: ShareScopeDto): Promise<ShareLinkDto[]> =>
    api.get('/api/share-links', {
      scope: scope.type,
      id: scope.type === 'project' ? scope.projectId : scope.applicationId,
    }),
  create: (input: {
    readonly scope: ShareScopeDto;
    readonly label: string;
    readonly releases: 'all' | 'latest';
    readonly expiresAt: string | null;
  }): Promise<ShareLinkCreatedDto> => api.post('/api/share-links', input),
  revoke: (id: string): Promise<undefined> => api.post(`/api/share-links/${id}/revoke`),
  /** Public: works without a session, the secret of the link is the only credential. */
  content: (token: string): Promise<SharedContentDto> => api.get(`/public/shares/${encodeURIComponent(token)}`),
};
