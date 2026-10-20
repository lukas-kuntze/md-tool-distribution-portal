import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  endAllSessions,
  endSession,
  getAccount,
  updatePreferences,
  type Account,
} from '../../../application/manage-account.js';
import { START_PAGES, THEMES } from '../../../domain/entities/user-preferences.js';
import type { AccountDto, PreferencesDto } from '../../../../shared/types/api.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';
import { parseRequest } from '../http-errors.js';
import { presentScope, presentUser } from '../presenters.js';
import { idOf } from '../schemas.js';

const PREFERENCES_BODY = z.object({ theme: z.enum(THEMES).optional(), startPage: z.enum(START_PAGES).optional() });
const SESSION_PARAMS = z.object({ sessionId: idOf<'Session'>() });

/** The signed-in person's own account; no permission beyond a valid session. */
export function registerAccountRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.get('/api/account', (request): AccountDto =>
    presentAccount(getAccount(dependencies, requireSession(request), requestContextOf(request))),
  );

  app.patch('/api/account/preferences', (request): PreferencesDto => {
    const changes = parseRequest(PREFERENCES_BODY, request.body);
    return updatePreferences(dependencies, requireSession(request), requestContextOf(request), {
      ...(changes.theme === undefined ? {} : { theme: changes.theme }),
      ...(changes.startPage === undefined ? {} : { startPage: changes.startPage }),
    });
  });

  app.post('/api/account/sessions/:sessionId/revoke', async (request, reply) => {
    const { sessionId } = parseRequest(SESSION_PARAMS, request.params);
    endSession(dependencies, requireSession(request), requestContextOf(request), sessionId);
    return reply.status(204).send();
  });

  app.post('/api/account/sessions/revoke-all', async (request, reply) => {
    endAllSessions(dependencies, requireSession(request), requestContextOf(request));
    return reply.status(204).send();
  });
}

function presentAccount(account: Account): AccountDto {
  return {
    user: presentUser(account.summary),
    preferences: account.preferences,
    roles: account.roles.map((role) => ({
      roleKey: role.roleKey,
      scope: presentScope(role.scope),
      scopeName: role.scopeName,
      viaTeam: role.viaTeam,
      expiresAt: role.expiresAt?.toISOString() ?? null,
      permissions: role.permissions,
    })),
    sessions: account.sessions.map(({ session, userAgent, current }) => ({
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      userAgent,
      current,
    })),
  };
}
