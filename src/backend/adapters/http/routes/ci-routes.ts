import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ciUpdateReleaseTexts, ciUploadBuild, ciUploadReleaseFile } from '../../../application/ci-upload.js';
import { createCiBinding, listCiBindings, revokeCiBinding } from '../../../application/manage-ci-bindings.js';
import { SUPPLEMENTARY_KINDS } from '../../../application/upload-artifact.js';
import { DomainError } from '../../../domain/value-objects/domain-error.js';
import type { CiSettingsDto, UploadResultDto } from '../../../../shared/types/api.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';
import { parseRequest } from '../http-errors.js';
import { presentCiBinding } from '../presenters.js';
import { idOf } from '../schemas.js';
import { bodyOf } from './upload-routes.js';

/** Prefix of the routes the GitHub Action calls; they authenticate by OIDC token, never by cookie. */
export const CI_API_PREFIX = '/api/ci/';

const fileName = z.string().min(1).max(255);

const APPLICATION_PARAMS = z.object({ applicationId: idOf<'Application'>() });
const RELEASE_PARAMS = z.object({ releaseId: idOf<'Release'>() });
const BINDING_PARAMS = z.object({ ciBindingId: idOf<'CiBinding'>() });

const CREATE_BODY = z.object({
  repositoryId: z.number().int().positive(),
  repositoryName: z.string().max(201),
  refPattern: z.string().max(255),
  environment: z.string().max(255).nullable().default(null),
});

const BUILD_QUERY = z.object({ fileName, flavor: z.string().max(63).optional() });
const FILE_QUERY = z.object({ fileName, kind: z.enum(SUPPLEMENTARY_KINDS) });
const TEXTS_BODY = z.object({ releaseNotes: z.string().optional(), changelog: z.string().optional() });

/**
 * CI bindings in the application settings (`applications.manage`), and the upload routes of the GitHub Action
 * under `/api/ci/` (concept 4.7). The latter take the job's OIDC token as bearer token; the server hook lets
 * them pass without session and origin check, as no browser and no cookie is involved.
 */
export function registerCiRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.get('/api/applications/:applicationId/ci', (request) => {
    const { applicationId } = parseRequest(APPLICATION_PARAMS, request.params);
    const bindings = listCiBindings(
      dependencies,
      requireSession(request).actor,
      requestContextOf(request),
      applicationId,
    );

    return {
      bindings: bindings.map(presentCiBinding),
      portalUrl: new URL(dependencies.publicUrl).origin,
      audience: dependencies.ciAudience,
    } satisfies CiSettingsDto;
  });

  app.post('/api/applications/:applicationId/ci-bindings', async (request, reply) => {
    const { applicationId } = parseRequest(APPLICATION_PARAMS, request.params);
    const body = parseRequest(CREATE_BODY, request.body);
    const view = createCiBinding(dependencies, requireSession(request).actor, requestContextOf(request), {
      applicationId,
      ...body,
    });

    return reply.status(201).send(presentCiBinding(view));
  });

  app.post('/api/ci-bindings/:ciBindingId/revoke', async (request, reply) => {
    const { ciBindingId } = parseRequest(BINDING_PARAMS, request.params);
    revokeCiBinding(dependencies, requireSession(request).actor, requestContextOf(request), { ciBindingId });
    return reply.status(204).send();
  });

  app.register((scope, _options, done) => {
    // The request stream is handed on untouched, as for uploads from the administration.
    scope.addContentTypeParser('application/octet-stream', (_request, payload, parsed) => parsed(null, payload));

    scope.post(`${CI_API_PREFIX}applications/:applicationId/builds`, async (request, reply) => {
      const { applicationId } = parseRequest(APPLICATION_PARAMS, request.params);
      const query = parseRequest(BUILD_QUERY, request.query);
      const result = await ciUploadBuild(dependencies, bearerOf(request), requestContextOf(request), {
        applicationId,
        flavorKey: query.flavor ?? null,
        fileName: query.fileName,
        content: bodyOf(request, dependencies.maxUploadBytes),
      });

      return reply.status(201).send(result satisfies UploadResultDto);
    });

    scope.post(`${CI_API_PREFIX}releases/:releaseId/artifacts`, async (request, reply) => {
      const { releaseId } = parseRequest(RELEASE_PARAMS, request.params);
      const query = parseRequest(FILE_QUERY, request.query);
      const result = await ciUploadReleaseFile(dependencies, bearerOf(request), requestContextOf(request), {
        releaseId,
        kind: query.kind,
        fileName: query.fileName,
        content: bodyOf(request, dependencies.maxUploadBytes),
      });

      return reply.status(201).send(result satisfies UploadResultDto);
    });

    scope.patch(`${CI_API_PREFIX}releases/:releaseId/texts`, async (request) => {
      const { releaseId } = parseRequest(RELEASE_PARAMS, request.params);
      const body = parseRequest(TEXTS_BODY, request.body);

      return ciUpdateReleaseTexts(dependencies, bearerOf(request), requestContextOf(request), {
        releaseId,
        ...(body.releaseNotes === undefined ? {} : { releaseNotes: body.releaseNotes }),
        ...(body.changelog === undefined ? {} : { changelog: body.changelog }),
      });
    });

    done();
  });
}

function bearerOf(request: FastifyRequest): string {
  const match = /^Bearer (\S+)$/i.exec(request.headers.authorization ?? '');

  if (match?.[1] === undefined) {
    throw new DomainError('ci_token_invalid', 'Send the OIDC token of the job as bearer token.');
  }

  return match[1];
}
