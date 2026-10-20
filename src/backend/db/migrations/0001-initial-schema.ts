import type { Migration } from '../migration.js';

/**
 * Initial schema. Conventions: STRICT tables, UUIDv7 identifiers as TEXT, UTC timestamps as ISO-8601 TEXT,
 * booleans as INTEGER 0/1, JSON as TEXT checked with json_valid. Foreign keys never cascade except for
 * pure configuration links; projects, applications, flavors and releases are archived or tombstoned.
 */
export const initialSchema: Migration = {
  version: 1,
  name: 'initial-schema',
  sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  email TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  last_login_at TEXT
) STRICT;

CREATE TABLE external_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('github')),
  provider_host TEXT NOT NULL,
  subject TEXT NOT NULL,
  node_id TEXT,
  login TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  UNIQUE (provider, provider_host, subject)
) STRICT;

CREATE INDEX external_identities_user ON external_identities (user_id);
CREATE INDEX external_identities_login ON external_identities (provider_host, login);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  added_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id)
) STRICT;

CREATE INDEX team_members_user ON team_members (user_id);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 63),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  archived_at TEXT,
  archived_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  row_version INTEGER NOT NULL DEFAULT 1,
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
) STRICT;

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
  slug TEXT NOT NULL CHECK (length(slug) BETWEEN 1 AND 63),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  flavors_enabled INTEGER NOT NULL DEFAULT 0 CHECK (flavors_enabled IN (0, 1)),
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'organization')),
  public_page TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(public_page)),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  row_version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (project_id, slug)
) STRICT;

-- One row per platform the application is built for.
CREATE TABLE application_platforms (
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE RESTRICT,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  PRIMARY KEY (application_id, platform)
) STRICT;

CREATE TABLE application_flavors (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE RESTRICT,
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 64),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'archived')),
  publication_rules TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(publication_rules)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  row_version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (application_id, key),
  -- Target of the composite foreign key that keeps release, flavor and application consistent.
  UNIQUE (id, application_id),
  CHECK (is_default = 0 OR status <> 'archived')
) STRICT;

CREATE UNIQUE INDEX application_flavors_default ON application_flavors (application_id) WHERE is_default = 1;

-- Android package name / iOS bundle identifier per flavor. Unique across all flavors, archived ones included.
CREATE TABLE flavor_platform_configs (
  flavor_id TEXT NOT NULL REFERENCES application_flavors (id) ON DELETE RESTRICT,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  bundle_identifier TEXT NOT NULL CHECK (length(bundle_identifier) BETWEEN 1 AND 255),
  PRIMARY KEY (flavor_id, platform),
  UNIQUE (platform, bundle_identifier)
) STRICT;

CREATE TABLE release_channels (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE RESTRICT,
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 63),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  requires_approval INTEGER NOT NULL DEFAULT 0 CHECK (requires_approval IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  row_version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (application_id, key)
) STRICT;

