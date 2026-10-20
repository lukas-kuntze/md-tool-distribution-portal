import type { FastifyInstance } from 'fastify';

import { getCatalog } from '../../../application/get-catalog.js';
import type { CatalogDto } from '../../../../shared/types/api.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';
import { presentPublishedApplication } from '../presenters.js';

export function registerCatalogRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.get('/api/catalog', (request): CatalogDto => {
    const catalog = getCatalog(dependencies, requireSession(request).actor, requestContextOf(request));

    return {
      projects: catalog.projects.map(({ project, applications }) => ({
        id: project.id,
        name: project.name,
        description: project.description,
        applications: applications.map((application) =>
          presentPublishedApplication(application, {
            icon: (id) => `/api/applications/${id}/icon`,
            download: (id) => `/api/artifacts/${id}/download`,
            // Installation links are signed and short-lived, so they are requested when the user taps.
            install: () => null,
          }),
        ),
      })),
    };
  });
}
