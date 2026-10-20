import type { Database } from 'better-sqlite3';

import type { Migration } from './migration.js';
import { initialSchema } from './migrations/0001-initial-schema.js';
import { sessionsAndFramework } from './migrations/0002-sessions-and-framework.js';
import { shareLinks } from './migrations/0003-share-links.js';
import { shareLinkReleases } from './migrations/0004-share-link-releases.js';
import { artifactRemoval } from './migrations/0005-artifact-removal.js';
import { storageReports } from './migrations/0006-storage-reports.js';
import { applicationPresentation } from './migrations/0007-application-presentation.js';
import { projectIcons } from './migrations/0008-project-icons.js';
import { settings } from './migrations/0009-settings.js';
import { accountPreferences } from './migrations/0010-account-preferences.js';

export const MIGRATIONS: readonly Migration[] = [
  initialSchema,
  sessionsAndFramework,
  shareLinks,
  shareLinkReleases,
  artifactRemoval,
  storageReports,
  applicationPresentation,
  projectIcons,
  settings,
  accountPreferences,
];

export interface MigrationResult {
  readonly applied: readonly number[];
  readonly currentVersion: number;
}

/**
 * Brings the schema up to date before the application starts. Each migration runs in its own transaction
 * together with its bookkeeping row, so a failed migration leaves the schema at the previous version.
 * Web service and worker may start at the same moment: every migration takes the write lock first and
 * checks again whether the other process has applied it meanwhile.
 */
export function migrate(database: Database, now: Date, migrations: readonly Migration[] = MIGRATIONS): MigrationResult {
  database.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT',
  );

  const isApplied = database.prepare<[number], { version: number }>(
    'SELECT version FROM schema_migrations WHERE version = ?',
  );
  const record = database.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  const applied: number[] = [];

  for (const migration of [...migrations].sort((left, right) => left.version - right.version)) {
    database
      .transaction((): void => {
        if (isApplied.get(migration.version) !== undefined) {
          return;
        }

        database.exec(migration.sql);
        record.run(migration.version, migration.name, now.toISOString());
        applied.push(migration.version);
      })
      .immediate();
  }

  const current = database
    .prepare<[], { version: number | null }>('SELECT max(version) AS version FROM schema_migrations')
    .get();
  return { applied, currentVersion: current?.version ?? 0 };
}
