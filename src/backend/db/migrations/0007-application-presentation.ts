import type { Migration } from '../migration.js';

/**
 * Presentation of an application on download pages (concept 4.2, 7.3): icons as assets stored next to the
 * artifacts, installation notes in `public_page`. The flavor order uses the existing `sort_order`.
 */
export const applicationPresentation: Migration = {
  version: 7,
  name: 'application-presentation',
  sql: `
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('icon')),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  storage_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX assets_application ON assets (application_id);

ALTER TABLE applications ADD COLUMN icon_asset_id TEXT REFERENCES assets (id) ON DELETE RESTRICT;
`,
};
