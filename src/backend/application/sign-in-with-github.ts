import { PLATFORM_ADMIN_ROLE_KEY } from '../domain/entities/role-assignment.js';
import { createSession, type SessionPolicy } from '../domain/entities/session.js';
import type { UserPreferences } from '../domain/entities/user-preferences.js';
import type { User } from '../domain/entities/user.js';
import type { Clock } from '../domain/ports/clock.js';
import type { IdGenerator } from '../domain/ports/id-generator.js';
import type { ExternalProfile, IdentityProvider } from '../domain/ports/identity-provider.js';
import type { TokenGenerator } from '../domain/ports/token-generator.js';
import type { Repositories, UnitOfWork } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { UserId } from '../domain/value-objects/identifier.js';
import { systemAuditEntry } from './authorization.js';
import type { RequestContext } from './request-context.js';

export interface SignInDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly identityProvider: IdentityProvider;
  readonly tokens: TokenGenerator;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly sessionPolicy: SessionPolicy;
  /** GitHub user ids (not logins) that always hold the platform administrator role. */
  readonly bootstrapAdminGitHubIds: ReadonlySet<string>;
}

/** Starts the OAuth flow. The state goes into a short-lived cookie and must come back unchanged. */
export function startSignIn(dependencies: Pick<SignInDependencies, 'identityProvider' | 'tokens'>): {
  readonly state: string;
  readonly redirectUrl: string;
} {
  const { token: state } = dependencies.tokens.issue();
  return { state, redirectUrl: dependencies.identityProvider.authorizationUrl(state) };
}

export interface SignInResult {
  readonly sessionToken: string;
  readonly expiresAt: Date;
  readonly userId: UserId;
  /** Where the person wants to start after signing in. */
  readonly startPage: UserPreferences['startPage'];
}

/**
 * Completes the OAuth flow. Membership of the organisation only allows signing in; permissions come
 * exclusively from role assignments, which are bound to the stable GitHub user id.
 */
export async function completeSignIn(
  dependencies: SignInDependencies,
  input: { readonly code: string; readonly request: RequestContext },
): Promise<SignInResult> {
  const { unitOfWork, identityProvider, tokens, ids, clock, sessionPolicy } = dependencies;
  const { profile, isOrganizationMember } = await identityProvider.completeSignIn(input.code);
  const now = clock.now();

  if (!isOrganizationMember) {
    recordRefusal(unitOfWork, profile, input.request, now, 'not_organization_member');
    throw new DomainError('not_organization_member', 'Only members of the organisation can sign in.');
  }

  const result = unitOfWork.transaction((repositories) => {
    const user = upsertUser(repositories, ids, profile, now);

    if (user.status !== 'active') {
      return null;
    }

    if (dependencies.bootstrapAdminGitHubIds.has(profile.subject)) {
      ensureBootstrapAdministrator(repositories, ids, user.id, now);
    }

    const issued = tokens.issue();
    const session = createSession(ids.next(), user.id, profile.login, now, sessionPolicy);

    repositories.users.recordLogin(user.id, now);
    repositories.sessions.insert(session, issued.hash, {
      ip: input.request.clientIp,
      userAgent: input.request.userAgent,
    });
    repositories.auditLog.append({
      ...systemAuditEntry('sign-in', now, {
        action: 'auth.sign_in',
        target: { type: 'user', id: user.id },
        projectId: null,
        applicationId: null,
        outcome: 'success',
        details: { gitHubId: profile.subject, login: profile.login },
      }),
      actor: { type: 'user', userId: user.id, label: profile.login },
      correlationId: input.request.correlationId,
      clientIp: input.request.clientIp,
      userAgent: input.request.userAgent,
    });

    return {
      sessionToken: issued.token,
      expiresAt: session.expiresAt,
      userId: user.id,
      startPage: repositories.users.findPreferences(user.id).startPage,
    };
  });

  if (result === null) {
    recordRefusal(unitOfWork, profile, input.request, now, 'user_disabled');
    throw new DomainError('user_disabled', 'This account has been disabled.');
  }

  return result;
}

function upsertUser(repositories: Repositories, ids: IdGenerator, profile: ExternalProfile, now: Date): User {
  const existing = repositories.users.findByGitHubId(profile.providerHost, profile.subject);
  const user: User = {
    id: existing?.id ?? ids.next(),
    displayName: profile.displayName,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
    status: existing?.status ?? 'active',
  };

  if (existing === null) {
    repositories.users.insert(user, now);
  } else {
    repositories.users.update(user);
  }

  // Keeps the login current: it may have been renamed on GitHub since the last sign-in.
  repositories.users.linkGitHubIdentity(user.id, profile, ids.next(), now);
  return user;
}

function ensureBootstrapAdministrator(repositories: Repositories, ids: IdGenerator, userId: UserId, now: Date): void {
  const role = repositories.access.findRoleByKey(PLATFORM_ADMIN_ROLE_KEY);
  const alreadyAdmin = repositories.access
    .grantsForUser(userId)
    .some(
      (grant) =>
        grant.roleKey === PLATFORM_ADMIN_ROLE_KEY && grant.scope.type === 'global' && grant.principal.type === 'user',
    );

  if (role === null || alreadyAdmin) {
    return;
  }

  repositories.access.insertAssignment(
    {
      id: ids.next(),
      roleId: role.id,
      principal: { type: 'user', userId },
      scope: { type: 'global' },
      reason: 'Bootstrap administrator from the server configuration',
      expiresAt: null,
      source: 'configuration',
    },
    { actor: null, at: now },
  );
}

function recordRefusal(
  unitOfWork: UnitOfWork,
  profile: ExternalProfile,
  request: RequestContext,
  now: Date,
  reason: string,
): void {
  unitOfWork.transaction(({ auditLog }) =>
    auditLog.append({
      ...systemAuditEntry('sign-in', now, {
        action: 'auth.sign_in',
        target: { type: 'github-user', id: profile.subject },
        projectId: null,
        applicationId: null,
        outcome: 'denied',
        details: { reason, login: profile.login },
      }),
      correlationId: request.correlationId,
      clientIp: request.clientIp,
      userAgent: request.userAgent,
    }),
  );
}
