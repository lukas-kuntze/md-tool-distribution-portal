<div align="center">

# MEDIFOX DAN

**MD Tool Distribution Portal**  
Internal distribution platform for Android and iOS apps built with Flutter or .NET MAUI, succeeding HockeyKit.

</div>

---

## Overview

The portal distributes the apps developed at MEDIFOX DAN to testers, employees and customers. Builds (APK, AAB, IPA and supporting files such as dSYM or mapping files) are uploaded per application and flavor, grouped into releases, published and installed directly on the device — on iOS over `itms-services`.

Main features:

- **Projects, applications and flavors** — Flutter flavors or .NET MAUI build variants with their own package names and bundle identifiers, frozen once a release exists.
- **Release lifecycle** — drafts, publishing, withdrawing, deletion through a quarantine with a restore period, and removal of single artifacts.
- **Roles and permissions** — scoped to the platform, a project or an application, inherited downwards; see [docs/rollen-und-berechtigungen.md](docs/rollen-und-berechtigungen.md).
- **CI uploads** — workflows upload builds through the GitHub Action in [src/action/](src/action/README.md), authenticated by the OIDC token of the job; each application names the repositories, branches or tags and environments it accepts (tab „CI“). Repeated uploads of the same file are recognised, so re-running a workflow is safe.
- **Download page** (`/apps.html`) — signed-in employees install the current version of every app they may use, without the administration.
- **Share links** — customers without an account receive a secret, optionally time-limited link to a project or an application.
- **Presentation** — icons for applications and projects, installation notes and the order of flavors.
- **Operations** — dashboard, append-only audit log, storage usage and a daily reconciliation between database and file system.

Sign-in uses GitHub (github.com or GitHub Enterprise); membership in the configured organisation is required, while permissions come exclusively from roles in the portal.

---

## Architecture

| Part           | Technology                                         | Location                       |
| -------------- | -------------------------------------------------- | ------------------------------ |
| Web service    | Node.js 24, Fastify, Zod                           | `src/index.ts`, `src/backend/` |
| Worker         | Deletion workflow and storage reconciliation       | `src/worker.ts`                |
| Persistence    | SQLite (`better-sqlite3`), forward-only migrations | `src/backend/db/`              |
| Artifact store | Local file system (NTFS), outside every webroot    | `STORAGE_ROOT`                 |
| Administration | Vite multi-page build, company styleguide          | `src/frontend/`                |
| Shared types   | API contracts used by backend and frontend         | `src/shared/`                  |

The backend follows a hexagonal structure: `domain/` and `application/` are free of I/O, adapters implement the ports. The normative layout, dependency rules and control flows are documented in [src/README.md](src/README.md); the design decisions in the [architecture concept](docs/architecture/architekturkonzept.md).

---

## Getting Started

### 1. Clone the Repository

```bash
git clone git@github.com:lukas-kuntze/md-tool-distribution-portal.git
cd md-tool-distribution-portal
```

### 2. Initialize the Repository

Run the setup script once after cloning to activate the repository-managed Git hooks (`core.hooksPath`).

**Linux / macOS**

```bash
./scripts/setup.sh
```

**Windows (PowerShell)**

```powershell
./scripts/setup.ps1
```

### 3. Install Dependencies

```bash
npm ci
```

Node.js 24 or newer is required. The [dev container](.devcontainer/devcontainer.json) provides a reproducible environment and is the recommended way to run Node locally.

### 4. Configure

Web service and worker read their configuration from environment variables only; invalid or missing values stop them at startup with the names of the offending variables. Locally, copy [.env.example](.env.example) to `.env`, fill in the values and pass the file to Node (see below). The essentials:

