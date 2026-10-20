import { isSessionActive, needsActivityUpdate, type SessionPolicy } from '../domain/entities/session.js';
import type { Clock } from '../domain/ports/clock.js';
import type { TokenGenerator } from '../domain/ports/token-generator.js';
import type { UnitOfWork } from '../domain/ports/unit-of-work.js';
import type { SessionId } from '../domain/value-objects/identifier.js';
import { userAuditEntry } from './authorization.js';
import type { Actor, RequestContext } from './request-context.js';

export interface SessionDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly tokens: TokenGenerator;
  readonly clock: Clock;
  readonly sessionPolicy: SessionPolicy;
}

export interface ResolvedSession {
  readonly sessionId: SessionId;
  readonly actor: Actor;
}

/** Turns a session cookie into the acting user, or `null` if the session is unknown, expired or the user disabled. */
export function resolveSession(dependencies: SessionDependencies, token: string): ResolvedSession | null {
  const { unitOfWork, tokens, clock, sessionPolicy } = dependencies;
  const now = clock.now();

  const found = unitOfWork.read(({ sessions, users }) => {
    const session = sessions.findByTokenHash(tokens.hash(token));
    return session === null ? null : { session, userActive: users.findById(session.userId)?.status === 'active' };
  });

  if (found === null || !isSessionActive(found.session, now, sessionPolicy)) {
    return null;
  }

  const { session, userActive } = found;

  // Writes are rare on purpose: a disabled user loses the session, otherwise activity is recorded once a minute.
  if (!userActive) {
    unitOfWork.transaction(({ sessions }) => sessions.revoke(session.id, now));
    return null;
  }

  if (needsActivityUpdate(session, now)) {
    unitOfWork.transaction(({ sessions }) => sessions.recordActivity(session.id, now));
  }

  return { sessionId: session.id, actor: { userId: session.userId, label: session.login } };
}

export function signOut(
  dependencies: Pick<SessionDependencies, 'unitOfWork' | 'clock'>,
  session: ResolvedSession,
  request: RequestContext,
): void {
  const now = dependencies.clock.now();

  dependencies.unitOfWork.transaction(({ sessions, auditLog }) => {
    sessions.revoke(session.sessionId, now);
    auditLog.append(
      userAuditEntry(session.actor, request, now, {
        action: 'auth.sign_out',
        target: { type: 'user', id: session.actor.userId },
        projectId: null,
        applicationId: null,
        outcome: 'success',
        details: {},
      }),
    );
  });
}
