import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { listDeletionJobs, purgeDeletionJobNow, retryDeletionJob } from '../../../application/manage-deletion-jobs.js';
import { getPlatformSettings } from '../../../application/get-platform-settings.js';
import { listAuditEntries } from '../../../application/read-audit-log.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';
import { parseRequest } from '../http-errors.js';
import { presentAuditEntry, presentDeletionJob, presentPlatformSettings } from '../presenters.js';
import { csvOf, idOf, pagination, scopeQuerySchema, TOTAL_COUNT } from '../schemas.js';

const AUDIT_QUERY = z.intersection(
  scopeQuerySchema,
  z.object({
    actorUserId: idOf<'User'>().optional(),
    action: z.string().max(100).optional(),
    outcome: z.enum(['success', 'denied', 'failed']).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    ...pagination,
  }),
);

const JOB_QUERY = z.object({
  state: csvOf([
    'requested',
    'quarantining',
    'quarantined',
    'restoring',
    'restored',
    'purging',
    'completed',
    'failed',
    'cancelled',
  ]),
});

const JOB_PARAMS = z.object({ deletionJobId: idOf<'DeletionJob'>() });

export function registerOperationsRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.get('/api/platform-settings', (request) =>
    presentPlatformSettings(
      getPlatformSettings(dependencies, requireSession(request).actor, requestContextOf(request)),
    ),
  );

  app.get('/api/audit-logs', (request, reply) => {
    const query = parseRequest(AUDIT_QUERY, request.query);

    const page = listAuditEntries(dependencies, requireSession(request).actor, requestContextOf(request), {
      scope: query,
      filter: {
        limit: query.limit,
        offset: query.offset,
        ...(query.actorUserId === undefined ? {} : { actorUserId: query.actorUserId }),
        ...(query.action === undefined ? {} : { actionPrefix: query.action }),
        ...(query.outcome === undefined ? {} : { outcome: query.outcome }),
        ...(query.from === undefined ? {} : { from: new Date(query.from) }),
        ...(query.to === undefined ? {} : { to: new Date(query.to) }),
      },
    });

    reply.header(TOTAL_COUNT, String(page.total));
    return page.entries.map(presentAuditEntry);
  });

  app.get('/api/deletion-jobs', (request) => {
    const { state } = parseRequest(JOB_QUERY, request.query);

    return listDeletionJobs(dependencies, requireSession(request).actor, requestContextOf(request), {
      states: state ?? ['requested', 'quarantining', 'quarantined', 'restoring', 'purging', 'failed'],
    }).map(presentDeletionJob);
  });

  app.post('/api/deletion-jobs/:deletionJobId/retry', (request) => {
    const { deletionJobId } = parseRequest(JOB_PARAMS, request.params);
    return presentDeletionJob(
      retryDeletionJob(dependencies, requireSession(request).actor, requestContextOf(request), { deletionJobId }),
    );
  });

  app.post('/api/deletion-jobs/:deletionJobId/purge-now', (request) => {
    const { deletionJobId } = parseRequest(JOB_PARAMS, request.params);
    return presentDeletionJob(
      purgeDeletionJobNow(dependencies, requireSession(request).actor, requestContextOf(request), { deletionJobId }),
    );
  });
}