- **GitHub OAuth app** with scope `read:org` and callback URL `<PUBLIC_URL>/auth/github/callback`; set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_ORGANIZATION` and, for GitHub Enterprise, `GITHUB_WEB_URL`.
- **`BOOTSTRAP_ADMIN_GITHUB_IDS`** — numeric GitHub user ids of the first platform administrators.
- **`INSTALL_LINK_SECRET`** — at least 32 random characters, e.g. `openssl rand -base64 48`.
- **CI uploads** — nothing to configure for github.com and GitHub Enterprise: the OIDC issuer follows from `GITHUB_WEB_URL`, the expected audience is the origin of `PUBLIC_URL`. Override with `CI_OIDC_ISSUER` and `CI_OIDC_AUDIENCE` only if needed. The service must reach the issuer over HTTPS to load its signing keys.
- **`DATABASE_PATH`, `STORAGE_ROOT`** — the storage root must not overlap with any directory listed in `SERVED_AREAS`.

`.env` is excluded from version control. Never put real values into `.env.example`.

### 5. Run Locally

Set `PUBLIC_URL=http://localhost:5173` in `.env`, then start each process in its own terminal:

```bash
npm run build:backend
node --env-file=.env dist/index.js    # web service on 127.0.0.1:3000
node --env-file=.env dist/worker.js   # deletion worker and storage reconciliation
npm run dev:frontend                  # administration on http://localhost:5173
```

The Vite development server forwards `/api/`, `/auth/`, `/install/` and `/public/` to the web service, so that cookies, the OAuth callback and the same-origin check behave as in production.

---

## Scripts

- `npm run format` — Format the workspace with Prettier.
- `npm run format:check` — Verify formatting without writing changes.
- `npm run lint` — Lint the sources with ESLint.
- `npm run typecheck` — Type-check all sources and configuration files without emitting output.
- `npm run test` — Run the backend and frontend test projects once with Vitest.
- `npm run test:watch` — Run the tests in watch mode.
- `npm run coverage` — Run the tests and enforce the coverage thresholds.
- `npm run dev:frontend` — Start the Vite development server for the administration.
- `npm run build` — Compile the backend into `dist/` and build the administration into `dist/frontend/`.
- `npm start` — Start the web service from `dist/`.
- `npm run start:worker` — Start the worker from `dist/`.
- `npm run all` — Run format check, lint, typecheck, coverage and build sequentially.

---

## Operation

The portal runs on Windows Server behind IIS:

- IIS terminates TLS, serves `dist/frontend/` as static site and forwards `/api/`, `/auth/`, `/install/` and `/public/` to the web service on `127.0.0.1`.
- Web service (`npm start`) and worker (`npm run start:worker`) run as two services with the same environment variables, set on the services rather than in files. Both apply pending database migrations on start.
- Artifacts, icons and the quarantine live below `STORAGE_ROOT`, outside every IIS webroot; the web service streams them only after its permission checks.
- The worker processes deletion jobs and reconciles database and file system every `RECONCILE_HOURS` (default 24); missing files are logged as errors.

All configuration variables with explanations are listed in [.env.example](.env.example).

---

## Documentation

- [CHANGELOG.md](CHANGELOG.md) — Notable changes per release.
- [CONTRIBUTING.md](CONTRIBUTING.md) — Contribution guidelines and development standards.
- [LICENSE](LICENSE) — Licensing information.
- [SECURITY.md](SECURITY.md) — Security model and vulnerability reporting.
- [src/README.md](src/README.md) — Normative source layout, conventions and control flows.
- [docs/architecture/architekturkonzept.md](docs/architecture/architekturkonzept.md) — Architecture concept (German).
- [docs/rollen-und-berechtigungen.md](docs/rollen-und-berechtigungen.md) — Roles and permissions (German).

---

## Additional Resources

- [Conventional Commits Specification](https://www.conventionalcommits.org/en/v1.0.0/)
- [Engineering Documentation](https://github.com/lukas-kuntze/kuntze-it-engineering-documentation)
- [Fastify Documentation](https://fastify.dev/docs/latest/)
- [GitHub Actions Documentation](https://docs.github.com/actions)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
