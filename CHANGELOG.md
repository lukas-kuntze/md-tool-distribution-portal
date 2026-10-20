# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project set up from the DevX Template: TypeScript 1.0.0 (2026-08-09), which provides tooling, Git hooks, CI workflows and repository templates.
- Architecture concept for the app distribution platform in `docs/architecture/architekturkonzept.md`.
- Domain core of the backend: value objects for identifiers, slugs, display names, flavor keys, bundle identifiers, versions, build numbers, commit SHAs, artifact kinds and storage keys; the permission catalog with scoped, inherited evaluation; and entities with state machines for projects, applications and flavors, releases and their artifacts, deletion jobs and role assignments.
- Artifact storage on the local file system: path resolution that never leaves the storage root, rejection of symbolic links and junctions, streaming uploads with SHA-256 and size limits, immutable artifacts, and idempotent quarantine, restore and purge steps verified against the deletion snapshot.
- Deletion workflow use cases: requesting a deletion with confirmation and permission check, the worker step that quarantines and later purges with retries and alerts, and restoring a quarantined release; UUIDv7 identifiers and a system clock.
- Sign-in with GitHub Enterprise (OAuth, organisation membership as sign-in gate, users bound to the stable GitHub id, bootstrap administrators from configuration) and server-side sessions stored as token hashes with absolute and idle expiry.
- Administration API on Fastify for projects, applications, flavors, releases (publish, withdraw, delete, restore, release build numbers), artifact downloads with byte ranges, role assignments, the audit log and deletion jobs; every refused action is audited, state-changing calls are protected against cross-site requests.
- Configuration from environment variables (`.env.example`), composition root, and separate entry points for the web service (`npm start`) and the deletion worker (`npm run start:worker`).
- Applications record their framework (Flutter or .NET MAUI).
- Persistence on SQLite (`better-sqlite3`): initial schema with seeded permissions and system roles, an append-only audit log enforced by triggers, a forward-only migration runner, and repositories with optimistic locking, translated uniqueness violations and an atomic lease for deletion jobs, combined in a transactional unit of work.
- Administration interface following the company styleguide (`src/frontend`, built with Vite): projects, applications with flavors, settings, identifiers and visibility, releases with filters, artifacts, publishing, withdrawing, the deletion dialog with typed confirmation, restoring and releasing build numbers; role assignments and effective permissions, the audit log and deletion jobs. Actions are shown according to the user's permissions; light and dark theme.
- iOS installation over `itms-services`: short-lived links signed with HMAC (`INSTALL_LINK_SECRET`, `INSTALL_LINK_MINUTES`), manifest and IPA download without cookies, with user, permissions and release state checked on every request.
- Share links for people without an account (decision E7): a project or application can be shared through a secret link, optionally limited in time and revocable at any time (permission `shares.manage`, granted to platform and project administrators). The shared page shows the published releases with release notes and offers APK/IPA downloads and the iOS installation; every view and download is audited with the link as actor. Migration 3 adds `share_links` and the audit actor type `share`. A link shows either all published releases or only the newest one per flavor (migration 4).
- Dashboard as start page (`/`): projects, applications, published versions, drafts, releases in deletion and downloads of the last 30 days, per project and in total, plus the newest releases; it only counts what the user may see. The project list moved to `/projects.html`.
- German documentation of roles and permissions in `docs/rollen-und-berechtigungen.md`; the access page lists every role with what it allows, and role names appear in German throughout the interface.
- Paged lists (releases, audit log) report the number of all matches in the `X-Total-Count` header; the interface shows page numbers as in the styleguide (first and last page, gaps shortened with „…“). Roles are listed by the extent of their permissions.
- Single artifacts can be removed (permission `artifacts.delete`), e.g. a wrongly uploaded IPA, through the same quarantine as releases and restored until the retention ends; platform builds of a published release stay locked (migration 5).
- Storage view (`/storage.html`): usage in total, per project and in quarantine, and a reconciliation between database and storage areas that runs daily in the worker (`RECONCILE_HOURS`, default 24) and on demand. Artifacts whose file is gone or has a different size are marked missing and reappear once the file is back; files no artifact accounts for are reported, never deleted (migration 6, `storage_reports`).
- Presentation of applications on download pages: an app icon (PNG or JPEG up to 512 KB, recognised by its content and stored below `assets/`), installation notes and the order of the flavors (migration 7, table `assets`).
- Projects have an icon too (edit dialog of the project, `projects.update`, migration 8). Project icons appear in the project list and the project header, application icons in the application cards of a project.
- Users and access on one page (`/access.html`, „Benutzer & Zugriff“) with the tabs role assignments (including effective permissions), users and roles; the users tab needs platform-wide `permissions.manage`. The separate user page is gone.
- Settings page (`/settings.html`, permission `settings.manage`, migration 9): platform administrators change quarantine period, session lifetimes, validity of iOS installation links, presets and maximum lifetime of share links, the default visibility of new applications, the reconciliation interval, the periods of the dashboard and name, notice, support contact and footer of the portal. Changes apply within seconds without a restart and are audited. The corresponding environment variables only seed the settings on the first start; the quarantine default follows decision E5 (7 days). Below, platform operations still see the start configuration of the service.
- GitHub Action in `src/action/` that uploads APK, AAB and IPA builds with dSYM, mapping and metadata files and optional release notes from workflows, authenticated by the OIDC token of the job, with streaming, retries and outputs for the release. Built with `npm run build:action`; CI checks that the committed `src/action/dist/` matches the sources.
- CI uploads in the portal (concept 4.7): applications name the repositories (by numeric id), branch or tag patterns and optional environments whose workflows may upload (tab „CI“, `applications.manage`, table `ci_bindings`). The routes under `/api/ci/` accept only the OIDC token of a GitHub Actions job, verified against the issuer's published keys (`CI_OIDC_ISSUER`, `CI_OIDC_AUDIENCE`, derived from `GITHUB_WEB_URL` and `PUBLIC_URL` by default). A job may create releases and upload files of its own application only, never delete or manage anything; releases record repository, branch or tag and workflow run, the audit log names the job (`actor_type = ci`). Release notes from CI only fill empty texts of drafts.
- Uploading a file that the release already holds unchanged succeeds without storing it again, so retried requests and re-run workflows do not fail.
- User administration (tab "Benutzer" of `/access.html`, reachable as `/access.html#benutzer`; `GET /api/user-directory`, `POST /api/users/:id/status`): everybody known to the platform with last sign-in and current roles, searchable and filterable by status. Platform-wide `permissions.manage` may disable an account, which ends its sessions at once, and enable it again; nobody can disable themselves or the last active platform administrator.
- Documentation page (`/docs.html`, navigation „Dokumentation“): getting started, installing on iPhone, iPad and Android, setting up CI uploads with common errors, and roles and permissions. The download page links to the installation help.
- Platform settings (`/settings.html`, `GET /api/platform-settings`, `storage.manage` at platform scope): version and the configuration the service runs with, each value with the environment variable that changes it; secrets are never shown.
- Flavor filter on the download page (`/apps.html?flavor=…`), shown when applications use flavors.
- Early purge from the storage view: users with `releases.purge` (platform administrators) can end the quarantine of a deletion job (`POST /api/deletion-jobs/:id/purge-now`, audit action `release.delete.expedited`); the worker deletes the files on its next run with the usual checks. The release can no longer be restored afterwards.
- Download page for signed-in employees (`/apps.html`, `GET /api/catalog`): the current release per flavor of every application they may install, with the iOS installation over short-lived links. Users without an administrative role start there instead of the administration.

