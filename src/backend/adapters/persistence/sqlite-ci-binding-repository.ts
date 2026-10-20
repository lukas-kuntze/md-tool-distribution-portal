import type { Database } from 'better-sqlite3';

import type { CiBinding } from '../../domain/entities/ci-binding.js';
import type { CiBindingRepository } from '../../domain/ports/ci-binding-repository.js';
import type { ApplicationId, CiBindingId, UserId } from '../../domain/value-objects/identifier.js';
import { fromDbTime, toDbTime } from './sqlite-values.js';

interface CiBindingRow {
  readonly id: string;
  readonly application_id: string;
  readonly repository_id: number;
  readonly repository_name: string;
  readonly ref_pattern: string;
  readonly environment: string | null;
  readonly created_at: string;
  readonly created_by: string;
  readonly revoked_at: string | null;
  readonly revoked_by: string | null;
}

const COLUMNS =
  'id, application_id, repository_id, repository_name, ref_pattern, environment, created_at, created_by, revoked_at, revoked_by';

export class SqliteCiBindingRepository implements CiBindingRepository {
  public constructor(private readonly database: Database) {}

  public insert(binding: CiBinding): void {
    this.database
      .prepare(
        `INSERT INTO ci_bindings (${COLUMNS})
         VALUES (@id, @applicationId, @repositoryId, @repositoryName, @refPattern, @environment, @createdAt, @createdBy, NULL, NULL)`,
      )
      .run({
        id: binding.id,
        applicationId: binding.applicationId,
        repositoryId: binding.repositoryId,
        repositoryName: binding.repositoryName,
        refPattern: binding.refPattern,
        environment: binding.environment,
        createdAt: toDbTime(binding.createdAt),
        createdBy: binding.createdBy,
      });
  }

  public update(binding: CiBinding): void {
    this.database
      .prepare('UPDATE ci_bindings SET revoked_at = ?, revoked_by = ? WHERE id = ?')
      .run(toDbTime(binding.revokedAt), binding.revokedBy, binding.id);
  }

  public findById(id: CiBindingId): CiBinding | null {
    const row = this.database
      .prepare<[string], CiBindingRow>(`SELECT ${COLUMNS} FROM ci_bindings WHERE id = ?`)
      .get(id);
    return row === undefined ? null : toCiBinding(row);
  }

  public listByApplication(applicationId: ApplicationId): readonly CiBinding[] {
    return this.database
      .prepare<[string], CiBindingRow>(
        `SELECT ${COLUMNS} FROM ci_bindings WHERE application_id = ? ORDER BY created_at DESC, id DESC`,
      )
      .all(applicationId)
      .map(toCiBinding);
  }
}

function toCiBinding(row: CiBindingRow): CiBinding {
  return {
    id: row.id as CiBindingId,
    applicationId: row.application_id as ApplicationId,
    repositoryId: row.repository_id,
    repositoryName: row.repository_name,
    refPattern: row.ref_pattern,
    environment: row.environment,
    createdAt: fromDbTime(row.created_at),
    createdBy: row.created_by as UserId,
    revokedAt: fromDbTime(row.revoked_at),
    revokedBy: row.revoked_by as UserId | null,
  };
}
