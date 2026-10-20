import type { Database } from 'better-sqlite3';

import { DEFAULT_PREFERENCES, type UserPreferences } from '../../domain/entities/user-preferences.js';
import type { User } from '../../domain/entities/user.js';
import type { ExternalProfile } from '../../domain/ports/identity-provider.js';
import type { UserListFilter, UserRepository, UserSummary } from '../../domain/ports/user-repository.js';
import type { UserId } from '../../domain/value-objects/identifier.js';
import { escapeLike, fromDbTime, toDbTime } from './sqlite-values.js';

interface UserRow {
  readonly id: string;
  readonly display_name: string;
  readonly email: string | null;
  readonly avatar_url: string | null;
  readonly status: User['status'];
}

interface SummaryRow extends UserRow {
  readonly login: string | null;
  readonly subject: string | null;
  readonly last_login_at: string | null;
}

const PROVIDER = 'github';

const SUMMARY_SELECT = `
  SELECT u.*, i.login, i.subject
  FROM users u
  LEFT JOIN external_identities i ON i.user_id = u.id AND i.provider = '${PROVIDER}'`;

export class SqliteUserRepository implements UserRepository {
  public constructor(private readonly database: Database) {}

  public insert(user: User, now: Date): void {
    this.database
      .prepare(
        `INSERT INTO users (id, display_name, email, avatar_url, status, created_at)
         VALUES (@id, @displayName, @email, @avatarUrl, @status, @now)`,
      )
      .run({ ...user, now: toDbTime(now) });
  }

  public update(user: User): void {
    this.database
      .prepare(
        `UPDATE users SET display_name = @displayName, email = @email, avatar_url = @avatarUrl, status = @status
         WHERE id = @id`,
      )
      .run(user);
  }

  public findById(id: UserId): User | null {
    const row = this.database.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?').get(id);
    return row === undefined ? null : toUser(row);
  }

  public findByGitHubId(providerHost: string, subject: string): User | null {
    const row = this.database
      .prepare<[string, string, string], UserRow>(
        `SELECT u.* FROM users u
         JOIN external_identities i ON i.user_id = u.id
         WHERE i.provider = ? AND i.provider_host = ? AND i.subject = ?`,
      )
      .get(PROVIDER, providerHost, subject);

    return row === undefined ? null : toUser(row);
  }

  public linkGitHubIdentity(userId: UserId, profile: ExternalProfile, identityId: string, at: Date): void {
    this.database
      .prepare(
        `INSERT INTO external_identities (id, user_id, provider, provider_host, subject, node_id, login, last_synced_at)
         VALUES (@identityId, @userId, '${PROVIDER}', @providerHost, @subject, @nodeId, @login, @at)
         ON CONFLICT (provider, provider_host, subject)
         DO UPDATE SET node_id = excluded.node_id, login = excluded.login, last_synced_at = excluded.last_synced_at`,
      )
      .run({ ...profile, identityId, userId, at: toDbTime(at) });
  }

  public recordLogin(userId: UserId, at: Date): void {
    this.database.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(toDbTime(at), userId);
  }

  public search(query: string, limit: number): readonly UserSummary[] {
    const pattern = `%${escapeLike(query.trim())}%`;

    return this.database
      .prepare<{ pattern: string; limit: number }, SummaryRow>(
        `${SUMMARY_SELECT}
         WHERE i.login LIKE @pattern ESCAPE '\\' OR u.display_name LIKE @pattern ESCAPE '\\'
         ORDER BY u.display_name COLLATE NOCASE
         LIMIT @limit`,
      )
      .all({ pattern, limit })
      .map(toSummary);
  }

  public findSummary(id: UserId): UserSummary | null {
    const row = this.database.prepare<[string], SummaryRow>(`${SUMMARY_SELECT} WHERE u.id = ?`).get(id);
    return row === undefined ? null : toSummary(row);
  }

  public list(filter: UserListFilter): { readonly entries: readonly UserSummary[]; readonly total: number } {
    const where = `WHERE (@pattern = '%%' OR i.login LIKE @pattern ESCAPE '\\' OR u.display_name LIKE @pattern ESCAPE '\\')
         AND (@status IS NULL OR u.status = @status)`;
    const parameters = { pattern: `%${escapeLike(filter.query.trim())}%`, status: filter.status };
    const entries = this.database
      .prepare<typeof parameters & { limit: number; offset: number }, SummaryRow>(
        `${SUMMARY_SELECT}
         ${where}
         ORDER BY u.status = 'disabled', u.display_name COLLATE NOCASE, u.id
         LIMIT @limit OFFSET @offset`,
      )
      .all({ ...parameters, limit: filter.limit, offset: filter.offset })
      .map(toSummary);
    const total = this.database
      .prepare<typeof parameters, { count: number }>(`SELECT count(*) AS count FROM (${SUMMARY_SELECT} ${where})`)
      .get(parameters);

    return { entries, total: total?.count ?? 0 };
  }

  public findPreferences(id: UserId): UserPreferences {
    const row = this.database
      .prepare<[string], { theme: UserPreferences['theme']; start_page: UserPreferences['startPage'] }>(
        'SELECT theme, start_page FROM users WHERE id = ?',
      )
      .get(id);
    return row === undefined ? DEFAULT_PREFERENCES : { theme: row.theme, startPage: row.start_page };
  }

  public savePreferences(id: UserId, preferences: UserPreferences): void {
    this.database
      .prepare('UPDATE users SET theme = ?, start_page = ? WHERE id = ?')
      .run(preferences.theme, preferences.startPage, id);
  }
}

function toUser(row: UserRow): User {
  return {
    id: row.id as UserId,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url,
    status: row.status,
  };
}

function toSummary(row: SummaryRow): UserSummary {
  return { user: toUser(row), login: row.login, gitHubId: row.subject, lastLoginAt: fromDbTime(row.last_login_at) };
}
