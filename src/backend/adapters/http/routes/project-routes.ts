import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  archiveProject,
  createProject,
  getProject,
  listProjects,
  restoreProject,
  updateProject,
} from '../../../application/manage-projects.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';
import { parseRequest } from '../http-errors.js';
import { presentProject } from '../presenters.js';
import { idOf, rowVersion } from '../schemas.js';

const PROJECT_PARAMS = z.object({ projectId: idOf<'Project'>() });

const CREATE_BODY = z.object({
  slug: z.string().max(63),
  name: z.string().max(200),
  description: z.string().max(2000).default(''),
});

const UPDATE_BODY = z.object({ name: z.string().max(200), description: z.string().max(2000), rowVersion });

const VERSION_BODY = z.object({ rowVersion });

const LIST_QUERY = z.object({ status: z.enum(['active', 'archived']).optional() });

export function registerProjectRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.get('/api/projects', (request) => {
    const query = parseRequest(LIST_QUERY, request.query);
    const filter = query.status === undefined ? {} : { status: query.status };
    return listProjects(dependencies, requireSession(request).actor, requestContextOf(request), filter).map(
      presentProject,
    );
  });

  app.post('/api/projects', async (request, reply) => {
    const body = parseRequest(CREATE_BODY, request.body);
    const { actor } = requireSession(request);
    const created = createProject(dependencies, actor, requestContextOf(request), body);
    const view = getProject(dependencies, actor, requestContextOf(request), created.value.id);

    return reply.status(201).send(presentProject(view));
  });

  app.get('/api/projects/:projectId', (request) => {
    const { projectId } = parseRequest(PROJECT_PARAMS, request.params);
    return presentProject(
      getProject(dependencies, requireSession(request).actor, requestContextOf(request), projectId),
    );
  });

  app.patch('/api/projects/:projectId', (request) => {
    const { projectId } = parseRequest(PROJECT_PARAMS, request.params);
    const body = parseRequest(UPDATE_BODY, request.body);
    const { actor } = requireSession(request);

    updateProject(dependencies, actor, requestContextOf(request), {
      ...body,
      projectId,
      expectedRowVersion: body.rowVersion,
    });
    return presentProject(getProject(dependencies, actor, requestContextOf(request), projectId));
  });

  for (const [path, change] of [
    ['archive', archiveProject],
    ['restore', restoreProject],
  ] as const) {
    app.post(`/api/projects/:projectId/${path}`, (request) => {
      const { projectId } = parseRequest(PROJECT_PARAMS, request.params);
      const body = parseRequest(VERSION_BODY, request.body);
      const { actor } = requireSession(request);

      change(dependencies, actor, requestContextOf(request), { projectId, expectedRowVersion: body.rowVersion });
      return presentProject(getProject(dependencies, actor, requestContextOf(request), projectId));
    });
  }
}
