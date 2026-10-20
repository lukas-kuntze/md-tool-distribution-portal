import type { Migration } from '../migration.js';

/** Results of the reconciliation between database and storage areas (concept 5.6). */
export const storageReports: Migration = {
  version: 6,
  name: 'storage-reports',
  sql: `
CREATE TABLE storage_reports (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  files_checked INTEGER NOT NULL CHECK (files_checked >= 0),
  bytes_checked INTEGER NOT NULL CHECK (bytes_checked >= 0),
  missing_count INTEGER NOT NULL CHECK (missing_count >= 0),
  orphaned_count INTEGER NOT NULL CHECK (orphaned_count >= 0),
  details TEXT NOT NULL CHECK (json_valid(details))
) STRICT;

CREATE INDEX storage_reports_finished ON storage_reports (finished_at);
`,
};
