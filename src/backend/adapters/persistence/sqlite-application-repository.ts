import type { Database } from 'better-sqlite3';

import type { Asset, ApplicationPresentation } from '../../domain/entities/asset.js';
import type { Application, ApplicationFlavor } from '../../domain/entities/application.js';
import type { ApplicationRepository } from '../../domain/ports/application-repository.js';
import type { ChangeContext, Stored } from '../../domain/ports/stored.js';
import type { BundleIdentifier } from '../../domain/value-objects/bundle-identifier.js';
import type { FlavorKey } from '../../domain/value-objects/flavor-key.js';
import type { ApplicationId, FlavorId, ProjectId } from '../../domain/value-objects/identifier.js';
import { PLATFORMS, type Platform } from '../../domain/value-objects/platform.js';
import type { Slug } from '../../domain/value-objects/slug.js';
import { findIcon, replaceIcon } from './sqlite-assets.js';
import {
  assertRowUpdated,
  fromDbBoolean,
  toDbBoolean,
  toDbTime,
  translateConstraints,
  type ConstraintTranslation,
} from './sqlite-values.js';

interface ApplicationRow {
  readonly id: string;
  readonly project_id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly flavors_enabled: number;
  readonly framework: Application['framework'];
  readonly visibility: Application['visibility'];
  readonly status: Application['status'];
  readonly row_version: number;
}

interface FlavorRow {
  readonly id: string;
  readonly application_id: string;
  readonly key: string;
  readonly name: string;
  readonly is_default: number;
  readonly status: ApplicationFlavor['status'];
  readonly has_releases: number;
  readonly row_version: number;
}

const SLUG_TAKEN: ConstraintTranslation = {
  constraint: 'applications.slug',
  code: 'slug_taken',
  message: 'Another application of this project already uses this slug.',
};

const FLAVOR_CONSTRAINTS: readonly ConstraintTranslation[] = [
  {
    constraint: 'application_flavors.key',
    code: 'flavor_key_taken',
    message: 'Another flavor of this application already uses this key.',
  },
  {
    constraint: 'flavor_platform_configs.bundle_identifier',
    code: 'bundle_identifier_taken',
    message: 'Another flavor already uses this package name or bundle identifier.',
  },
];

const FLAVOR_SELECT = `
  SELECT f.*, EXISTS (SELECT 1 FROM releases r WHERE r.flavor_id = f.id) AS has_releases
  FROM application_flavors f`;

export class SqliteApplicationRepository implements ApplicationRepository {
  public constructor(private readonly database: Database) {}

  public insert(application: Application, defaultFlavor: ApplicationFlavor, context: ChangeContext): void {
    translateConstraints(
      () =>
        this.database
          .prepare(
            `INSERT INTO applications (id, project_id, slug, name, description, framework, flavors_enabled, visibility, status,
                                       created_at, created_by, updated_at, updated_by)
             VALUES (@id, @projectId, @slug, @name, @description, @framework, @flavorsEnabled, @visibility, @status,
                     @at, @actor, @at, @actor)`,
          )
          .run({ ...applicationParameters(application), at: toDbTime(context.at), actor: context.actor }),
      [SLUG_TAKEN],
    );

    this.replacePlatforms(application);
    this.insertFlavor(defaultFlavor, context);
  }

  public update(application: Application, expectedRowVersion: number, context: ChangeContext): number {
    const result = translateConstraints(
      () =>
        this.database
          .prepare(
            `UPDATE applications
             SET project_id = @projectId, slug = @slug, name = @name, description = @description,
                 framework = @framework, flavors_enabled = @flavorsEnabled, visibility = @visibility, status = @status,
                 updated_at = @at, updated_by = @actor, row_version = row_version + 1
             WHERE id = @id AND row_version = @expectedRowVersion`,
          )
          .run({
            ...applicationParameters(application),
            at: toDbTime(context.at),
            actor: context.actor,
            expectedRowVersion,
          }),
      [SLUG_TAKEN],
    );

    assertRowUpdated(result.changes);
    this.replacePlatforms(application);
    return expectedRowVersion + 1;
  }

