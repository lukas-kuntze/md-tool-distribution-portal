import type { Database } from 'better-sqlite3';

import type { ReleaseSelection, ShareLink, ShareScope } from '../../domain/entities/share-link.js';
import type { ShareLinkRepository } from '../../domain/ports/share-link-repository.js';
import type { ApplicationId, ProjectId, ShareLinkId, UserId } from '../../domain/value-objects/identifier.js';
import { fromDbTime, toDbTime } from './sqlite-values.js';

interface ShareLinkRow {
  readonly id: string;
  readonly scope_type: 'project' | 'application';
  readonly project_id: string | null;
  readonly application_id: string | null;
  readonly label: string;
  readonly release_selection: ReleaseSelection;
  readonly created_at: string;
  readonly created_by: string;
  readonly expires_at: string | null;
  readonly revoked_at: string | null;
  readonly revoked_by: string | null;
}

const COLUMNS =
  'id, scope_type, project_id, application_id, label, release_selection, created_at, created_by, expires_at, revoked_at, revoked_by';

export class SqliteShareLinkRepository implements ShareLinkRepository {
  public constructor(private readonly database: Database) {}

  public insert(link: ShareLink, tokenHash: string): void {
    this.database
      .prepare(
        `INSERT INTO share_links (${COLUMNS}, token_hash)
         VALUES (@id, @scopeType, @projectId, @applicationId, @label, @releases, @createdAt, @createdBy, @expiresAt, NULL, NULL, @tokenHash)`,
      )
      .run({
        id: link.id,
        scopeType: link.scope.type,
        projectId: link.scope.type === 'project' ? link.scope.projectId : null,
        applicationId: link.scope.type === 'application' ? link.scope.applicationId : null,
        label: link.label,
        releases: link.releases,
        createdAt: toDbTime(link.createdAt),
        createdBy: link.createdBy,
        expiresAt: toDbTime(link.expiresAt),
        tokenHash,
      });
  }

  public update(link: ShareLink): void {
    this.database
      .prepare('UPDATE share_links SET revoked_at = ?, revoked_by = ? WHERE id = ?')
      .run(toDbTime(link.revokedAt), link.revokedBy, link.id);
  }

  public findById(id: ShareLinkId): ShareLink | null {
    return this.one(`SELECT ${COLUMNS} FROM share_links WHERE id = ?`, id);
  }

  public findByTokenHash(tokenHash: string): ShareLink | null {
    return this.one(`SELECT ${COLUMNS} FROM share_links WHERE token_hash = ?`, tokenHash);
  }

  public listByProject(projectId: ProjectId): readonly ShareLink[] {
    return this.database
      .prepare<[string, string], ShareLinkRow>(
        `SELECT ${COLUMNS} FROM share_links
         WHERE project_id = ? OR application_id IN (SELECT id FROM applications WHERE project_id = ?)
         ORDER BY created_at DESC, id DESC`,
      )
      .all(projectId, projectId)
      .map(toShareLink);
  }

  public listByApplication(applicationId: ApplicationId): readonly ShareLink[] {
    return this.database
      .prepare<[string], ShareLinkRow>(
        `SELECT ${COLUMNS} FROM share_links WHERE application_id = ? ORDER BY created_at DESC, id DESC`,
      )
      .all(applicationId)
      .map(toShareLink);
  }

  private one(sql: string, value: string): ShareLink | null {
    const row = this.database.prepare<[string], ShareLinkRow>(sql).get(value);
    return row === undefined ? null : toShareLink(row);
  }
}

function toShareLink(row: ShareLinkRow): ShareLink {
  const scope: ShareScope =
    row.scope_type === 'project'
      ? { type: 'project', projectId: row.project_id as ProjectId }
      : { type: 'application', applicationId: row.application_id as ApplicationId };

  return {
    id: row.id as ShareLinkId,
    scope,
    label: row.label,
    releases: row.release_selection,
    createdAt: fromDbTime(row.created_at),
    createdBy: row.created_by as UserId,
    expiresAt: fromDbTime(row.expires_at),
    revokedAt: fromDbTime(row.revoked_at),
    revokedBy: row.revoked_by as UserId | null,
  };
}
