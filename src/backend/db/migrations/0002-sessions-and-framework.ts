import type { Migration } from '../migration.js';

/** Browser sessions for the GitHub sign-in, and the framework an application is built with. */
export const sessionsAndFramework: Migration = {
  version: 2,
  name: 'sessions-and-framework',
  sql: `
ALTER TABLE applications ADD COLUMN framework TEXT NOT NULL DEFAULT 'flutter'
  CHECK (framework IN ('flutter', 'dotnet_maui'));

-- Only the SHA-256 hash of the cookie token is stored, so a copy of the database grants no access.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  login TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  client_ip TEXT,
  user_agent TEXT
) STRICT;

CREATE INDEX sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;
`,
};