-- Repositories and refs whose GitHub Actions OIDC tokens may upload releases of an application.
CREATE TABLE ci_bindings (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE RESTRICT,
  repository_id INTEGER NOT NULL,
  repository_name TEXT NOT NULL,
  ref_pattern TEXT NOT NULL,
  environment TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  revoked_at TEXT,
  revoked_by TEXT REFERENCES users (id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX ci_bindings_repository ON ci_bindings (repository_id) WHERE revoked_at IS NULL;

CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE RESTRICT,
  flavor_id TEXT NOT NULL,
  version TEXT NOT NULL CHECK (length(version) BETWEEN 5 AND 64),
  version_major INTEGER NOT NULL,
  version_minor INTEGER NOT NULL,
  version_patch INTEGER NOT NULL,
  version_pre TEXT,
  build_number INTEGER NOT NULL CHECK (build_number BETWEEN 1 AND 2100000000),
  required_platforms TEXT NOT NULL CHECK (required_platforms IN ('android', 'ios', 'android,ios')),
  release_notes TEXT NOT NULL DEFAULT '',
  changelog TEXT NOT NULL DEFAULT '',
  git_repository TEXT,
  git_commit_sha TEXT NOT NULL CHECK (length(git_commit_sha) IN (40, 64)),
  git_branch TEXT,
  git_tag TEXT,
  workflow_run_id INTEGER,
  workflow_run_attempt INTEGER,
  workflow_run_url TEXT,
  imported_from TEXT,
  publication_status TEXT NOT NULL CHECK (publication_status IN ('draft', 'published', 'withdrawn')),
  published_at TEXT,
  published_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  visibility TEXT NOT NULL DEFAULT 'inherit' CHECK (visibility IN ('inherit', 'restricted')),
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('active', 'pending_deletion', 'quarantined', 'purged')),
  deletion_requested_at TEXT,
  deletion_requested_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  purged_at TEXT,
  build_number_reserved INTEGER NOT NULL DEFAULT 1 CHECK (build_number_reserved IN (0, 1)),
  build_number_released_at TEXT,
  build_number_released_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  build_number_release_reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  row_version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (flavor_id, application_id) REFERENCES application_flavors (id, application_id) ON DELETE RESTRICT,
  CHECK (publication_status <> 'published' OR published_at IS NOT NULL),
  CHECK (lifecycle_state = 'active' OR deletion_requested_at IS NOT NULL),
  CHECK (lifecycle_state <> 'purged' OR purged_at IS NOT NULL),
  CHECK (build_number_reserved = 1 OR (lifecycle_state = 'purged' AND build_number_released_at IS NOT NULL))
) STRICT;

-- A build number stays taken per flavor, tombstones included, until an administrator releases it.
CREATE UNIQUE INDEX releases_build_number ON releases (flavor_id, build_number) WHERE build_number_reserved = 1;
CREATE INDEX releases_listing ON releases (application_id, lifecycle_state, publication_status, published_at DESC);
CREATE INDEX releases_latest ON releases (flavor_id, version_major DESC, version_minor DESC, version_patch DESC, build_number DESC);
CREATE INDEX releases_commit ON releases (git_commit_sha);

CREATE TABLE release_artifacts (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases (id) ON DELETE RESTRICT,
  platform TEXT CHECK (platform IN ('android', 'ios')),
  kind TEXT NOT NULL CHECK (kind IN ('apk', 'aab', 'ipa', 'dsym', 'mapping', 'metadata')),
  abi TEXT CHECK (abi IN ('arm64-v8a', 'armeabi-v7a', 'x86_64', 'universal')),
  build_mode TEXT NOT NULL CHECK (build_mode IN ('release', 'profile', 'debug')),
  original_file_name TEXT NOT NULL CHECK (length(original_file_name) BETWEEN 1 AND 255),
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  storage_key TEXT NOT NULL UNIQUE,
  storage_state TEXT NOT NULL CHECK (storage_state IN ('uploading', 'stored', 'quarantined', 'purged', 'missing')),
  git_commit_sha TEXT NOT NULL CHECK (length(git_commit_sha) IN (40, 64)),
  workflow_run_id INTEGER,
  workflow_run_attempt INTEGER,
  upload_source TEXT NOT NULL CHECK (upload_source IN ('ci', 'ui', 'import')),
  uploaded_at TEXT NOT NULL,
  uploaded_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  purged_at TEXT,
  CHECK (
    (kind IN ('apk', 'aab', 'mapping') AND platform = 'android')
    OR (kind IN ('ipa', 'dsym') AND platform = 'ios')
    OR (kind = 'metadata' AND platform IS NULL)
  ),
  CHECK (abi IS NULL OR platform = 'android'),
  CHECK ((storage_state = 'purged') = (purged_at IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX release_artifacts_variant
  ON release_artifacts (release_id, kind, ifnull(abi, ''), build_mode)
  WHERE storage_state <> 'purged';
CREATE INDEX release_artifacts_release ON release_artifacts (release_id, platform);

CREATE TABLE release_publications (
  release_id TEXT NOT NULL REFERENCES releases (id) ON DELETE RESTRICT,
  channel_id TEXT NOT NULL REFERENCES release_channels (id) ON DELETE RESTRICT,
  published_at TEXT NOT NULL,
  published_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  revoked_at TEXT,
  revoked_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  PRIMARY KEY (release_id, channel_id)
) STRICT;

CREATE INDEX release_publications_channel ON release_publications (channel_id) WHERE revoked_at IS NULL;

CREATE TABLE permissions (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL
) STRICT;

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions (key) ON DELETE RESTRICT,
  PRIMARY KEY (role_id, permission_key)
) STRICT;

CREATE TABLE role_assignments (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  user_id TEXT REFERENCES users (id) ON DELETE RESTRICT,
  team_id TEXT REFERENCES teams (id) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'project', 'application')),
  project_id TEXT REFERENCES projects (id) ON DELETE RESTRICT,
  application_id TEXT REFERENCES applications (id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('manual', 'configuration')),
  reason TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  granted_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  expires_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  CHECK ((user_id IS NULL) <> (team_id IS NULL)),
  CHECK (
    (scope_type = 'global' AND project_id IS NULL AND application_id IS NULL)
    OR (scope_type = 'project' AND project_id IS NOT NULL AND application_id IS NULL)
    OR (scope_type = 'application' AND application_id IS NOT NULL AND project_id IS NULL)
  )
) STRICT;

