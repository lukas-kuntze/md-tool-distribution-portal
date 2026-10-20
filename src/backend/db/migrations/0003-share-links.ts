import type { Migration } from '../migration.js';

/**
 * Share links for customers without an account (decision E7), the permission to manage them, and `share` as
 * actor type of the audit log. SQLite cannot change a CHECK constraint in place, so the audit log is copied
 * into a table with the extended constraint; its append-only triggers are created again afterwards. The
 * implicit delete of `DROP TABLE` does not fire triggers, so no entry is lost or changed.
 */
export const shareLinks: Migration = {
  version: 3,
  name: 'share-links',
  sql: `
-- Only the SHA-256 hash of the secret is stored, as for sessions.
CREATE TABLE share_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('project', 'application')),
  project_id TEXT REFERENCES projects (id) ON DELETE RESTRICT,
  application_id TEXT REFERENCES applications (id) ON DELETE RESTRICT,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  expires_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  CHECK ((scope_type = 'project') = (project_id IS NOT NULL AND application_id IS NULL)),
  CHECK ((scope_type = 'application') = (application_id IS NOT NULL AND project_id IS NULL)),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
) STRICT;

CREATE INDEX share_links_project ON share_links (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX share_links_application ON share_links (application_id) WHERE application_id IS NOT NULL;

INSERT INTO permissions (key, description) VALUES
  ('shares.manage', 'Freigabelinks für Personen ohne Konto erstellen und widerrufen');

-- New permissions reach platform-admin automatically; project-admin gets this one by decision.
INSERT INTO role_permissions (role_id, permission_key) VALUES
  ('00000000-0000-7000-8000-000000000001', 'shares.manage'),
  ('00000000-0000-7000-8000-000000000002', 'shares.manage');

CREATE TABLE audit_logs_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'ci', 'system', 'share')),
  actor_user_id TEXT REFERENCES users (id) ON DELETE RESTRICT,
  actor_label TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  project_id TEXT,
  application_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
  correlation_id TEXT,
  client_ip TEXT,
  user_agent TEXT,
  details TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details)),
  CHECK ((actor_type = 'user') = (actor_user_id IS NOT NULL))
) STRICT;

INSERT INTO audit_logs_next (
  id, occurred_at, actor_type, actor_user_id, actor_label, action, target_type, target_id, project_id,
  application_id, outcome, correlation_id, client_ip, user_agent, details
)
SELECT
  id, occurred_at, actor_type, actor_user_id, actor_label, action, target_type, target_id, project_id,
  application_id, outcome, correlation_id, client_ip, user_agent, details
FROM audit_logs;

DROP TABLE audit_logs;
ALTER TABLE audit_logs_next RENAME TO audit_logs;

CREATE INDEX audit_logs_occurred ON audit_logs (occurred_at);
CREATE INDEX audit_logs_target ON audit_logs (target_type, target_id);
CREATE INDEX audit_logs_application ON audit_logs (application_id, occurred_at);
CREATE INDEX audit_logs_actor ON audit_logs (actor_user_id, occurred_at);

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;
`,
};
