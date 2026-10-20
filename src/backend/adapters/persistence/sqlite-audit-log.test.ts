import { describe, expect, it } from 'vitest';

import type { AuditEntry } from '../../domain/ports/audit-log.js';
import { createTestDatabase, NOW } from './testing/sqlite-fixtures.js';

const entry: Omit<AuditEntry, 'actor'> = {
  occurredAt: NOW,
  action: 'release.delete.requested',
  target: { type: 'release', id: 'r-1' },
  projectId: null,
  applicationId: null,
  outcome: 'success',
  correlationId: 'c-1',
  clientIp: '10.0.0.1',
  userAgent: 'test',
  details: { reason: 'Absturz beim Start' },
};

describe('SqliteAuditLog', (): void => {
  it('appends entries of users and workflows with their details', (): void => {
    const test = createTestDatabase();

    test.unitOfWork.transaction(({ auditLog }) => {
      auditLog.append({ ...entry, actor: { type: 'user', userId: test.userId, label: 'octocat' } });
      auditLog.append({ ...entry, actor: { type: 'ci', label: 'md/k-mobile run 4711' }, outcome: 'denied' });
    });

    expect(
      test.database
        .prepare('SELECT actor_type, actor_user_id, actor_label, outcome, details FROM audit_logs ORDER BY id')
        .all(),
    ).toEqual([
      {
        actor_type: 'user',
        actor_user_id: test.userId,
        actor_label: 'octocat',
        outcome: 'success',
        details: '{"reason":"Absturz beim Start"}',
      },
      {
        actor_type: 'ci',
        actor_user_id: null,
        actor_label: 'md/k-mobile run 4711',
        outcome: 'denied',
        details: '{"reason":"Absturz beim Start"}',
      },
    ]);
  });
});