CREATE UNIQUE INDEX role_assignments_active ON role_assignments (
  role_id, ifnull(user_id, ''), ifnull(team_id, ''), scope_type, ifnull(project_id, ''), ifnull(application_id, '')
) WHERE revoked_at IS NULL;
CREATE INDEX role_assignments_user ON role_assignments (user_id) WHERE revoked_at IS NULL;
CREATE INDEX role_assignments_team ON role_assignments (team_id) WHERE revoked_at IS NULL;

-- Append-only. Targets are referenced without foreign keys, so that entries outlive whatever they describe.
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'ci', 'system')),
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

CREATE TABLE deletion_jobs (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases (id) ON DELETE RESTRICT,
  requested_at TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(reason) > 0),
  artifact_snapshot TEXT NOT NULL CHECK (json_valid(artifact_snapshot)),
  state TEXT NOT NULL CHECK (state IN (
    'requested', 'quarantining', 'quarantined', 'restoring', 'restored', 'purging', 'completed', 'failed', 'cancelled'
  )),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  purge_after TEXT,
  failed_phase TEXT CHECK (failed_phase IN ('quarantine', 'purge')),
  last_error_code TEXT,
  requires_manual_review INTEGER NOT NULL DEFAULT 0 CHECK (requires_manual_review IN (0, 1)),
  locked_by TEXT,
  locked_until TEXT,
  completed_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  CHECK ((state = 'failed') = (failed_phase IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX deletion_jobs_open ON deletion_jobs (release_id)
  WHERE state NOT IN ('completed', 'restored', 'cancelled');
CREATE INDEX deletion_jobs_due ON deletion_jobs (next_attempt_at) WHERE state IN ('requested', 'quarantined');

INSERT INTO permissions (key, description) VALUES
  ('projects.read', 'Projekte und ihre Stammdaten sehen'),
  ('projects.create', 'Projekte anlegen'),
  ('projects.update', 'Projekte bearbeiten und archivieren'),
  ('projects.delete', 'Leere Projekte endgültig löschen'),
  ('applications.manage', 'Anwendungen anlegen und bearbeiten, Plattformen, Darstellung und Kanäle verwalten'),
  ('flavors.manage', 'Flavors anlegen, bearbeiten, deaktivieren und archivieren'),
  ('releases.read', 'Releases einschließlich Entwürfen sehen'),
  ('releases.create', 'Releases anlegen'),
  ('releases.update', 'Release-Metadaten bearbeiten'),
  ('releases.publish', 'Releases veröffentlichen, zurückziehen und Kanälen zuordnen'),
  ('releases.delete', 'Löschung von Releases beantragen'),
  ('releases.restore', 'Releases aus der Quarantäne wiederherstellen'),
  ('releases.purge', 'Releases ohne Wartefrist endgültig löschen'),
  ('artifacts.upload', 'Artefakte hochladen'),
  ('artifacts.download', 'Artefakte herunterladen und installieren'),
  ('artifacts.delete', 'Einzelne Artefakte entfernen'),
  ('build_numbers.release', 'Build-Nummern endgültig gelöschter Releases freigeben'),
  ('permissions.manage', 'Rollen im eigenen Geltungsbereich vergeben und entziehen'),
  ('audit.read', 'Audit-Log einsehen'),
  ('storage.manage', 'Speicher, Löschaufträge und Abgleichsberichte verwalten');

INSERT INTO roles (id, key, name, description, is_system, created_at) VALUES
  ('00000000-0000-7000-8000-000000000001', 'platform-admin', 'Plattform-Admin', 'Alle Berechtigungen', 1, '2026-10-17T00:00:00.000Z'),
  ('00000000-0000-7000-8000-000000000002', 'project-admin', 'Projekt-Admin', 'Verwaltet ein Projekt vollständig', 1, '2026-10-17T00:00:00.000Z'),
  ('00000000-0000-7000-8000-000000000003', 'release-manager', 'Release Manager', 'Verwaltet, veröffentlicht und löscht Releases', 1, '2026-10-17T00:00:00.000Z'),
  ('00000000-0000-7000-8000-000000000004', 'developer', 'Entwickler', 'Legt Releases an und lädt Artefakte hoch', 1, '2026-10-17T00:00:00.000Z'),
  ('00000000-0000-7000-8000-000000000005', 'tester', 'Tester', 'Sieht Releases und installiert sie', 1, '2026-10-17T00:00:00.000Z'),
  ('00000000-0000-7000-8000-000000000006', 'viewer', 'Betrachter', 'Installiert veröffentlichte Releases', 1, '2026-10-17T00:00:00.000Z');

INSERT INTO role_permissions (role_id, permission_key)
  SELECT '00000000-0000-7000-8000-000000000001', key FROM permissions;

INSERT INTO role_permissions (role_id, permission_key)
  SELECT '00000000-0000-7000-8000-000000000002', key FROM permissions WHERE key IN (
    'projects.read', 'projects.update', 'applications.manage', 'flavors.manage',
    'releases.read', 'releases.create', 'releases.update', 'releases.publish', 'releases.delete', 'releases.restore',
    'artifacts.upload', 'artifacts.download', 'artifacts.delete', 'build_numbers.release', 'permissions.manage', 'audit.read'
  );

INSERT INTO role_permissions (role_id, permission_key)
  SELECT '00000000-0000-7000-8000-000000000003', key FROM permissions WHERE key IN (
    'releases.read', 'releases.create', 'releases.update', 'releases.publish', 'releases.delete', 'releases.restore',
    'artifacts.upload', 'artifacts.download', 'artifacts.delete', 'audit.read'
  );

INSERT INTO role_permissions (role_id, permission_key)
  SELECT '00000000-0000-7000-8000-000000000004', key FROM permissions WHERE key IN (
    'releases.read', 'releases.create', 'releases.update', 'artifacts.upload', 'artifacts.download'
  );

INSERT INTO role_permissions (role_id, permission_key)
  SELECT '00000000-0000-7000-8000-000000000005', key FROM permissions WHERE key IN ('releases.read', 'artifacts.download');

INSERT INTO role_permissions (role_id, permission_key)
  SELECT '00000000-0000-7000-8000-000000000006', key FROM permissions WHERE key IN ('projects.read', 'artifacts.download');
`,
};
