import type { Session } from '../entities/session.js';
import type { SessionId, UserId } from '../value-objects/identifier.js';

/** A session together with the browser it was opened in, for the account page. */
export interface OpenSession {
  readonly session: Session;
  readonly userAgent: string | null;
}

export interface SessionRepository {
  insert(
    session: Session,
    tokenHash: string,
    client: { readonly ip: string | null; readonly userAgent: string | null },
  ): void;
  findByTokenHash(tokenHash: string): Session | null;
  recordActivity(id: SessionId, at: Date): void;
  revoke(id: SessionId, at: Date): void;
  /** Ends every session of a user, e.g. after the account was disabled. */
  revokeAllOfUser(userId: UserId, at: Date): void;
  /** Sessions of a user that are neither revoked nor past their absolute expiry, most recently used first. */
  listOpenOfUser(userId: UserId, now: Date): readonly OpenSession[];
}
