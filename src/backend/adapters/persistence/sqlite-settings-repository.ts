import type { Database } from 'better-sqlite3';

import { withDefaults, type Settings } from '../../domain/entities/settings.js';
import type { SettingsRepository } from '../../domain/ports/settings-repository.js';
import type { ChangeContext, Stored } from '../../domain/ports/stored.js';
import { assertRowUpdated, toDbTime } from './sqlite-values.js';

export class SqliteSettingsRepository implements SettingsRepository {
  public constructor(private readonly database: Database) {}

  public load(): Stored<Settings> | null {
    const row = this.database
      .prepare<[], { value: string; row_version: number }>('SELECT value, row_version FROM settings WHERE id = 1')
      .get();

    return row === undefined
      ? null
      : { value: withDefaults(JSON.parse(row.value) as Partial<Settings>), rowVersion: row.row_version };
  }

  public seed(settings: Settings, at: Date): boolean {
    const result = this.database
      .prepare('INSERT INTO settings (id, value, updated_at) VALUES (1, ?, ?) ON CONFLICT (id) DO NOTHING')
      .run(JSON.stringify(settings), toDbTime(at));
    return result.changes === 1;
  }

  public save(settings: Settings, expectedRowVersion: number, context: ChangeContext): number {
    const result = this.database
      .prepare(
        `UPDATE settings SET value = ?, updated_at = ?, updated_by = ?, row_version = row_version + 1
         WHERE id = 1 AND row_version = ?`,
      )
      .run(JSON.stringify(settings), toDbTime(context.at), context.actor, expectedRowVersion);

    assertRowUpdated(result.changes);
    return expectedRowVersion + 1;
  }
}
