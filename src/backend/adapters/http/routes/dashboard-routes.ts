import type { FastifyInstance } from 'fastify';

import { getDashboard, type Dashboard } from '../../../application/get-dashboard.js';
import type { DashboardApplicationDto, DashboardDto } from '../../../../shared/types/api.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';

export function registerDashboardRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.get('/api/dashboard', (request): DashboardDto =>
    presentDashboard(getDashboard(dependencies, requireSession(request).actor, requestContextOf(request))),
  );
}

export function presentDashboard(dashboard: Dashboard): DashboardDto {
  const projects = dashboard.projects.map(({ project, applications }) => ({
    id: project.id,
    name: project.name,
    applications: applications.map(({ application, statistics, downloads }): DashboardApplicationDto => ({
      id: application.id,
      name: application.name,
      published: statistics.published,
      drafts: statistics.drafts,
      inDeletion: statistics.inDeletion,
      downloads,
      latest:
        statistics.latestPublished === null
          ? null
          : { ...statistics.latestPublished, publishedAt: statistics.latestPublished.publishedAt.toISOString() },
    })),
  }));
  const applications = projects.flatMap((project) => project.applications);
  const sum = (field: 'published' | 'drafts' | 'inDeletion' | 'downloads'): number =>
    applications.reduce((total, application) => total + application[field], 0);

  return {
    downloadDays: dashboard.windows.downloadDays,
    quarantineDays: dashboard.windows.quarantineDays,
    shareExpiryDays: dashboard.windows.shareExpiryDays,
    previousSignInAt: dashboard.previousSignInAt?.toISOString() ?? null,
    shareLinks: dashboard.shareLinks,
    quarantineEnding: dashboard.quarantineEnding.map(({ release, application, project, canRestore }) => ({
      releaseId: release.releaseId,
      version: release.version,
      buildNumber: release.buildNumber,
      purgeAfter: release.purgeAfter.toISOString(),
      applicationId: application.id,
      applicationName: application.name,
      projectName: project.name,
      canRestore,
    })),
    totals: {
      projects: projects.length,
      applications: applications.length,
      published: sum('published'),
      drafts: sum('drafts'),
      inDeletion: sum('inDeletion'),
      downloads: sum('downloads'),
    },
    projects,
    recentReleases: dashboard.recentReleases.map(({ release, application, project }) => ({
      id: release.releaseId,
      version: release.version,
      buildNumber: release.buildNumber,
      publicationStatus: release.publicationStatus,
      lifecycleState: release.lifecycleState,
      createdAt: release.createdAt.toISOString(),
      publishedAt: release.publishedAt?.toISOString() ?? null,
      applicationId: application.id,
      applicationName: application.name,
      projectId: project.id,
      projectName: project.name,
    })),
  };
}