  public findById(id: ApplicationId): Stored<Application> | null {
    const row = this.database.prepare<[string], ApplicationRow>('SELECT * FROM applications WHERE id = ?').get(id);
    return row === undefined ? null : this.toStoredApplication(row);
  }

  public findBySlug(projectId: ProjectId, slug: Slug): Stored<Application> | null {
    const row = this.database
      .prepare<[string, string], ApplicationRow>('SELECT * FROM applications WHERE project_id = ? AND slug = ?')
      .get(projectId, slug);
    return row === undefined ? null : this.toStoredApplication(row);
  }

  public listByProject(projectId: ProjectId): readonly Stored<Application>[] {
    return this.database
      .prepare<[string], ApplicationRow>('SELECT * FROM applications WHERE project_id = ? ORDER BY name COLLATE NOCASE')
      .all(projectId)
      .map((row) => this.toStoredApplication(row));
  }

  public insertFlavor(flavor: ApplicationFlavor, context: ChangeContext): void {
    translateConstraints((): void => {
      this.database
        .prepare(
          `INSERT INTO application_flavors (id, application_id, key, name, is_default, status,
                                            created_at, created_by, updated_at, updated_by)
           VALUES (@id, @applicationId, @key, @name, @isDefault, @status, @at, @actor, @at, @actor)`,
        )
        .run({ ...flavorParameters(flavor), at: toDbTime(context.at), actor: context.actor });
      this.replaceBundleIdentifiers(flavor);
    }, FLAVOR_CONSTRAINTS);
  }

  public updateFlavor(flavor: ApplicationFlavor, expectedRowVersion: number, context: ChangeContext): number {
    return translateConstraints((): number => {
      const result = this.database
        .prepare(
          `UPDATE application_flavors
           SET key = @key, name = @name, status = @status, updated_at = @at, updated_by = @actor,
               row_version = row_version + 1
           WHERE id = @id AND row_version = @expectedRowVersion`,
        )
        .run({ ...flavorParameters(flavor), at: toDbTime(context.at), actor: context.actor, expectedRowVersion });

      assertRowUpdated(result.changes);
      this.replaceBundleIdentifiers(flavor);
      return expectedRowVersion + 1;
    }, FLAVOR_CONSTRAINTS);
  }

  public findFlavor(id: FlavorId): Stored<ApplicationFlavor> | null {
    const row = this.database.prepare<[string], FlavorRow>(`${FLAVOR_SELECT} WHERE f.id = ?`).get(id);
    return row === undefined ? null : this.toStoredFlavor(row);
  }

  public listFlavors(applicationId: ApplicationId): readonly Stored<ApplicationFlavor>[] {
    return this.database
      .prepare<[string], FlavorRow>(
        `${FLAVOR_SELECT} WHERE f.application_id = ? ORDER BY f.sort_order, f.is_default DESC, f.name COLLATE NOCASE`,
      )
      .all(applicationId)
      .map((row) => this.toStoredFlavor(row));
  }

  public reorderFlavors(applicationId: ApplicationId, flavorIds: readonly FlavorId[], context: ChangeContext): void {
    const update = this.database.prepare(
      `UPDATE application_flavors SET sort_order = @position, updated_at = @at, updated_by = @actor
       WHERE id = @id AND application_id = @applicationId AND sort_order <> @position`,
    );

    flavorIds.forEach((id, position) => {
      update.run({ id, applicationId, position, at: toDbTime(context.at), actor: context.actor });
    });
  }

  public findPresentation(applicationId: ApplicationId): ApplicationPresentation {
    const row = this.database
      .prepare<[string], { public_page: string }>('SELECT public_page FROM applications WHERE id = ?')
      .get(applicationId);
    const page = JSON.parse(row?.public_page ?? '{}') as { installNotes?: unknown };

    return {
      installNotes: typeof page.installNotes === 'string' ? page.installNotes : '',
      icon: findIcon(this.database, { type: 'application', id: applicationId }),
    };
  }

