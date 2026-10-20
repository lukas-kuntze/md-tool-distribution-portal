import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  createApplication,
  createFlavor,
  getApplication,
  listApplications,
  updateApplication,
  updateFlavor,
} from '../../../application/manage-applications.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';
import { parseRequest } from '../http-errors.js';
import { presentApplication, presentFlavor } from '../presenters.js';
import { bundleIdentifiersSchema, idOf, platformSchema, rowVersion } from '../schemas.js';

const PROJECT_PARAMS = z.object({ projectId: idOf<'Project'>() });
const APPLICATION_PARAMS = z.object({ applicationId: idOf<'Application'>() });
const FLAVOR_PARAMS = z.object({ flavorId: idOf<'Flavor'>() });

const FRAMEWORK = z.enum(['flutter', 'dotnet_maui']);
const VISIBILITY = z.enum(['private', 'organization']);

const CREATE_APPLICATION_BODY = z.object({
  slug: z.string().max(63),
  name: z.string().max(200),
  description: z.string().max(2000).default(''),
  framework: FRAMEWORK.default('flutter'),
  platforms: z.array(platformSchema).max(2),
  // Without a choice the platform setting decides.
  visibility: VISIBILITY.optional(),
  bundleIdentifiers: bundleIdentifiersSchema.default({}),
});

const UPDATE_APPLICATION_BODY = z.object({
  rowVersion,
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  framework: FRAMEWORK.optional(),
  platforms: z.array(platformSchema).max(2).optional(),
  visibility: VISIBILITY.optional(),
  flavorsEnabled: z.boolean().optional(),
  installNotes: z.string().max(10_000).optional(),
});

const CREATE_FLAVOR_BODY = z.object({
  key: z.string().max(64),
  name: z.string().max(200),
  bundleIdentifiers: bundleIdentifiersSchema.default({}),
});

const UPDATE_FLAVOR_BODY = z.object({
  rowVersion,
  key: z.string().max(64).optional(),
  name: z.string().max(200).optional(),
  status: z.enum(['active', 'disabled', 'archived']).optional(),
  bundleIdentifiers: bundleIdentifiersSchema.optional(),
});

export function registerApplicationRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.get('/api/projects/:projectId/applications', (request) => {
    const { projectId } = parseRequest(PROJECT_PARAMS, request.params);
    return listApplications(dependencies, requireSession(request).actor, requestContextOf(request), projectId).map(
      presentApplication,
    );
  });

  app.post('/api/projects/:projectId/applications', async (request, reply) => {
    const { projectId } = parseRequest(PROJECT_PARAMS, request.params);
    const body = parseRequest(CREATE_APPLICATION_BODY, request.body);
    const view = createApplication(dependencies, requireSession(request).actor, requestContextOf(request), {
      ...body,
      projectId,
    });

    return reply.status(201).send(presentApplication(view));
  });

  app.get('/api/applications/:applicationId', (request) => {
    const { applicationId } = parseRequest(APPLICATION_PARAMS, request.params);
    return presentApplication(
      getApplication(dependencies, requireSession(request).actor, requestContextOf(request), applicationId),
    );
  });

  app.patch('/api/applications/:applicationId', (request) => {
    const { applicationId } = parseRequest(APPLICATION_PARAMS, request.params);
    const { rowVersion: expectedRowVersion, ...changes } = parseRequest(UPDATE_APPLICATION_BODY, request.body);

    return presentApplication(
      updateApplication(dependencies, requireSession(request).actor, requestContextOf(request), {
        ...changes,
        applicationId,
        expectedRowVersion,
      }),
    );
  });

  app.post('/api/applications/:applicationId/flavors', async (request, reply) => {
    const { applicationId } = parseRequest(APPLICATION_PARAMS, request.params);
    const body = parseRequest(CREATE_FLAVOR_BODY, request.body);
    const flavor = createFlavor(dependencies, requireSession(request).actor, requestContextOf(request), {
      ...body,
      applicationId,
    });

    return reply.status(201).send(presentFlavor(flavor));
  });

  app.patch('/api/flavors/:flavorId', (request) => {
    const { flavorId } = parseRequest(FLAVOR_PARAMS, request.params);
    const { rowVersion: expectedRowVersion, ...changes } = parseRequest(UPDATE_FLAVOR_BODY, request.body);

    return presentFlavor(
      updateFlavor(dependencies, requireSession(request).actor, requestContextOf(request), {
        ...changes,
        flavorId,
        expectedRowVersion,
      }),
    );
  });
}
