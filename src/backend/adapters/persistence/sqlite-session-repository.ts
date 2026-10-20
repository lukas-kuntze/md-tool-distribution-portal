import type { Database } from 'better-sqlite3';

import type { Session } from '../../domain/entities/session.js';
import type { OpenSession, SessionRepository } from '../../domain/ports/session-repository.js';
import type { SessionId, UserId } from '../../domain/value-objects/identifier.js';
import { fromDbTime, toDbTime } from './sqlite-values.js';

interface SessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly login: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly last_seen_at: string;
  readonly revoked_at: string | null;
}

export class SqliteSessionRepository implements SessionRepository {
  public constructor(private readonly database: Database) {}

  public insert(
    session: Session,
    tokenHash: string,
    client: { readonly ip: string | null; readonly userAgent: string | null },
  ): void {
    this.database
      .prepare(
        `INSERT INTO sessions (id, token_hash, user_id, login, created_at, expires_at, last_seen_at, client_ip, user_agent)
         VALUES (@id, @tokenHash, @userId, @login, @createdAt, @expiresAt, @lastSeenAt, @ip, @userAgent)`,
      )
      .run({
        id: session.id,
        tokenHash,
        userId: session.userId,
        login: session.login,
        createdAt: toDbTime(session.createdAt),
        expiresAt: toDbTime(session.expiresAt),
        lastSeenAt: toDbTime(session.lastSeenAt),
        ip: client.ip,
        userAgent: client.userAgent,
      });
  }

  public findByTokenHash(tokenHash: string): Session | null {
    const row = this.database
      .prepare<[string], SessionRow>('SELECT * FROM sessions WHERE token_hash = ?')
      .get(tokenHash);

    return row === undefined ? null : sessionOf(row);
  }

  public listOpenOfUser(userId: UserId, now: Date): readonly OpenSession[] {
    return this.database
      .prepare<[string, string], SessionRow & { user_agent: string | null }>(
        `SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC`,
      )
      .all(userId, toDbTime(now))
      .map((row) => ({ session: sessionOf(row), userAgent: row.user_agent }));
  }

  public recordActivity(id: SessionId, at: Date): void {
    this.database.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(toDbTime(at), id);
  }

  public revoke(id: SessionId, at: Date): void {
    this.database
      .prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(toDbTime(at), id);
  }

  public revokeAllOfUser(userId: UserId, at: Date): void {
    this.database
      .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(toDbTime(at), userId);
  }
}

function sessionOf(row: SessionRow): Session {
  return {
    id: row.id as SessionId,
    userId: row.user_id as UserId,
    login: row.login,
    createdAt: fromDbTime(row.created_at),
    expiresAt: fromDbTime(row.expires_at),
    lastSeenAt: fromDbTime(row.last_seen_at),
    revokedAt: fromDbTime(row.revoked_at),
  };
}
