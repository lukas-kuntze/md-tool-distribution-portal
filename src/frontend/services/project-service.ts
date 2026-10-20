import type { ApplicationDto, FlavorDto, PlatformDto, ProjectDto } from '../../shared/types/api.js';
import { api } from './api-client.js';

export interface NewProject {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
}

export interface NewApplication {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly framework: ApplicationDto['framework'];
  readonly platforms: readonly PlatformDto[];
  readonly visibility: ApplicationDto['visibility'];
  readonly bundleIdentifiers: Partial<Record<PlatformDto, string>>;
}

export interface ApplicationChanges {
  readonly name?: string;
  readonly description?: string;
  readonly framework?: ApplicationDto['framework'];
  readonly platforms?: readonly PlatformDto[];
  readonly visibility?: ApplicationDto['visibility'];
  readonly flavorsEnabled?: boolean;
  readonly installNotes?: string;
}

export interface FlavorChanges {
  readonly key?: string;
  readonly name?: string;
  readonly status?: FlavorDto['status'];
  readonly bundleIdentifiers?: Partial<Record<PlatformDto, string | null>>;
}

export const projects = {
  list: (status?: ProjectDto['status']): Promise<ProjectDto[]> => api.get('/api/projects', { status }),
  get: (id: string): Promise<ProjectDto> => api.get(`/api/projects/${id}`),
  create: (project: NewProject): Promise<ProjectDto> => api.post('/api/projects', project),
  update: (
    project: ProjectDto,
    changes: { readonly name: string; readonly description: string },
  ): Promise<ProjectDto> => api.patch(`/api/projects/${project.id}`, { ...changes, rowVersion: project.rowVersion }),
  archive: (project: ProjectDto): Promise<ProjectDto> =>
    api.post(`/api/projects/${project.id}/archive`, { rowVersion: project.rowVersion }),
  restore: (project: ProjectDto): Promise<ProjectDto> =>
    api.post(`/api/projects/${project.id}/restore`, { rowVersion: project.rowVersion }),
  uploadIcon: (projectId: string, file: Blob): Promise<ProjectDto> => api.put(`/api/projects/${projectId}/icon`, file),
  removeIcon: (projectId: string): Promise<ProjectDto> => api.delete(`/api/projects/${projectId}/icon`, {}),
};

export const applications = {
  list: (projectId: string): Promise<ApplicationDto[]> => api.get(`/api/projects/${projectId}/applications`),
  get: (id: string): Promise<ApplicationDto> => api.get(`/api/applications/${id}`),
  create: (projectId: string, application: NewApplication): Promise<ApplicationDto> =>
    api.post(`/api/projects/${projectId}/applications`, application),
  update: (application: ApplicationDto, changes: ApplicationChanges): Promise<ApplicationDto> =>
    api.patch(`/api/applications/${application.id}`, { ...changes, rowVersion: application.rowVersion }),
  createFlavor: (
    applicationId: string,
    flavor: {
      readonly key: string;
      readonly name: string;
      readonly bundleIdentifiers: Partial<Record<PlatformDto, string>>;
    },
  ): Promise<FlavorDto> => api.post(`/api/applications/${applicationId}/flavors`, flavor),
  updateFlavor: (flavor: FlavorDto, changes: FlavorChanges): Promise<FlavorDto> =>
    api.patch(`/api/flavors/${flavor.id}`, { ...changes, rowVersion: flavor.rowVersion }),
  reorderFlavors: (applicationId: string, flavorIds: readonly string[]): Promise<ApplicationDto> =>
    api.put(`/api/applications/${applicationId}/flavor-order`, { flavorIds }),
  uploadIcon: (applicationId: string, file: Blob): Promise<ApplicationDto> =>
    api.put(`/api/applications/${applicationId}/icon`, file),
  removeIcon: (applicationId: string): Promise<ApplicationDto> =>
    api.delete(`/api/applications/${applicationId}/icon`, {}),
};
