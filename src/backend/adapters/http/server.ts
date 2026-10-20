import { randomUUID } from 'node:crypto';

import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';

import { resolveSession } from '../../application/manage-session.js';
import { DomainError } from '../../domain/value-objects/domain-error.js';
import { cookieNames, type HttpDependencies } from './http-context.js';
import { toHttpError } from './http-errors.js';
import { registerAccessRoutes } from './routes/access-routes.js';
import { registerApplicationRoutes } from './routes/application-routes.js';
import { registerAuthRoutes } from './routes/auth-routes.js';
import { CI_API_PREFIX, registerCiRoutes } from './routes/ci-routes.js';
import { registerInstallRoutes } from './routes/install-routes.js';
import { registerOperationsRoutes } from './routes/operations-routes.js';
import { registerProjectRoutes } from './routes/project-routes.js';
import { registerReleaseRoutes } from './routes/release-routes.js';
import { registerShareRoutes } from './routes/share-routes.js';
import { registerCatalogRoutes } from './routes/catalog-routes.js';
import { registerPresentationRoutes } from './routes/presentation-routes.js';
import { registerAccountRoutes } from './routes/account-routes.js';
import { registerSettingsRoutes } from './routes/settings-routes.js';
import { registerStorageRoutes } from './routes/storage-routes.js';
import { registerUploadRoutes } from './routes/upload-routes.js';
import { registerDashboardRoutes } from './routes/dashboard-routes.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The administration API. Behind IIS it only listens on localhost; IIS terminates TLS and forwards requests.
 * Artifacts are streamed by this service after the access checks, never served by IIS directly.
 */
export function buildServer(dependencies: HttpDependencies): FastifyInstance {
  const { logger, publicUrl } = dependencies;
  const publicOrigin = new URL(publicUrl).origin;
  const cookies = cookieNames(publicUrl);
  const app = Fastify({
    // Fastify logs nothing itself; requests are logged without personal data in the onResponse hook below.
    logger: false,
    trustProxy: dependencies.trustProxy,
    bodyLimit: 1024 * 1024,
    // Installation tokens travel in the path (`/install/<token>/…`), iOS does not send them otherwise.
    routerOptions: { maxParamLength: 512 },
    genReqId: () => randomUUID(),
  });

  app.register(fastifyCookie);
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-correlation-id', request.id);

    // The GitHub Action authenticates every call by the OIDC token of its job; cookies play no part there.
    if (request.url.startsWith(CI_API_PREFIX)) {
      return;
    }

    // Cross-site request forgery: state-changing API calls must come from the platform's own pages.
    if (
      request.url.startsWith('/api/') &&
      !SAFE_METHODS.has(request.method) &&
      request.headers.origin !== publicOrigin
    ) {
      throw new DomainError('permission_denied', 'The request did not originate from this site.');
    }

    const token = request.cookies[cookies.session];

    if (token !== undefined && token !== '') {
      request.session = resolveSession(dependencies, token);
    }

    // Every API call needs a session; checked before any input is parsed, so anonymous callers learn nothing.
    if (request.url.startsWith('/api/') && request.session === null) {
      throw new DomainError('unauthenticated', 'Sign in to continue.');
    }
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');

    // Routes may opt into caching explicitly, e.g. icons behind content-hashed URLs.
    if (request.url.startsWith('/api/') && !reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
  });

  // Diagnostic log without personal data: no client address, no query string, no user.
  app.addHook('onResponse', async (request, reply) => {
    logger.info('request', {
      correlationId: request.id,
      method: request.method,
      route: request.routeOptions.url ?? 'unmatched',
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const mapped = toHttpError(error);

    if (mapped !== null) {
      return reply.status(mapped.status).send(mapped.body);
    }

    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 500;

    if (status >= 400 && status < 500) {
      return reply
        .status(status)
        .send({ error: { code: 'invalid_request', message: 'The request could not be processed.' } });
    }

    logger.error('unhandled error', {
      correlationId: request.id,
      route: request.routeOptions.url ?? 'unmatched',
      error: error instanceof Error ? error.name : 'unknown',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return reply.status(500).send({ error: { code: 'internal_error', message: 'An unexpected error occurred.' } });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'The resource does not exist.' } }),
  );

  app.register((instance, _options, done) => {
    registerAuthRoutes(instance, dependencies, cookies);
    registerProjectRoutes(instance, dependencies);
    registerApplicationRoutes(instance, dependencies);
    registerReleaseRoutes(instance, dependencies);
    registerUploadRoutes(instance, dependencies);
    registerInstallRoutes(instance, dependencies);
    registerShareRoutes(instance, dependencies);
    registerDashboardRoutes(instance, dependencies);
    registerStorageRoutes(instance, dependencies);
    registerSettingsRoutes(instance, dependencies);
    registerAccountRoutes(instance, dependencies);
    registerPresentationRoutes(instance, dependencies);
    registerCatalogRoutes(instance, dependencies);
    registerAccessRoutes(instance, dependencies);
    registerOperationsRoutes(instance, dependencies);
    registerCiRoutes(instance, dependencies);
    done();
  });

  return app;
}
