import type { StorageReport } from '../entities/storage-report.js';

export interface StorageReportRepository {
  insert(report: StorageReport): void;
  /** The most recent report, if any reconciliation ran yet. */
  latest(): StorageReport | null;
}
