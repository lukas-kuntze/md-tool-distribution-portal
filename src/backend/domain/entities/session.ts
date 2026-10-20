import type { SessionId, UserId } from '../value-objects/identifier.js';

export interface SessionPolicy {
  /** Maximum lifetime regardless of activity. */
  readonly absoluteMs: number;
  /** A session ends after this long without a request. */
  readonly idleMs: number;
}

/** A signed-in browser. The cookie only carries a random token; the platform stores nothing but its hash. */
export interface Session {
  readonly id: SessionId;
  readonly userId: UserId;
  /** GitHub login at sign-in, used as label in audit entries. */
  readonly login: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
  readonly revokedAt: Date | null;
}

export function createSession(id: SessionId, userId: UserId, login: string, now: Date, policy: SessionPolicy): Session {
  return {
    id,
    userId,
    login,
    createdAt: now,
    expiresAt: new Date(now.getTime() + policy.absoluteMs),
    lastSeenAt: now,
    revokedAt: null,
  };
}

export function isSessionActive(session: Session, now: Date, policy: SessionPolicy): boolean {
  const time = now.getTime();

  return (
    session.revokedAt === null &&
    time < session.expiresAt.getTime() &&
    time - session.lastSeenAt.getTime() < policy.idleMs
  );
}

/** Recording every request would turn reads into writes; activity is stored at most once a minute. */
export function needsActivityUpdate(session: Session, now: Date): boolean {
  return now.getTime() - session.lastSeenAt.getTime() >= 60_000;
}
