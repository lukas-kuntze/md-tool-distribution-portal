import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { createShareLink, listShareLinks, revokeShareLink } from '../../../application/manage-share-links.js';
import {
  describeSharedInstall,
  openSharedDownload,
  openSharedIcon,
  viewShare,
} from '../../../application/open-share.js';
import { DomainError } from '../../../domain/value-objects/domain-error.js';
import type { ShareLinkCreatedDto } from '../../../../shared/types/api.js';
import { rangeSelector, sendDownload } from '../download-response.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';
import { parseRequest } from '../http-errors.js';
import { presentShareLink, presentSharedContent } from '../presenters.js';
import { idOf } from '../schemas.js';
import { manifestPlist } from './install-routes.js';
import { sendIcon } from './presentation-routes.js';

const SHARE_SCOPE = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project'), projectId: idOf<'Project'>() }),
  z.object({ type: z.literal('application'), applicationId: idOf<'Application'>() }),
]);

/** Scope as query parameters, e.g. `?scope=application&id=…`. */
const LIST_QUERY = z.union([
  z
    .object({ scope: z.literal('project'), id: idOf<'Project'>() })
    .transform((query) => ({ type: 'project' as const, projectId: query.id })),
  z
    .object({ scope: z.literal('application'), id: idOf<'Application'>() })
    .transform((query) => ({ type: 'application' as const, applicationId: query.id })),
]);

const CREATE_BODY = z.object({
  scope: SHARE_SCOPE,
  label: z.string().max(200),
  releases: z.enum(['all', 'latest']).default('all'),
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
});

const LINK_PARAMS = z.object({ shareLinkId: idOf<'ShareLink'>() });
const TOKEN_PARAMS = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) });
const ARTIFACT_PARAMS = TOKEN_PARAMS.extend({ artifactId: idOf<'Artifact'>() });
const APPLICATION_PARAMS = TOKEN_PARAMS.extend({ applicationId: idOf<'Application'>() });

/**
 * Share links for people without an account (decision E7). Managing them needs a session and
 * `shares.manage`; the public routes under `/public/shares/<token>/` need nothing but the link.
 */
export function registerShareRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.get('/api/share-links', (request) => {
    const scope = parseRequest(LIST_QUERY, request.query);
    const now = dependencies.clock.now();

    return listShareLinks(dependencies, requireSession(request).actor, requestContextOf(request), scope).map((view) =>
      presentShareLink(view, now),
    );
  });

  app.post('/api/share-links', async (request, reply) => {
    const body = parseRequest(CREATE_BODY, request.body);
    const created = createShareLink(dependencies, requireSession(request).actor, requestContextOf(request), {
      ...body,
      expiresAt: body.expiresAt === null ? null : new Date(body.expiresAt),
    });
    const answer: ShareLinkCreatedDto = {
      shareLink: presentShareLink(created.view, dependencies.clock.now()),
      // The secret goes into the fragment: browsers never send it to a server or put it into a referrer.
      url: new URL(`/share.html#${created.token}`, dependencies.publicUrl).toString(),
    };

    return reply.status(201).send(answer);
  });

  app.post('/api/share-links/:shareLinkId/revoke', async (request, reply) => {
    const { shareLinkId } = parseRequest(LINK_PARAMS, request.params);
    revokeShareLink(dependencies, requireSession(request).actor, requestContextOf(request), { shareLinkId });
    return reply.status(204).send();
  });

  app.get('/public/shares/:token', async (request, reply) => {
    const { token } = parseRequest(TOKEN_PARAMS, request.params);
    const content = viewShare(dependencies, token, requestContextOf(request));

    return privately(reply).send(presentSharedContent(content, { publicUrl: dependencies.publicUrl, token }));
  });

  app.get('/public/shares/:token/applications/:applicationId/icon', async (request, reply) => {
    const { token, applicationId } = parseRequest(APPLICATION_PARAMS, request.params);
    const icon = await openSharedIcon(dependencies, token, applicationId);

    if (icon === null) {
      throw new DomainError('application_not_found', 'The application has no icon.');
    }

    return sendIcon(reply.header('x-robots-tag', 'noindex, nofollow'), icon.icon, icon.content);
  });

  app.get('/public/shares/:token/artifacts/:artifactId/download', async (request, reply) => {
    const { token, artifactId } = parseRequest(ARTIFACT_PARAMS, request.params);
    const download = await openSharedDownload(dependencies, token, requestContextOf(request), {
      artifactId,
      selectRange: rangeSelector(request),
    });

    return sendDownload(privately(reply), download, 'application/octet-stream');
  });

  app.get('/public/shares/:token/artifacts/:artifactId/manifest.plist', async (request, reply) => {
    const { token, artifactId } = parseRequest(ARTIFACT_PARAMS, request.params);
    const manifest = describeSharedInstall(dependencies, token, artifactId);
    const ipaUrl = new URL(
      `/public/shares/${token}/artifacts/${artifactId}/download`,
      dependencies.publicUrl,
    ).toString();

    return privately(reply).header('content-type', 'text/xml; charset=utf-8').send(manifestPlist(manifest, ipaUrl));
  });
}

/** Shared content is personal to the link: never cached by proxies, never indexed. */
function privately(reply: FastifyReply): FastifyReply {
  return reply.header('cache-control', 'private, no-store').header('x-robots-tag', 'noindex, nofollow');
}
