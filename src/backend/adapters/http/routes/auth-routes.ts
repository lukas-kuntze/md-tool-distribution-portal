import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getCurrentUser } from '../../../application/get-current-user.js';
import { signOut } from '../../../application/manage-session.js';
import { completeSignIn, startSignIn } from '../../../application/sign-in-with-github.js';
import { DomainError } from '../../../domain/value-objects/domain-error.js';
import { requestContextOf, requireSession, type CookieNames, type HttpDependencies } from '../http-context.js';
import { toHttpError } from '../http-errors.js';
import { presentCurrentUser } from '../presenters.js';

const CALLBACK_QUERY = z.object({ code: z.string().min(1).max(512), state: z.string().min(1).max(256) });

const STATE_MAX_AGE_SECONDS = 600;

export function registerAuthRoutes(app: FastifyInstance, dependencies: HttpDependencies, cookies: CookieNames): void {
  const cookieOptions = { path: '/', httpOnly: true, secure: cookies.secure, sameSite: 'lax' } as const;

  app.get('/auth/github/login', async (_request, reply) => {
    const { state, redirectUrl } = startSignIn(dependencies);

    reply.setCookie(cookies.state, state, { ...cookieOptions, maxAge: STATE_MAX_AGE_SECONDS });
    return reply.redirect(redirectUrl);
  });

  app.get('/auth/github/callback', async (request, reply) => {
    const query = CALLBACK_QUERY.safeParse(request.query);
    const expectedState = request.cookies[cookies.state];

    reply.clearCookie(cookies.state, cookieOptions);

    try {
      // The state cookie ties the callback to the browser that started the sign-in.
      if (!query.success || expectedState === undefined || !sameSecret(query.data.state, expectedState)) {
        throw new DomainError('sign_in_failed', 'The sign-in could not be verified; start it again.');
      }

      const result = await completeSignIn(dependencies, { code: query.data.code, request: requestContextOf(request) });

      reply.setCookie(cookies.session, result.sessionToken, { ...cookieOptions, expires: result.expiresAt });
      // The dashboard sends people without an administrative role on to the download page itself.
      return await reply.redirect(result.startPage === 'apps' ? '/apps.html' : '/');
    } catch (error) {
      const code = toHttpError(error)?.body.error.code;

      if (code === undefined) {
        throw error;
      }

      return reply.redirect(`/login.html?error=${encodeURIComponent(code)}`);
    }
  });

  app.get('/api/session', (request) =>
    presentCurrentUser(getCurrentUser(dependencies, requireSession(request).actor, requestContextOf(request))),
  );

  app.post('/api/session/sign-out', async (request, reply) => {
    signOut(dependencies, requireSession(request), requestContextOf(request));
    reply.clearCookie(cookies.session, cookieOptions);
    return reply.status(204).send();
  });
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
