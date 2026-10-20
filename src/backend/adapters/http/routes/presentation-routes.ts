import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  readApplicationIcon,
  readProjectIcon,
  removeApplicationIcon,
  removeProjectIcon,
  reorderFlavors,
  uploadApplicationIcon,
  uploadProjectIcon,
} from '../../../application/manage-presentation.js';
import type { Actor, RequestContext } from '../../../application/request-context.js';
import { MAX_ICON_BYTES, type Asset } from '../../../domain/entities/asset.js';
import { DomainError } from '../../../domain/value-objects/domain-error.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';
import { parseRequest } from '../http-errors.js';
import { presentApplication, presentProject } from '../presenters.js';
import { idOf } from '../schemas.js';

const APPLICATION_PARAMS = z.object({ applicationId: idOf<'Application'>() });
const PROJECT_PARAMS = z.object({ projectId: idOf<'Project'>() });
const FLAVOR_ORDER_BODY = z.object({ flavorIds: z.array(idOf<'Flavor'>()).min(1).max(100) });

/** Icon types accepted as request body; the content itself is checked by its magic bytes. */
const ICON_BODY_TYPES = ['image/png', 'image/jpeg', 'application/octet-stream'];

/** Icons of applications and projects and the flavor order (concept 7.3 "Darstellung"). */
export function registerPresentationRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.register((scope, _options, done) => {
    // Hands the request stream on untouched; the size limit is enforced while streaming into the storage.
    scope.addContentTypeParser(ICON_BODY_TYPES, (_request, payload, parsed) => parsed(null, payload));

    scope.put('/api/applications/:applicationId/icon', async (request) => {
      const { applicationId } = parseRequest(APPLICATION_PARAMS, request.params);
      return presentApplication(
        await uploadApplicationIcon(dependencies, ...callerOf(request), { applicationId, content: iconBody(request) }),
      );
    });

    scope.put('/api/projects/:projectId/icon', async (request) => {
      const { projectId } = parseRequest(PROJECT_PARAMS, request.params);
      return presentProject(
        await uploadProjectIcon(dependencies, ...callerOf(request), { projectId, content: iconBody(request) }),
      );
    });

    done();
  });

  app.delete('/api/applications/:applicationId/icon', async (request) => {
    const { applicationId } = parseRequest(APPLICATION_PARAMS, request.params);
    return presentApplication(await removeApplicationIcon(dependencies, ...callerOf(request), applicationId));
  });

  app.delete('/api/projects/:projectId/icon', async (request) => {
    const { projectId } = parseRequest(PROJECT_PARAMS, request.params);
    return presentProject(await removeProjectIcon(dependencies, ...callerOf(request), projectId));
  });

  app.get('/api/applications/:applicationId/icon', async (request, reply) => {
    const { applicationId } = parseRequest(APPLICATION_PARAMS, request.params);
    return sendIconOrMissing(reply, await readApplicationIcon(dependencies, ...callerOf(request), applicationId));
  });

  app.get('/api/projects/:projectId/icon', async (request, reply) => {
    const { projectId } = parseRequest(PROJECT_PARAMS, request.params);
    return sendIconOrMissing(reply, await readProjectIcon(dependencies, ...callerOf(request), projectId));
  });

  app.put('/api/applications/:applicationId/flavor-order', (request) => {
    const { applicationId } = parseRequest(APPLICATION_PARAMS, request.params);
    const { flavorIds } = parseRequest(FLAVOR_ORDER_BODY, request.body);
    return presentApplication(reorderFlavors(dependencies, ...callerOf(request), { applicationId, flavorIds }));
  });
}

function callerOf(request: FastifyRequest): [Actor, RequestContext] {
  return [requireSession(request).actor, requestContextOf(request)];
}

/** The raw request body; a declared size beyond the limit is refused before anything is read. */
function iconBody(request: FastifyRequest): AsyncIterable<Uint8Array> {
  if (!ICON_BODY_TYPES.some((type) => request.headers['content-type']?.startsWith(type) === true)) {
    throw new DomainError('invalid_icon', 'The icon must be sent as image/png or image/jpeg.');
  }

  if (Number(request.headers['content-length'] ?? 0) > MAX_ICON_BYTES) {
    throw new DomainError('upload_too_large', 'The icon may be at most 512 KB.');
  }

  return request.body as IncomingMessage;
}

function sendIconOrMissing(
  reply: FastifyReply,
  found: { readonly icon: Asset; readonly content: AsyncIterable<Uint8Array> } | null,
): FastifyReply {
  if (found === null) {
    throw new DomainError('asset_not_found', 'There is no icon.');
  }

  return sendIcon(reply, found.icon, found.content);
}

/** Icon URLs carry a content hash, so the browser may keep them for a day without asking again. */
export function sendIcon(reply: FastifyReply, icon: Asset, content: AsyncIterable<Uint8Array>): FastifyReply {
  return reply
    .header('content-type', icon.contentType)
    .header('content-length', String(icon.sizeBytes))
    .header('etag', `"${icon.sha256}"`)
    .header('cache-control', 'private, max-age=86400')
    .header('content-security-policy', "default-src 'none'")
    .send(Readable.from(content));
}