### Changed

- `reference/` is excluded from ESLint and Prettier, as it holds reference material outside the build.
- `npm run build` builds the backend and the administration; `npm run dev:frontend` starts the Vite development server. Tests run in a backend (Node) and a frontend (happy-dom) project.
- `src/README.md` describes the layout of this platform instead of the template's contact example.
- `README.md`, `SECURITY.md` and `CONTRIBUTING.md` describe this platform: features, architecture, configuration and operation; the security model with its protections; project rules for migrations, permissions, API contracts, the interface and secrets.
- `.env.example` contains placeholders only; real values belong in the service environment or a local `.env`.
- The signed-in user and sign-out moved from the menu in the top bar to the foot of the sidebar. It shows the GitHub profile picture when one is available, the generic icon otherwise. The figures on the dashboard and the storage page carry icons. The navigation is grouped into Apps, Verwaltung, Betrieb and Hilfe; groups the user may not use disappear. Navigation, title and user no longer flicker when switching pages: an inline script paints them before the modules load, from a per-tab cache that the login page clears.
- Quarantined releases and artifacts are purged after 7 days instead of 14 (decision E5); `QUARANTINE_RETENTION_DAYS` still overrides the period.

### Removed

- Greeting example of the template.

[Unreleased]: https://github.com/lukas-kuntze/md-tool-distribution-portal/commits/HEAD
