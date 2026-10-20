import { DomainError } from '../value-objects/domain-error.js';
import type { UserId } from '../value-objects/identifier.js';

/** A person known to the platform. Users are disabled, never deleted, so that audit entries keep their author. */
export interface User {
  readonly id: UserId;
  readonly displayName: string;
  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly status: 'active' | 'disabled';
}

/** Ends access at once: the user can no longer sign in and loses every session; roles and history stay. */
export function disableUser(user: User): User {
  if (user.status === 'disabled') {
    throw new DomainError('invalid_user_state', 'The user is already disabled.');
  }

  return { ...user, status: 'disabled' };
}

export function enableUser(user: User): User {
  if (user.status === 'active') {
    throw new DomainError('invalid_user_state', 'The user is already active.');
  }

  return { ...user, status: 'active' };
}
