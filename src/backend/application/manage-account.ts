import { isSessionActive, type Session, type SessionPolicy } from '../domain/entities/session.js';
import type { UserPreferences } from '../domain/entities/user-preferences.js';
import type { UserSummary } from '../domain/ports/user-repository.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { SessionId } from '../domain/value-objects/identifier.js';
import type { Permission } from '../domain/value-objects/permission.js';
import { auditChange, authorizedRead, authorizedTransaction, GLOBAL_TARGET } from './authorization.js';
import type { ResolvedSession } from './manage-session.js';
import { rolesOf, type HeldRole } from './manage-users.js';
import type { RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';

export interface AccountDependencies extends Pick<UseCaseDependencies, 'unitOfWork' | 'clock'> {
  readonly sessionPolicy: SessionPolicy;
}

export interface AccountSession {
  readonly session: Session;
  readonly userAgent: string | null;
  /** The browser this request comes from. */
  readonly current: boolean;
}

/** What the "Mein Konto" page shows; every signed-in person sees their own account, nobody else's. */
export interface Account {
  readonly summary: UserSummary;
  readonly preferences: UserPreferences;
  readonly roles: readonly (HeldRole & { readonly permissions: readonly Permission[] })[];
  readonly sessions: readonly AccountSession[];
}

const SUBJECT = { type: 'session', id: null } as const;

export function getAccount(
  dependencies: AccountDependencies,
  session: ResolvedSession,
  request: RequestContext,
): Account {
  const context = contextOf(dependencies, session.actor, request);

  return authorizedRead(context, (repositories) => {
    const { userId } = session.actor;
    const summary = repositories.users.findSummary(userId);

    if (summary === null) {
      throw new DomainError('user_not_found', 'The user does not exist.');
    }

    const roles = new Map(repositories.access.listRoles().map((role) => [role.key, role]));

    return {
      summary,
      preferences: repositories.users.findPreferences(userId),
      roles: rolesOf(repositories, userId, context.now).map((held) => ({
        ...held,
        permissions: [...(roles.get(held.roleKey)?.permissions ?? [])],
      })),
      // Idle sessions are over even if nobody revoked them yet; they are not listed.
      sessions: repositories.sessions
        .listOpenOfUser(userId, context.now)
        .filter((open) => isSessionActive(open.session, context.now, dependencies.sessionPolicy))
        .map((open) => ({ ...open, current: open.session.id === session.sessionId })),
    };
  });
}

export function updatePreferences(
  dependencies: Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>,
  session: ResolvedSession,
  request: RequestContext,
  changes: Partial<UserPreferences>,
): UserPreferences {
  return authorizedTransaction(contextOf(dependencies, session.actor, request), (repositories) => {
    const preferences = { ...repositories.users.findPreferences(session.actor.userId), ...changes };
    repositories.users.savePreferences(session.actor.userId, preferences);
    return preferences;
  });
}

/** Ends one of the person's own sessions, e.g. on a lost device. Sessions of others are reported as missing. */
export function endSession(
  dependencies: Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>,
  session: ResolvedSession,
  request: RequestContext,
  sessionId: SessionId,
): void {
  const context = contextOf(dependencies, session.actor, request);

  authorizedTransaction(context, (repositories) => {
    const own = repositories.sessions
      .listOpenOfUser(session.actor.userId, context.now)
      .some((open) => open.session.id === sessionId);

    if (!own) {
      throw new DomainError('session_not_found', 'The session does not exist or has ended.');
    }

    repositories.sessions.revoke(sessionId, context.now);
    repositories.auditLog.append(
      auditChange(context, 'session.revoked', GLOBAL_TARGET, { type: 'session', id: sessionId }, {}),
    );
  });
}

/** "Überall abmelden": ends every session of the person, the current one included. */
export function endAllSessions(
  dependencies: Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>,
  session: ResolvedSession,
  request: RequestContext,
): void {
  const context = contextOf(dependencies, session.actor, request);

  authorizedTransaction(context, (repositories) => {
    repositories.sessions.revokeAllOfUser(session.actor.userId, context.now);
    repositories.auditLog.append(auditChange(context, 'session.revoked_all', GLOBAL_TARGET, SUBJECT, {}));
  });
}
