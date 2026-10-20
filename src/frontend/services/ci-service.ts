import type { CiBindingDto, CiSettingsDto } from '../../shared/types/api.js';
import { api } from './api-client.js';

export const ci = {
  settings: (applicationId: string): Promise<CiSettingsDto> => api.get(`/api/applications/${applicationId}/ci`),
  bind: (
    applicationId: string,
    input: {
      readonly repositoryId: number;
      readonly repositoryName: string;
      readonly refPattern: string;
      readonly environment: string | null;
    },
  ): Promise<CiBindingDto> => api.post(`/api/applications/${applicationId}/ci-bindings`, input),
  revoke: (id: string): Promise<undefined> => api.post(`/api/ci-bindings/${id}/revoke`),
};
