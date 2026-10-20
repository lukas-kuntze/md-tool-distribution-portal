import type { Migration } from '../migration.js';

/**
 * A deletion job can remove a single artifact through the same quarantine as a whole release. At most one
 * open job per release (for the release itself) and one per artifact.
 */
export const artifactRemoval: Migration = {
  version: 5,
  name: 'artifact-removal',
  sql: `
ALTER TABLE deletion_jobs ADD COLUMN artifact_id TEXT REFERENCES release_artifacts (id) ON DELETE RESTRICT;

DROP INDEX deletion_jobs_open;
CREATE UNIQUE INDEX deletion_jobs_open ON deletion_jobs (release_id)
  WHERE artifact_id IS NULL AND state NOT IN ('completed', 'restored', 'cancelled');
CREATE UNIQUE INDEX deletion_jobs_open_artifact ON deletion_jobs (artifact_id)
  WHERE artifact_id IS NOT NULL AND state NOT IN ('completed', 'restored', 'cancelled');
`,
};
