import type { FastifyInstance } from 'fastify';

import { getStorageOverview, reconcileStorage, type StorageOverview } from '../../../application/reconcile-storage.js';
import type { StorageReport } from '../../../domain/entities/storage-report.js';
import type { StorageOverviewDto, StorageReportDto } from '../../../../shared/types/api.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';

export function registerStorageRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.get('/api/storage', (request): StorageOverviewDto =>
    presentStorageOverview(getStorageOverview(dependencies, requireSession(request).actor, requestContextOf(request))),
  );

  app.post('/api/storage/reconcile', async (request): Promise<StorageReportDto> =>
    presentStorageReport(
      await reconcileStorage(dependencies, {
        type: 'manual',
        actor: requireSession(request).actor,
        request: requestContextOf(request),
      }),
    ),
  );
}

export function presentStorageOverview(overview: StorageOverview): StorageOverviewDto {
  return {
    total: overview.usage.total,
    projects: overview.usage.projects,
    latestReport: overview.latestReport === null ? null : presentStorageReport(overview.latestReport),
  };
}

export function presentStorageReport(report: StorageReport): StorageReportDto {
  return {
    ...report,
    startedAt: report.startedAt.toISOString(),
    finishedAt: report.finishedAt.toISOString(),
  };
}
