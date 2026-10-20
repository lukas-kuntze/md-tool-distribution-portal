import type { ApplicationId, ProjectId, UserId } from '../value-objects/identifier.js';

export type AuditActor =
  | { readonly type: 'user'; readonly userId: UserId; readonly label: string }
  | { readonly type: 'ci'; readonly label: string }
  | { readonly type: 'system'; readonly label: string }
  /** Someone without an account, using a share link; the label names the link's recipient. */
  | { readonly type: 'share'; readonly label: string };

/** One append-only entry. Personal data belongs here and nowhere else, never in diagnostic logs. */
export interface AuditEntry {
  readonly occurredAt: Date;
  readonly actor: AuditActor;
  /** Dotted event name, e.g. `release.delete.requested` or `authz.denied`. */
  readonly action: string;
  readonly target: { readonly type: string; readonly id: string | null };
  readonly projectId: ProjectId | null;
  readonly applicationId: ApplicationId | null;
  readonly outcome: 'success' | 'denied' | 'failed';
  readonly correlationId: string | null;
  readonly clientIp: string | null;
  readonly userAgent: string | null;
  /** Snapshot of the affected data, e.g. values before and after a change. */
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AuditRecord extends AuditEntry {
  readonly id: number;
}

export interface AuditQuery {
  readonly projectId?: ProjectId;
  readonly applicationId?: ApplicationId;
  readonly actorUserId?: UserId;
  /** Matches the beginning of the action, e.g. `release.delete`. */
  readonly actionPrefix?: string;
  readonly outcome?: AuditEntry['outcome'];
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

export interface AuditLog {
  append(entry: AuditEntry): void;
  /** Newest first. */
  list(query: AuditQuery): readonly AuditRecord[];
  /** Number of entries matching the query, regardless of paging. */
  count(query: Omit<AuditQuery, 'limit' | 'offset'>): number;
}
