import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  explainPermissions,
  grantRole,
  listAssignments,
  listRoles,
  revokeRole,
  searchUsers,
} from '../../../application/manage-access.js';
import { listUsers, setUserStatus } from '../../../application/manage-users.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';
import { parseRequest } from '../http-errors.js';
import { presentAssignment, presentExplanation, presentRole, presentUser, presentUserOverview } from '../presenters.js';
import { idOf, pagination, scopeQuerySchema, scopeSchema, TOTAL_COUNT } from '../schemas.js';

const ASSIGNMENT_QUERY = z.intersection(
  scopeQuerySchema,
  z.object({
    includeRevoked: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  }),
);

const GRANT_BODY = z.object({
  roleId: idOf<'Role'>(),
  userId: idOf<'User'>(),
  scope: scopeSchema,
  reason: z.string().max(2000),
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
});

const ASSIGNMENT_PARAMS = z.object({ assignmentId: idOf<'RoleAssignment'>() });
const USER_QUERY = z.object({
  query: z.string().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const EXPLAIN_PARAMS = z.object({ userId: idOf<'User'>() });
const DIRECTORY_QUERY = z.object({
  query: z.string().max(100).default(''),
  status: z.enum(['active', 'disabled']).optional(),
  ...pagination,
});
const STATUS_BODY = z.object({ status: z.enum(['active', 'disabled']) });

export function registerAccessRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.get('/api/roles', (request) =>
    listRoles(dependencies, requireSession(request).actor, requestContextOf(request)).map(presentRole),
  );

  app.get('/api/role-assignments', (request) => {
    const query = parseRequest(ASSIGNMENT_QUERY, request.query);
    return listAssignments(dependencies, requireSession(request).actor, requestContextOf(request), {
      scope: query,
      includeRevoked: query.includeRevoked,
    }).map(presentAssignment);
  });

  app.post('/api/role-assignments', async (request, reply) => {
    const body = parseRequest(GRANT_BODY, request.body);
    const result = grantRole(dependencies, requireSession(request).actor, requestContextOf(request), {
      ...body,
      expiresAt: body.expiresAt === null ? null : new Date(body.expiresAt),
    });

    return reply.status(201).send(result);
  });

  app.post('/api/role-assignments/:assignmentId/revoke', async (request, reply) => {
    const { assignmentId } = parseRequest(ASSIGNMENT_PARAMS, request.params);
    revokeRole(dependencies, requireSession(request).actor, requestContextOf(request), { assignmentId });
    return reply.status(204).send();
  });

  app.get('/api/users', (request) => {
    const query = parseRequest(USER_QUERY, request.query);
    return searchUsers(dependencies, requireSession(request).actor, requestContextOf(request), query).map(presentUser);
  });

  // User administration: everybody with last sign-in and roles; disabling ends every session at once.
  app.get('/api/user-directory', (request, reply) => {
    const query = parseRequest(DIRECTORY_QUERY, request.query);
    const page = listUsers(dependencies, requireSession(request).actor, requestContextOf(request), {
      query: query.query,
      status: query.status ?? null,
      limit: query.limit,
      offset: query.offset,
    });

    reply.header(TOTAL_COUNT, String(page.total));
    return page.entries.map(presentUserOverview);
  });

  app.post('/api/users/:userId/status', (request) => {
    const { userId } = parseRequest(EXPLAIN_PARAMS, request.params);
    const { status } = parseRequest(STATUS_BODY, request.body);
    return presentUser(
      setUserStatus(dependencies, requireSession(request).actor, requestContextOf(request), { userId, status }),
    );
  });

  app.get('/api/users/:userId/permissions', (request) => {
    const { userId } = parseRequest(EXPLAIN_PARAMS, request.params);
    const scope = parseRequest(scopeQuerySchema, request.query);

    return explainPermissions(dependencies, requireSession(request).actor, requestContextOf(request), {
      userId,
      scope,
    }).map(presentExplanation);
  });
}
