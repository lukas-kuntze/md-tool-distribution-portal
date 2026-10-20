import type { AuditQuery, AuditRecord } from '../domain/ports/audit-log.js';
import { authorizedRead } from './authorization.js';
import { resolveTarget, type ScopeInput } from './manage-access.js';
import type { Paged } from './manage-releases.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';

export type AuditFilter = Omit<AuditQuery, 'projectId' | 'applicationId'>;

/** Audit entries of a scope; `audit.read` at a project covers the entries of its applications. */
export function listAuditEntries(
  dependencies: Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>,
  actor: Actor,
  request: RequestContext,
  input: { readonly scope: ScopeInput; readonly filter: AuditFilter },
): Paged<AuditRecord> {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, guard) => {
    const target = resolveTarget(repositories, input.scope);
    guard.require('audit.read', target, { type: 'audit_log', id: null });

    const query = {
      ...input.filter,
      ...(target.type === 'global' ? {} : { projectId: target.projectId }),
      ...(target.type === 'application' ? { applicationId: target.applicationId } : {}),
    };

    return { entries: repositories.auditLog.list(query), total: repositories.auditLog.count(query) };
  });
}
