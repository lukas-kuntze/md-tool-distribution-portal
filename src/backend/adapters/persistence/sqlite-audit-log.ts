import type { Database } from 'better-sqlite3';

import type { AuditActor, AuditEntry, AuditLog, AuditQuery, AuditRecord } from '../../domain/ports/audit-log.js';
import type { ApplicationId, ProjectId, UserId } from '../../domain/value-objects/identifier.js';
import { escapeLike, fromDbTime, toDbTime } from './sqlite-values.js';

interface AuditRow {
  readonly id: number;
  readonly occurred_at: string;
  readonly actor_type: AuditActor['type'];
  readonly actor_user_id: string | null;
  readonly actor_label: string;
  readonly action: string;
  readonly target_type: string;
  readonly target_id: string | null;
  readonly project_id: string | null;
  readonly application_id: string | null;
  readonly outcome: AuditEntry['outcome'];
  readonly correlation_id: string | null;
  readonly client_ip: string | null;
  readonly user_agent: string | null;
  readonly details: string;
}

export class SqliteAuditLog implements AuditLog {
  public constructor(private readonly database: Database) {}

  public append(entry: AuditEntry): void {
    this.database
      .prepare(
        `INSERT INTO audit_logs (
           occurred_at, actor_type, actor_user_id, actor_label, action, target_type, target_id, project_id,
           application_id, outcome, correlation_id, client_ip, user_agent, details)
         VALUES (
           @occurredAt, @actorType, @actorUserId, @actorLabel, @action, @targetType, @targetId, @projectId,
           @applicationId, @outcome, @correlationId, @clientIp, @userAgent, @details)`,
      )
      .run({
        occurredAt: toDbTime(entry.occurredAt),
        actorType: entry.actor.type,
        actorUserId: entry.actor.type === 'user' ? entry.actor.userId : null,
        actorLabel: entry.actor.label,
        action: entry.action,
        targetType: entry.target.type,
        targetId: entry.target.id,
        projectId: entry.projectId,
        applicationId: entry.applicationId,
        outcome: entry.outcome,
        correlationId: entry.correlationId,
        clientIp: entry.clientIp,
        userAgent: entry.userAgent,
        details: JSON.stringify(entry.details),
      });
  }

  public list(query: AuditQuery): readonly AuditRecord[] {
    return this.database
      .prepare<Record<string, unknown>, AuditRow>(
        `SELECT * FROM audit_logs ${AUDIT_FILTER} ORDER BY id DESC LIMIT @limit OFFSET @offset`,
      )
      .all({ ...filterParameters(query), limit: query.limit, offset: query.offset })
      .map(toRecord);
  }

  public count(query: Omit<AuditQuery, 'limit' | 'offset'>): number {
    return (
      this.database
        .prepare<Record<string, unknown>, { total: number }>(`SELECT count(*) AS total FROM audit_logs ${AUDIT_FILTER}`)
        .get(filterParameters(query))?.total ?? 0
    );
  }
}

const AUDIT_FILTER = `WHERE (@projectId IS NULL OR project_id = @projectId)
           AND (@applicationId IS NULL OR application_id = @applicationId)
           AND (@actorUserId IS NULL OR actor_user_id = @actorUserId)
           AND (@actionPrefix IS NULL OR action LIKE @actionPrefix ESCAPE '\\')
           AND (@outcome IS NULL OR outcome = @outcome)
           AND (@from IS NULL OR occurred_at >= @from)
           AND (@to IS NULL OR occurred_at < @to)`;

function filterParameters(query: Omit<AuditQuery, 'limit' | 'offset'>): Record<string, unknown> {
  return {
    projectId: query.projectId ?? null,
    applicationId: query.applicationId ?? null,
    actorUserId: query.actorUserId ?? null,
    actionPrefix: query.actionPrefix === undefined ? null : `${escapeLike(query.actionPrefix)}%`,
    outcome: query.outcome ?? null,
    from: query.from === undefined ? null : toDbTime(query.from),
    to: query.to === undefined ? null : toDbTime(query.to),
  };
}

function toRecord(row: AuditRow): AuditRecord {
  const actor: AuditActor =
    row.actor_type === 'user'
      ? { type: 'user', userId: row.actor_user_id as UserId, label: row.actor_label }
      : { type: row.actor_type, label: row.actor_label };

  return {
    id: row.id,
    occurredAt: fromDbTime(row.occurred_at),
    actor,
    action: row.action,
    target: { type: row.target_type, id: row.target_id },
    projectId: row.project_id as ProjectId | null,
    applicationId: row.application_id as ApplicationId | null,
    outcome: row.outcome,
    correlationId: row.correlation_id,
    clientIp: row.client_ip,
    userAgent: row.user_agent,
    details: JSON.parse(row.details) as Readonly<Record<string, unknown>>,
  };
}
