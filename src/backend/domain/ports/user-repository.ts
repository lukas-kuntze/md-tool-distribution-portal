import type { UserPreferences } from '../entities/user-preferences.js';
import type { User } from '../entities/user.js';
import type { UserId } from '../value-objects/identifier.js';
import type { ExternalProfile } from './identity-provider.js';

export interface UserSummary {
  readonly user: User;
  /** Current GitHub login, if the user ever signed in. */
  readonly login: string | null;
  readonly gitHubId: string | null;
  readonly lastLoginAt: Date | null;
}

export interface UserListFilter {
  /** Matches login or display name; empty matches everybody. */
  readonly query: string;
  readonly status: User['status'] | null;
  readonly limit: number;
  readonly offset: number;
}

export interface UserRepository {
  insert(user: User, now: Date): void;
  update(user: User): void;
  findById(id: UserId): User | null;
  /** Looks a person up by the stable GitHub user id, never by login. */
  findByGitHubId(providerHost: string, subject: string): User | null;
  /** Creates or refreshes the GitHub identity of a user, including the current login. */
  linkGitHubIdentity(userId: UserId, profile: ExternalProfile, identityId: string, at: Date): void;
  recordLogin(userId: UserId, at: Date): void;
  /** Matches login or display name; for assigning roles in the administration. */
  search(query: string, limit: number): readonly UserSummary[];
  findSummary(id: UserId): UserSummary | null;
  /** Everybody known to the platform, active ones first, then by name; with the number of all matches. */
  list(filter: UserListFilter): { readonly entries: readonly UserSummary[]; readonly total: number };
  findPreferences(id: UserId): UserPreferences;
  savePreferences(id: UserId, preferences: UserPreferences): void;
}
