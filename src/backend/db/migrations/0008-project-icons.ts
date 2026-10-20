import type { Migration } from '../migration.js';

/**
 * Projects get an icon like applications: an asset belongs to exactly one application or one project. SQLite
 * cannot relax `NOT NULL`, so `assets` is rebuilt; the icon references of applications are set aside while the
 * old table is dropped, so that every foreign key holds at every step.
 */
export const projectIcons: Migration = {
  version: 8,
  name: 'project-icons',
  sql: `
CREATE TABLE assets_new (
  id TEXT PRIMARY KEY,
  application_id TEXT REFERENCES applications (id) ON DELETE RESTRICT,
  project_id TEXT REFERENCES projects (id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('icon')),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  storage_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  CHECK ((application_id IS NULL) <> (project_id IS NULL))
) STRICT;

INSERT INTO assets_new (id, application_id, project_id, kind, content_type, size_bytes, sha256, storage_key, created_at, created_by)
SELECT id, application_id, NULL, kind, content_type, size_bytes, sha256, storage_key, created_at, created_by FROM assets;

-- The old table can only be dropped once nothing refers to it; the references are restored afterwards.
CREATE TEMP TABLE icon_references AS SELECT id, icon_asset_id FROM applications WHERE icon_asset_id IS NOT NULL;
UPDATE applications SET icon_asset_id = NULL WHERE icon_asset_id IS NOT NULL;

DROP TABLE assets;
ALTER TABLE assets_new RENAME TO assets;

UPDATE applications
SET icon_asset_id = (SELECT r.icon_asset_id FROM icon_references r WHERE r.id = applications.id)
WHERE id IN (SELECT id FROM icon_references);
DROP TABLE icon_references;

CREATE INDEX assets_application ON assets (application_id);
CREATE INDEX assets_project ON assets (project_id);

ALTER TABLE projects ADD COLUMN icon_asset_id TEXT REFERENCES assets (id) ON DELETE RESTRICT;
`,
};
