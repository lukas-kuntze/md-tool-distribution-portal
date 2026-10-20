import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { openArtifactDownload } from '../../../application/download-artifact.js';
import {
  getRelease,
  listReleases,
  publishRelease,
  releaseBuildNumber,
  updateReleaseTexts,
  withdrawRelease,
} from '../../../application/manage-releases.js';
import { requestArtifactRemoval, restoreRemovedArtifact } from '../../../application/remove-artifact.js';
import { restoreQuarantinedRelease } from '../../../application/restore-quarantined-release.js';
import { submitReleaseDeletion } from '../../../application/submit-release-deletion.js';
import { rangeSelector, sendDownload } from '../download-response.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';
import { parseRequest } from '../http-errors.js';
import { presentReleaseDetail, presentReleaseSummary } from '../presenters.js';
import { csvOf, idOf, pagination, rowVersion, TOTAL_COUNT } from '../schemas.js';

const APPLICATION_PARAMS = z.object({ applicationId: idOf<'Application'>() });
const RELEASE_PARAMS = z.object({ releaseId: idOf<'Release'>() });
const ARTIFACT_PARAMS = z.object({ artifactId: idOf<'Artifact'>() });

const LIST_QUERY = z.object({
  flavorId: idOf<'Flavor'>().optional(),
  status: csvOf(['draft', 'published', 'withdrawn']),
  lifecycle: csvOf(['active', 'pending_deletion', 'quarantined', 'purged']),
  search: z.string().max(100).optional(),
  ...pagination,
});

const TEXTS_BODY = z.object({
  rowVersion,
  releaseNotes: z.string().max(50_000).optional(),
  changelog: z.string().max(50_000).optional(),
});

const VERSION_BODY = z.object({ rowVersion });
const REASON_BODY = z.object({ rowVersion, reason: z.string().max(2000) });
const REMOVE_BODY = z.object({ reason: z.string().max(2000) });
const DELETE_BODY = z.object({ rowVersion, confirmation: z.string().max(300), reason: z.string().max(2000) });

export function registerReleaseRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.get('/api/applications/:applicationId/releases', (request, reply) => {
    const { applicationId } = parseRequest(APPLICATION_PARAMS, request.params);
    const query = parseRequest(LIST_QUERY, request.query);

    const page = listReleases(dependencies, requireSession(request).actor, requestContextOf(request), {
      applicationId,
      limit: query.limit,
      offset: query.offset,
      ...(query.flavorId === undefined ? {} : { flavorId: query.flavorId }),
      ...(query.status === undefined ? {} : { publicationStatuses: query.status }),
      ...(query.lifecycle === undefined ? {} : { lifecycleStates: query.lifecycle }),
      ...(query.search === undefined ? {} : { search: query.search }),
    });

    reply.header(TOTAL_COUNT, String(page.total));
    return page.entries.map(presentReleaseSummary);
  });

  app.get('/api/releases/:releaseId', (request) => {
    const { releaseId } = parseRequest(RELEASE_PARAMS, request.params);
    return presentReleaseDetail(
      getRelease(dependencies, requireSession(request).actor, requestContextOf(request), releaseId),
    );
  });

  app.patch('/api/releases/:releaseId', (request) => {
    const { releaseId } = parseRequest(RELEASE_PARAMS, request.params);
    const { rowVersion: expectedRowVersion, ...texts } = parseRequest(TEXTS_BODY, request.body);

    return presentReleaseDetail(
      updateReleaseTexts(dependencies, requireSession(request).actor, requestContextOf(request), {
        ...texts,
        releaseId,
        expectedRowVersion,
      }),
    );
  });

  for (const [path, change] of [
    ['publish', publishRelease],
    ['withdraw', withdrawRelease],
  ] as const) {
    app.post(`/api/releases/:releaseId/${path}`, (request) => {
      const { releaseId } = parseRequest(RELEASE_PARAMS, request.params);
      const body = parseRequest(VERSION_BODY, request.body);

      return presentReleaseDetail(
        change(dependencies, requireSession(request).actor, requestContextOf(request), {
          releaseId,
          expectedRowVersion: body.rowVersion,
        }),
      );
    });
  }

  app.post('/api/releases/:releaseId/release-build-number', (request) => {
    const { releaseId } = parseRequest(RELEASE_PARAMS, request.params);
    const body = parseRequest(REASON_BODY, request.body);

    return presentReleaseDetail(
      releaseBuildNumber(dependencies, requireSession(request).actor, requestContextOf(request), {
        releaseId,
        expectedRowVersion: body.rowVersion,
        reason: body.reason,
      }),
    );
  });

  // 202: the release is gone at once, the files follow asynchronously through quarantine.
  app.delete('/api/releases/:releaseId', async (request, reply) => {
    const { releaseId } = parseRequest(RELEASE_PARAMS, request.params);
    const body = parseRequest(DELETE_BODY, request.body);
    const { deletionJobId } = submitReleaseDeletion(dependencies, {
      actor: requireSession(request).actor,
      request: requestContextOf(request),
      releaseId,
      expectedRowVersion: body.rowVersion,
      confirmation: body.confirmation,
      reason: body.reason,
    });

    return reply.status(202).send({ deletionJobId });
  });

  app.post('/api/releases/:releaseId/restore', async (request) => {
    const { releaseId } = parseRequest(RELEASE_PARAMS, request.params);
    const { actor } = requireSession(request);

    await restoreQuarantinedRelease(dependencies, { actor, request: requestContextOf(request), releaseId });
    return presentReleaseDetail(getRelease(dependencies, actor, requestContextOf(request), releaseId));
  });

  // 202: the artifact is gone for users at once; the worker moves its file into quarantine.
  app.post('/api/artifacts/:artifactId/remove', async (request, reply) => {
    const { artifactId } = parseRequest(ARTIFACT_PARAMS, request.params);
    const { reason } = parseRequest(REMOVE_BODY, request.body);
    const result = requestArtifactRemoval(dependencies, requireSession(request).actor, requestContextOf(request), {
      artifactId,
      reason,
    });

    return reply.status(202).send(result);
  });

  app.post('/api/artifacts/:artifactId/restore', async (request, reply) => {
    const { artifactId } = parseRequest(ARTIFACT_PARAMS, request.params);
    await restoreRemovedArtifact(dependencies, requireSession(request).actor, requestContextOf(request), {
      artifactId,
    });
    return reply.status(204).send();
  });

  app.get('/api/artifacts/:artifactId/download', async (request, reply) => {
    const { artifactId } = parseRequest(ARTIFACT_PARAMS, request.params);
    const download = await openArtifactDownload(
      dependencies,
      requireSession(request).actor,
      requestContextOf(request),
      { artifactId, selectRange: rangeSelector(request) },
    );

    return sendDownload(reply, download, 'application/octet-stream');
  });
}
