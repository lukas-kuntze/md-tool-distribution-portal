import type {
  DeletionAcceptedDto,
  InstallLinkDto,
  LifecycleStateDto,
  PublicationStatusDto,
  ReleaseDetailDto,
  ReleaseSummaryDto,
} from '../../shared/types/api.js';
import { api, apiPage, type Page } from './api-client.js';

export interface ReleaseFilter {
  readonly flavorId?: string;
  readonly status?: readonly PublicationStatusDto[];
  readonly lifecycle?: readonly LifecycleStateDto[];
  readonly search?: string;
  readonly limit: number;
  readonly offset: number;
}

const csv = (values: readonly string[] | undefined): string | undefined =>
  values === undefined || values.length === 0 ? undefined : values.join(',');

export const releases = {
  list: (applicationId: string, filter: ReleaseFilter): Promise<Page<ReleaseSummaryDto>> =>
    apiPage(`/api/applications/${applicationId}/releases`, {
      flavorId: filter.flavorId,
      status: csv(filter.status),
      lifecycle: csv(filter.lifecycle),
      search: filter.search,
      limit: filter.limit,
      offset: filter.offset,
    }),
  get: (id: string): Promise<ReleaseDetailDto> => api.get(`/api/releases/${id}`),
  updateTexts: (
    release: ReleaseDetailDto,
    texts: { readonly releaseNotes: string; readonly changelog: string },
  ): Promise<ReleaseDetailDto> =>
    api.patch(`/api/releases/${release.id}`, { ...texts, rowVersion: release.rowVersion }),
  publish: (release: ReleaseDetailDto): Promise<ReleaseDetailDto> =>
    api.post(`/api/releases/${release.id}/publish`, { rowVersion: release.rowVersion }),
  withdraw: (release: ReleaseDetailDto): Promise<ReleaseDetailDto> =>
    api.post(`/api/releases/${release.id}/withdraw`, { rowVersion: release.rowVersion }),
  delete: (release: ReleaseDetailDto, confirmation: string, reason: string): Promise<DeletionAcceptedDto> =>
    api.delete(`/api/releases/${release.id}`, { rowVersion: release.rowVersion, confirmation, reason }),
  restore: (release: ReleaseDetailDto): Promise<ReleaseDetailDto> => api.post(`/api/releases/${release.id}/restore`),
  releaseBuildNumber: (release: ReleaseDetailDto, reason: string): Promise<ReleaseDetailDto> =>
    api.post(`/api/releases/${release.id}/release-build-number`, { rowVersion: release.rowVersion, reason }),
  installLink: (artifactId: string): Promise<InstallLinkDto> => api.post(`/api/artifacts/${artifactId}/install-link`),
  removeArtifact: (artifactId: string, reason: string): Promise<DeletionAcceptedDto> =>
    api.post(`/api/artifacts/${artifactId}/remove`, { reason }),
  restoreArtifact: (artifactId: string): Promise<undefined> => api.post(`/api/artifacts/${artifactId}/restore`),
  downloadUrl: (artifactId: string): string => `/api/artifacts/${artifactId}/download`,
};
