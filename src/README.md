# Source Layout

This document defines the source code structure of this repository. The structure is **normative**; it follows the source layout of the **DevX Template: TypeScript**, applied to this project. The architecture behind it is described in [docs/architecture/architekturkonzept.md](../docs/architecture/architekturkonzept.md).

The layering follows hexagonal / Clean Architecture as specified in the organisation-wide [engineering documentation](https://github.com/lukas-kuntze/kuntze-it-engineering-documentation).

---

## The Rule

Every project follows a single rule:

> **The layers are always named the same. A level above them exists only where it separates something.**

The layer directories — `domain/`, `application/`, `adapters/`, `config/`, `shared/` — are identical in every project and at every stage. What varies is only how deeply they are nested, and each enclosing level answers a real question: _is there a frontend?_ and _are there modules?_ A directory that separates nothing is not created.

This repository has a frontend (the administration) and a backend (administration API, artifact downloads, iOS installation, deletion worker), so it is at **stage 2 — full-stack application without modules**. Stage 1 (layers directly under `src/`, no frontend) and stage 3 (base application with licensed feature modules) are described in the engineering documentation; they do not apply here. Projects, releases and permissions are areas within the same layers, not modules; do not pre-emptively adopt stage 3.

---

## Stage 2 — Layout of This Repository

```text
src/
├── index.ts                    # Web service entry point. Bootstrap only: load config, start the server.
├── worker.ts                   # Deletion worker entry point (second process). Bootstrap only.
├── action/                     # GitHub Action that uploads builds from workflows (third entry point, see below).
├── frontend/                   # The administration, served as static files.
│   ├── pages/                  # One HTML file per URL: index (dashboard), projects, project, application, release,
│   │                           # access, audit, storage, login. share is the public page for share links. Detail pages take the object id as `?id=`.
│   ├── partials/               # head, shell-start, shell-end, scripts – inserted via <!-- @name --> markers.
│   ├── assets/                 # Self-hosted fonts of the styleguide (no external CDN).
│   ├── scripts/
│   │   ├── main.ts             # Frontend entry point. Imports styles and modules; contains no logic.
│   │   ├── core/               # App registry (App.register / App.init) and helpers shared by the modules:
│   │   │                       # DOM construction, forms, formats, labels, German error messages.
│   │   ├── modules/            # One behaviour module per interactive pattern: the styleguide's overlays,
│   │   │                       # tabs, dropdown, toast, theme, clipboard; shell, role assignments, audit log;
│   │   │                       # and one module per page.
│   │   └── testing/            # Test helpers (pages with partials, fake API, fixtures). Not part of the build.
│   ├── services/               # API clients. The only place that calls the backend.
│   └── styles/                 # index.css, foundations/, layout/, components/ – taken from the styleguide.
├── backend/
│   ├── domain/
│   │   ├── entities/           # Project, Application and flavors, Release, ReleaseArtifact, DeletionJob,
│   │   │                       # RoleAssignment, User, Session – state machines and invariants.
│   │   ├── value-objects/      # Identifiers, Slug, FlavorKey, BundleIdentifier, Version, BuildNumber, Permission,
│   │   │                       # Scope, StorageKey, EffectivePermissions, DomainError.
│   │   └── ports/              # Repositories, UnitOfWork, ArtifactStorage, AuditLog, IdentityProvider, Clock,
│   │                           # IdGenerator, TokenGenerator, TokenSigner, Logger.
│   ├── application/            # Use cases: manage projects, applications, releases and access, sign in, download,
│   │                           # install on iOS, request/process/restore deletions, read the audit log.
│   ├── adapters/
│   │   ├── http/               # Inbound: Fastify server, routes, request validation (Zod), presenters.
│   │   ├── persistence/        # Outbound: SQLite repositories and the unit of work.
│   │   ├── scheduler/          # Inbound: the polling loop of the deletion worker.
│   │   └── external/           # Outbound: file-system artifact storage and path resolver, GitHub sign-in,
│   │                           # token generator and signer, clock, UUIDv7 ids, JSON logger.
│   ├── config/                 # Environment variables and the composition root.
│   └── db/                     # Schema migrations (documented exception, see below).
└── shared/                     # Contracts shared by frontend and backend.
    ├── constants/              # Input formats for immediate feedback (slug, flavor key, identifiers, lengths).
    └── types/                  # API responses and error bodies.
```

`shared/dtos/` (request bodies) is part of the normative shape but not created yet: request bodies are defined by the Zod schemas of the routes, and the frontend services state the fields they send.

In the frontend, pages, partials and styles are plain HTML and CSS; behaviour lives in TypeScript modules. A module registers itself with `App`, is imported by `main.ts`, and does nothing when its markup is missing on a page. Pages and modules never call the API directly; they go through `services/`. Content from the API is always inserted as text (`core/dom.ts`), never as HTML.

The interface hides actions the user may not take, based on the `capabilities` the API returns; this is for orientation only. Every check happens on the server.

---

## Dependency Direction

Within every stage, the layers obey a unidirectional rule. All dependencies point **inwards**; no inner layer may reference an outer one.

```text
index / worker → { adapters, config } → application → domain
                                                       ▲
                             adapters ┄┄ implements ┄┄┄┘ (domain/ports)
```

| Layer          | May depend on                          | Must not depend on                                  |
| -------------- | -------------------------------------- | --------------------------------------------------- |
| `domain/`      | nothing                                | any other layer, any runtime library, `process.env` |
| `application/` | `domain/` (entities, ports)            | `adapters/`, `config/`, concrete implementations    |
| `adapters/`    | `domain/ports/`, `shared/`             | `application/` internals, other adapters' internals |
| `config/`      | `domain/`, `application/`, `adapters/` | —                                                   |
| `shared/`      | nothing                                | every other layer                                   |

- **`domain/`** shall remain pure. It shall not import runtime frameworks, access `process.env`, perform I/O, or read the clock directly. It receives typed input and returns typed output and is therefore unit-testable without mocks.
- **`domain/ports/`** shall declare interfaces only. Ports are owned by the domain, not by their implementations — this is what allows the dependency to be inverted. Repository ports are synchronous, because `better-sqlite3` is; file operations run outside database transactions.
- **`application/`** shall know ports and domain types exclusively, never a concrete implementation. Dependencies are received as function arguments, never imported.
- **`adapters/`** shall encapsulate all side effects (network, filesystem, database, process, clock, randomness). An adapter implements a port; it contains no business rules.
- **`config/`** is the composition root: the single place where concrete adapters are instantiated and passed into use cases. It is also the only place permitted to read environment variables.
- **`shared/`** shall contain declarations without behaviour. It is imported across boundaries and must therefore stay free of logic; a function that belongs to a layer belongs in that layer. The domain does not import `shared/`, so the formats in `shared/constants/` mirror the value objects and must change together with them.

`frontend/` and `backend/` shall never import from one another. Their only common ground is `shared/`.

### The `db/` Exception

`db/` sits beside the layers rather than inside `adapters/`, and this is a deliberate exception to the rule above. Migrations are deployment artefacts executed before the application starts, not runtime adapters. The exception extends to `db/` alone: no other infrastructure concern may be placed beside the layers on this precedent. Repository implementations remain in `adapters/persistence/` and continue to implement ports from `domain/ports/`.

### The GitHub Action

`action/` is not part of the portal: it runs in the workflows of the app repositories on GitHub Actions and talks to the portal over HTTP only. It therefore imports nothing from `backend/`, `frontend/` or `shared/`, uses Node built-ins only and is compiled on its own (`npm run build:action`) into `action/dist/`, which is committed. Its contract with the portal is described in [action/README.md](action/README.md).

### The Second Entry Point

`worker.ts` runs the deletion workflow (quarantine, purge, retries) as a process of its own, so that it does not depend on IIS recycling the web service. Like `index.ts` it contains bootstrap only, uses the same composition root and is excluded from coverage.

---

## Control and Data Flow

```text
   Caller / Request                                        Result / Response
        │                                                          ▲
        ▼                                                          │
   ┌──────────────────────┐                          ┌─────────────┴────────┐
   │ Adapter (inbound)    │                          │ Adapter (inbound)    │
   │ adapters/http        │                          │ Result → DTO         │
   │ Input validation     │                          │ (presenters)         │
   └──────────┬───────────┘                          └─────────────▲────────┘
              │ invokes                                            │ returns
              ▼                                                    │
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  Use Case (application/)                                                 │
   │  Orchestrates the flow. Knows ONLY ports and domain types.               │
   └─────────┬──────────────────────────────┬─────────────────────────────────┘
             │ uses                         │ uses
             ▼                              ▼
   ┌────────────────────┐         ┌────────────────────┐
   │ Port (interface)   │         │ Domain (entities,  │
   │ domain/ports       │         │ value objects)     │
   └─────────▲──────────┘         └────────────────────┘
             ┊ implements  (dependency inversion)
   ┌─────────┴──────────┐
   │ Adapter (outbound) │
   │ adapters/*         │
   └────────────────────┘
```

1. An inbound adapter accepts external input, validates it, and converts it into domain or DTO types.
2. It invokes a use case in `application/`, passing the outbound adapters it was wired with in `config/`.
3. The use case executes domain rules and reaches the outside world exclusively through ports.
4. The use case returns a typed result. Translation back into the transport format occurs in the inbound adapter, never in `application/` or `domain/`.

The result is that domain and use cases can be tested without any test double for the framework, and that the framework can be exchanged without touching business rules.

In this repository, deleting a release runs like this: the release page (`frontend/scripts/modules/release-page.ts`) sends the typed confirmation through `frontend/services/release-service.ts`; `adapters/http/routes/release-routes.ts` validates `DELETE /api/releases/:id`; `application/submit-release-deletion.ts` checks `releases.delete` in the scope, moves the release to `pending_deletion` and records a deletion job and audit entry in one transaction; the worker later processes the job through `application/process-next-deletion-job.ts` and the `ArtifactStorage` port, implemented by `adapters/external/file-system-artifact-storage.ts`.

### iOS Installation

iOS loads the `itms-services` manifest and the IPA without the browser's cookies. The release page therefore asks `POST /api/artifacts/:id/install-link` for a short-lived link; `application/install-ios-artifact.ts` signs the artifact, the user and the expiry through the `TokenSigner` port (HMAC, `adapters/external/hmac-token-signer.ts`). `GET /install/<token>/manifest.plist` and `GET /install/<token>/app.ipa` verify the token and re-check the user, the permissions and the release state on every request, so a deletion or a revoked role ends an issued link at once.

### Share Links

Customers without an account open `share.html#<secret>`. The page (`frontend/scripts/modules/share-page.ts`) loads `GET /public/shares/<secret>`, the only routes that need no session. `application/open-share.ts` finds the link by the hash of the secret and shows only published, active releases with installable artifacts; downloads and the iOS manifest live under the same prefix, because iOS sends no cookies. Links are managed in the "Freigaben" tabs through `application/manage-share-links.ts`, which requires `shares.manage`.

### Download Page and Presentation

Signed-in employees install from `apps.html`, which loads `GET /api/catalog` (`application/get-catalog.ts`): every active application with visibility `organization` or an `artifacts.download` grant, with the newest published release per flavor. The selection is the same as on share links (`publishedApplication` in `application/open-share.ts`), and both pages render it through `frontend/scripts/modules/published-apps.ts`; IPAs on the download page request a signed installation link per tap. Users whose roles allow nothing beyond reading and downloading (`administers` in the session) are sent there from the dashboard.

Icons of applications and projects, installation notes and flavor order are managed in `application/manage-presentation.ts`. Icons are checked by their magic bytes, stored below `assets/<application or project>/<asset>.png|jpg` through the `ArtifactStorage` port and served with a content hash in the URL, so browsers may cache them. An asset belongs to exactly one application or one project (`adapters/persistence/sqlite-assets.ts`).

### Storage Reconciliation

`application/reconcile-storage.ts` compares the artifacts in the database with `ArtifactStorage.inventory()`, i.e. everything below `objects/` and `quarantine/`. Stored artifacts without their file, or with a different size, become `missing`; missing ones whose file is back become `stored` again; unknown entries are only reported. Each run is kept in `storage_reports` and audited. The worker loop runs it whenever the last report is older than `RECONCILE_HOURS`; the storage view starts it on demand (`POST /api/storage/reconcile`, `storage.manage`).

---

## Conventions

- Entries marked as not yet created are part of the normative shape but are created only when needed, at their prescribed location — never elsewhere.
- The entrypoints (`src/index.ts` and `src/worker.ts` for the backend, `src/frontend/scripts/main.ts` for the administration) shall contain no logic; they perform bootstrap only and delegate immediately. They are excluded from coverage measurement precisely because they must not contain anything worth measuring.
- Tests are colocated with the code they cover and named `<module>.test.ts` (e.g. `adapters/http/routes/install-routes.test.ts` beside `install-routes.ts`).
- Barrel files (re-exporting `index.ts` files inside subdirectories) shall not be used. Only the backend entrypoint is named `index.ts`; every other module is imported by its own path.
- Relative imports shall use explicit `.js` extensions, as required by `nodenext` module resolution with `verbatimModuleSyntax` in an ES module package (`"type": "module"`). TypeScript and Vite resolve them to the corresponding `.ts` sources.
- Type-only imports and exports shall be marked with `import type` / `export type`. `verbatimModuleSyntax` and `isolatedModules` make this mandatory rather than stylistic.
- Use cases shall return typed result objects. Mapping a result into a transport representation shall occur exclusively in an inbound adapter.
- Exported functions shall declare an explicit return type (`@typescript-eslint/explicit-function-return-type`).
- `any` is prohibited (`@typescript-eslint/no-explicit-any`); use `unknown` and narrow. Every promise shall be awaited or explicitly handled (`@typescript-eslint/no-floating-promises`).
- Diagnostic output shall not use `console` (`no-console`). Logging belongs behind the `Logger` port; the frontend reports failing modules through `reportError`.
- Log entries shall not contain personal data. GitHub logins, client addresses and reasons belong to the audit log in the database only; diagnostic logs refer to ids. Error messages of the domain describe the rule, never the offending input.
- The user interface is German, the API answers in English; `frontend/scripts/core/messages.ts` maps error codes to German texts.
- Secrets and environment values shall never be read outside `config/`. Values required elsewhere are passed in as arguments.

The compiler options in [tsconfig.json](../tsconfig.json) are part of these conventions and shall not be relaxed: `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, and `noUnusedParameters` are enabled deliberately. `tsconfig.json` includes the DOM libraries for the frontend; the backend build ([tsconfig.build.json](../tsconfig.build.json)) restricts `lib` to `ES2024` and leaves out `src/frontend/`, so backend code cannot use browser globals.

---

## Testing

Tests are executed by Vitest as configured in [vitest.config.ts](../vitest.config.ts), in two projects:

- **frontend** — `src/frontend/**/*.test.ts` in a DOM environment (happy-dom). Page tests load the real page with its partials (`scripts/testing/page.ts`), answer API calls with a fake `fetch` and drive the page like a user.
- **backend** — all other `src/**/*.test.ts` in the `node` environment. HTTP routes are tested with `fastify.inject`, without opening a port, against a temporary SQLite database and storage root (`adapters/http/testing/http-fixture.ts`).
- **Coverage** — measured over `src/**/*.ts` by the V8 provider, excluding `*.d.ts`, `*.test.ts`, the entrypoints (`src/index.ts`, `src/worker.ts`, `src/frontend/scripts/main.ts`), and the test helpers (`**/testing/**`).
- **Thresholds** — 80 % lines, 80 % functions, 80 % statements, 75 % branches. `npm run coverage` fails below any of these.

`domain/` and `application/` shall be covered by direct unit tests without mocks; their purity is what makes this possible and is the reason the thresholds are attainable. Adapters are covered where the logic warrants it — an adapter that only forwards a call is not the place to spend the coverage budget.

---

## Build, Development and Operation

`npm run build` produces two outputs:

- **Backend** (`npm run build:backend`) — `tsc -p tsconfig.build.json` compiles `src/index.ts`, `src/worker.ts`, `src/backend/` and `src/shared/` into `dist/` (ES modules with source maps, tests excluded). `npm start` runs the web service, `npm run start:worker` the deletion worker.
- **Administration** (`npm run build:frontend`) — Vite ([vite.config.ts](../vite.config.ts)) builds `src/frontend/pages/` into `dist/frontend/`: pages at the site root with partials inserted, and bundled, hashed CSS, JavaScript and fonts.

In operation, IIS serves `dist/frontend/` as static site and forwards `/api/`, `/auth/`, `/install/` and `/public/` to the web service on localhost. Artifacts are never served by IIS; the web service streams them after its checks.

For development, start the web service with `PUBLIC_URL=http://localhost:5173` and run `npm run dev:frontend`: the Vite server delivers the pages and forwards the backend paths to `http://127.0.0.1:3000`, so that cookies, the OAuth callback and the same-origin check of the API match.

`npm run typecheck` runs against [tsconfig.json](../tsconfig.json), which covers all sources and `*.config.ts` at the repository root and emits nothing. Type checking therefore covers configuration files that the build itself does not compile.

`dist/` is generated output and excluded from version control.
