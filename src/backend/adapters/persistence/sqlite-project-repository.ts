import type { Database } from 'better-sqlite3';

import type { Asset } from '../../domain/entities/asset.js';
import type { Project } from '../../domain/entities/project.js';
import type { ProjectRepository } from '../../domain/ports/project-repository.js';
import type { ChangeContext, Stored } from '../../domain/ports/stored.js';
import type { DisplayName } from '../../domain/value-objects/display-name.js';
import type { ProjectId, UserId } from '../../domain/value-objects/identifier.js';
import type { Slug } from '../../domain/value-objects/slug.js';
import { findIcon, replaceIcon } from './sqlite-assets.js';
import { assertRowUpdated, fromDbTime, toDbTime, translateConstraints } from './sqlite-values.js';

interface ProjectRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly status: Project['status'];
  readonly archived_at: string | null;
  readonly archived_by: string | null;
  readonly row_version: number;
}

const SLUG_TAKEN = {
  constraint: 'projects.slug',
  code: 'slug_taken',
  message: 'Another project already uses this slug.',
} as const;

export class SqliteProjectRepository implements ProjectRepository {
  public constructor(private readonly database: Database) {}

  public insert(project: Project, context: ChangeContext): void {
    translateConstraints(
      () =>
        this.database
          .prepare(
            `INSERT INTO projects (id, slug, name, description, status, archived_at, archived_by,
                                   created_at, created_by, updated_at, updated_by)
             VALUES (@id, @slug, @name, @description, @status, @archivedAt, @archivedBy, @at, @actor, @at, @actor)`,
          )
          .run({ ...toParameters(project), at: toDbTime(context.at), actor: context.actor }),
      [SLUG_TAKEN],
    );
  }

  public update(project: Project, expectedRowVersion: number, context: ChangeContext): number {
    const result = this.database
      .prepare(
        `UPDATE projects
         SET name = @name, description = @description, status = @status, archived_at = @archivedAt,
             archived_by = @archivedBy, updated_at = @at, updated_by = @actor, row_version = row_version + 1
         WHERE id = @id AND row_version = @expectedRowVersion`,
      )
      .run({ ...toParameters(project), at: toDbTime(context.at), actor: context.actor, expectedRowVersion });

    assertRowUpdated(result.changes);
    return expectedRowVersion + 1;
  }

  public findById(id: ProjectId): Stored<Project> | null {
    return this.findOne('SELECT * FROM projects WHERE id = ?', id);
  }

  public findBySlug(slug: Slug): Stored<Project> | null {
    return this.findOne('SELECT * FROM projects WHERE slug = ?', slug);
  }

  public list(filter: { readonly status?: Project['status'] }): readonly Stored<Project>[] {
    return this.database
      .prepare<{ status: string | null }, ProjectRow>(
        'SELECT * FROM projects WHERE @status IS NULL OR status = @status ORDER BY name COLLATE NOCASE',
      )
      .all({ status: filter.status ?? null })
      .map(toStoredProject);
  }

  private findOne(sql: string, value: string): Stored<Project> | null {
    const row = this.database.prepare<[string], ProjectRow>(sql).get(value);
    return row === undefined ? null : toStoredProject(row);
  }

  public findIcon(id: ProjectId): Asset | null {
    return findIcon(this.database, { type: 'project', id });
  }

  public replaceIcon(id: ProjectId, icon: Asset | null, context: ChangeContext): Asset | null {
    return replaceIcon(this.database, { type: 'project', id }, icon, context);
  }
}

function toParameters(project: Project): Record<string, unknown> {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: project.description,
    status: project.status,
    archivedAt: toDbTime(project.archivedAt),
    archivedBy: project.archivedBy,
  };
}

function toStoredProject(row: ProjectRow): Stored<Project> {
  return {
    value: {
      id: row.id as ProjectId,
      slug: row.slug as Slug,
      name: row.name as DisplayName,
      description: row.description,
      status: row.status,
      archivedAt: fromDbTime(row.archived_at),
      archivedBy: row.archived_by as UserId | null,
    },
    rowVersion: row.row_version,
  };
}
