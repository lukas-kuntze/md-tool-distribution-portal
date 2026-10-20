import type { Database } from 'better-sqlite3';

import type { StorageReport } from '../../domain/entities/storage-report.js';
import type { StorageReportRepository } from '../../domain/ports/storage-report-repository.js';
import type { StorageReportId } from '../../domain/value-objects/identifier.js';
import { fromDbTime, toDbTime } from './sqlite-values.js';

interface StorageReportRow {
  readonly id: string;
  readonly trigger: StorageReport['trigger'];
  readonly started_at: string;
  readonly finished_at: string;
  readonly files_checked: number;
  readonly bytes_checked: number;
  readonly details: string;
}

type Details = Pick<StorageReport, 'missing' | 'recovered' | 'orphaned'>;

export class SqliteStorageReportRepository implements StorageReportRepository {
  public constructor(private readonly database: Database) {}

  public insert(report: StorageReport): void {
    const details: Details = { missing: report.missing, recovered: report.recovered, orphaned: report.orphaned };

    this.database
      .prepare(
        `INSERT INTO storage_reports (
           id, trigger, started_at, finished_at, files_checked, bytes_checked, missing_count, orphaned_count, details)
         VALUES (@id, @trigger, @startedAt, @finishedAt, @filesChecked, @bytesChecked, @missingCount, @orphanedCount, @details)`,
      )
      .run({
        id: report.id,
        trigger: report.trigger,
        startedAt: toDbTime(report.startedAt),
        finishedAt: toDbTime(report.finishedAt),
        filesChecked: report.filesChecked,
        bytesChecked: report.bytesChecked,
        missingCount: report.missing.length,
        orphanedCount: report.orphaned.length,
        details: JSON.stringify(details),
      });
  }

  public latest(): StorageReport | null {
    const row = this.database
      .prepare<[], StorageReportRow>('SELECT * FROM storage_reports ORDER BY finished_at DESC, id DESC LIMIT 1')
      .get();

    if (row === undefined) {
      return null;
    }

    const details = JSON.parse(row.details) as Details;

    return {
      id: row.id as StorageReportId,
      trigger: row.trigger,
      startedAt: fromDbTime(row.started_at),
      finishedAt: fromDbTime(row.finished_at),
      filesChecked: row.files_checked,
      bytesChecked: row.bytes_checked,
      ...details,
    };
  }
}
