import type { UserPreferences } from '../domain/entities/user-preferences.js';
import type { UserSummary } from '../domain/ports/user-repository.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import { isPrivileged } from '../domain/value-objects/permission.js';
import { authorizedRead } from './authorization.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';
import { globalCapabilities, type GlobalCapabilities } from './visibility.js';

export interface CurrentUser {
  readonly summary: UserSummary;
  readonly capabilities: GlobalCapabilities;
  readonly preferences: UserPreferences;
}

export function getCurrentUser(
  dependencies: Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>,
  actor: Actor,
  request: RequestContext,
): CurrentUser {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, { permissions }) => {
    const summary = repositories.users.findSummary(actor.userId);

    if (summary === null) {
      throw new DomainError('user_not_found', 'The user does not exist.');
    }

    const grants = repositories.access.grantsForUser(actor.userId);
    const managesAny = grants.some((grant) => grant.permissions.has('permissions.manage'));
    const administers = grants.some((grant) => isPrivileged(grant.permissions));

    return {
      summary,
      capabilities: globalCapabilities(permissions, managesAny, administers),
      preferences: repositories.users.findPreferences(actor.userId),
    };
  });
}
