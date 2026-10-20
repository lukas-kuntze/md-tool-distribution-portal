import type { Migration } from '../migration.js';

/**
 * Settings adjusted at runtime on the settings page, as a single row of JSON; the service seeds it from its
 * environment on the first start. Changing them needs the new permission `settings.manage`, which only the
 * platform administrator holds.
 */
export const settings: Migration = {
  version: 9,
  name: 'settings',
  sql: `
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  row_version INTEGER NOT NULL DEFAULT 1
) STRICT;

INSERT INTO permissions (key, description) VALUES
  ('settings.manage', 'Plattform-Einstellungen wie Quarantänedauer, Sitzungen und Freigabe-Vorgaben ändern');

INSERT INTO role_permissions (role_id, permission_key) VALUES
  ('00000000-0000-7000-8000-000000000001', 'settings.manage');
`,
};
