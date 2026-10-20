import type { IncomingMessage } from 'node:http';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { SUPPLEMENTARY_KINDS, uploadBuild, uploadReleaseFile } from '../../../application/upload-artifact.js';
import { DomainError } from '../../../domain/value-objects/domain-error.js';
import type { UploadResultDto } from '../../../../shared/types/api.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';
import { parseRequest, RequestValidationError } from '../http-errors.js';
import { idOf } from '../schemas.js';

const fileName = z.string().min(1).max(255);

const BUILD_PARAMS = z.object({ applicationId: idOf<'Application'>() });
const BUILD_QUERY = z.object({
  fileName,
  commitSha: z.string().max(64).optional(),
  flavorId: idOf<'Flavor'>().optional(),
});

const FILE_PARAMS = z.object({ releaseId: idOf<'Release'>() });
const FILE_QUERY = z.object({ fileName, kind: z.enum(['binary', ...SUPPLEMENTARY_KINDS]).default('binary') });

/**
 * Manual uploads from the administration (concept 5.5). The file is the raw request body
 * (`application/octet-stream`), metadata travels in the query string, so the body can be streamed into the
 * storage without being buffered or parsed as a form.
 */
export function registerUploadRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.register((scope, _options, done) => {
    // Hands the request stream on untouched; the size limit is enforced while streaming into the storage.
    scope.addContentTypeParser('application/octet-stream', (_request, payload, parsed) => parsed(null, payload));

    scope.post('/api/applications/:applicationId/builds', async (request, reply) => {
      const { applicationId } = parseRequest(BUILD_PARAMS, request.params);
      const query = parseRequest(BUILD_QUERY, request.query);
      const result = await uploadBuild(dependencies, requireSession(request).actor, requestContextOf(request), {
        applicationId,
        flavorId: query.flavorId ?? null,
        fileName: query.fileName,
        commitSha: query.commitSha === undefined || query.commitSha === '' ? null : query.commitSha,
        content: bodyOf(request, dependencies.maxUploadBytes),
      });

      return reply.status(201).send(result satisfies UploadResultDto);
    });

    scope.post('/api/releases/:releaseId/artifacts', async (request, reply) => {
      const { releaseId } = parseRequest(FILE_PARAMS, request.params);
      const query = parseRequest(FILE_QUERY, request.query);
      const result = await uploadReleaseFile(dependencies, requireSession(request).actor, requestContextOf(request), {
        releaseId,
        kind: query.kind,
        fileName: query.fileName,
        content: bodyOf(request, dependencies.maxUploadBytes),
      });

      return reply.status(201).send(result satisfies UploadResultDto);
    });

    done();
  });
}

/** The request stream; a declared size beyond the limit is refused before anything is read. */
export function bodyOf(request: FastifyRequest, maxBytes: number): AsyncIterable<Uint8Array> {
  if (!request.headers['content-type']?.startsWith('application/octet-stream')) {
    throw new RequestValidationError([{ path: 'body', message: 'Uploads must be sent as application/octet-stream.' }]);
  }

  if (Number(request.headers['content-length'] ?? 0) > maxBytes) {
    throw new DomainError('upload_too_large', 'The upload exceeds the maximum size for this kind of file.');
  }

  return request.body as IncomingMessage;
}