  public updateInstallNotes(applicationId: ApplicationId, installNotes: string, context: ChangeContext): void {
    this.database
      .prepare(
        `UPDATE applications
         SET public_page = json_set(public_page, '$.installNotes', @installNotes), updated_at = @at, updated_by = @actor
         WHERE id = @applicationId`,
      )
      .run({ applicationId, installNotes, at: toDbTime(context.at), actor: context.actor });
  }

  public replaceIcon(applicationId: ApplicationId, icon: Asset | null, context: ChangeContext): Asset | null {
    return replaceIcon(this.database, { type: 'application', id: applicationId }, icon, context);
  }

  private replacePlatforms(application: Application): void {
    this.database.prepare('DELETE FROM application_platforms WHERE application_id = ?').run(application.id);
    const insert = this.database.prepare('INSERT INTO application_platforms (application_id, platform) VALUES (?, ?)');

    for (const platform of application.platforms) {
      insert.run(application.id, platform);
    }
  }

  private replaceBundleIdentifiers(flavor: ApplicationFlavor): void {
    this.database.prepare('DELETE FROM flavor_platform_configs WHERE flavor_id = ?').run(flavor.id);
    const insert = this.database.prepare(
      'INSERT INTO flavor_platform_configs (flavor_id, platform, bundle_identifier) VALUES (?, ?, ?)',
    );

    for (const platform of PLATFORMS) {
      const identifier = flavor.bundleIdentifiers[platform];

      if (identifier !== undefined) {
        insert.run(flavor.id, platform, identifier);
      }
    }
  }

  private toStoredApplication(row: ApplicationRow): Stored<Application> {
    const platforms = new Set(
      this.database
        .prepare<[string], { platform: Platform }>(
          'SELECT platform FROM application_platforms WHERE application_id = ?',
        )
        .all(row.id)
        .map((platformRow) => platformRow.platform),
    );

    return {
      value: {
        id: row.id as ApplicationId,
        projectId: row.project_id as ProjectId,
        slug: row.slug as Slug,
        name: row.name,
        description: row.description,
        platforms: PLATFORMS.filter((platform) => platforms.has(platform)),
        framework: row.framework,
        flavorsEnabled: fromDbBoolean(row.flavors_enabled),
        visibility: row.visibility,
        status: row.status,
      },
      rowVersion: row.row_version,
    };
  }

  private toStoredFlavor(row: FlavorRow): Stored<ApplicationFlavor> {
    const identifiers = this.database
      .prepare<[string], { platform: Platform; bundle_identifier: string }>(
        'SELECT platform, bundle_identifier FROM flavor_platform_configs WHERE flavor_id = ?',
      )
      .all(row.id);

    return {
      value: {
        id: row.id as FlavorId,
        applicationId: row.application_id as ApplicationId,
        key: row.key as FlavorKey,
        name: row.name,
        isDefault: fromDbBoolean(row.is_default),
        status: row.status,
        bundleIdentifiers: Object.fromEntries(
          identifiers.map((identifier) => [identifier.platform, identifier.bundle_identifier as BundleIdentifier]),
        ),
        hasReleases: fromDbBoolean(row.has_releases),
      },
      rowVersion: row.row_version,
    };
  }
}

function applicationParameters(application: Application): Record<string, unknown> {
  return {
    id: application.id,
    projectId: application.projectId,
    slug: application.slug,
    name: application.name,
    description: application.description,
    framework: application.framework,
    flavorsEnabled: toDbBoolean(application.flavorsEnabled),
    visibility: application.visibility,
    status: application.status,
  };
}

function flavorParameters(flavor: ApplicationFlavor): Record<string, unknown> {
  return {
    id: flavor.id,
    applicationId: flavor.applicationId,
    key: flavor.key,
    name: flavor.name,
    isDefault: toDbBoolean(flavor.isDefault),
    status: flavor.status,
  };
}
