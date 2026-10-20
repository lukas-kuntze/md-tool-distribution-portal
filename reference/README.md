# Source Layout

This document defines the source code structure of this repository. The structure is **normative**; it follows the source layout of the **DevX Template: TypeScript**, applied to this project.

The layering follows hexagonal / Clean Architecture as specified in the organisation-wide [engineering documentation](https://github.com/lukas-kuntze/kuntze-it-engineering-documentation).

---

## The Rule

Every project follows a single rule:

> **The layers are always named the same. A level above them exists only where it separates something.**

The layer directories — `domain/`, `application/`, `adapters/`, `config/`, `shared/` — are identical in every project and at every stage. What varies is only how deeply they are nested, and each enclosing level answers a real question: _is there a frontend?_ and _are there modules?_ A directory that separates nothing is not created.

This repository has a frontend (the website) and a backend (the contact API), so it is at **stage 2 — full-stack application without modules**. Stage 1 (layers directly under `src/`, no frontend) and stage 3 (base application with licensed feature modules) are described in the engineering documentation; they do not apply here. Do not pre-emptively adopt stage 3: the website has no feature modules.

---

## Stage 2 — Layout of This Repository

```text
src/
├── index.ts                    # Backend entry point. Bootstrap only: load config, start the server.
├── instrument.ts               # Preloaded via `node --import`: initialises Sentry before Fastify is loaded.
├── frontend/                   # The website.
│   ├── pages/                  # One HTML file per public URL; subfolders (errors/) do not appear in the URL.
│   ├── partials/               # head, header, footer, body-end – inserted via <!-- @name --> markers.
│   ├── scripts/
│   │   ├── main.ts             # Frontend entry point. Imports the modules; contains no logic.
│   │   ├── core/               # App registry (App.register / App.init).
│   │   ├── modules/            # One behaviour module per interactive pattern.
│   │   └── testing/            # Test helpers (DOM). Not part of the build.
│   ├── services/               # API clients. The only place that calls the backend.
│   └── styles/                 # index.css, foundations/, components/, layout/.
├── backend/
│   ├── domain/
│   │   ├── value-objects/      # Contact request and the mail derived from it.
│   │   └── ports/              # MailSender, Logger, ErrorReporter.
│   ├── application/            # Use cases (submit contact request).
│   ├── adapters/
│   │   ├── http/               # Inbound: Fastify server, routes, request validation (Zod).
│   │   └── external/           # Outbound: SMTP mail sender, development log sender, Sentry error reporter.
│   └── config/                 # Environment variables, Sentry initialisation and the composition root.
└── shared/                     # Contracts shared by frontend and backend.
    ├── constants/              # Endpoint, contact topics, field limits.
    ├── dtos/                   # Request bodies.
    └── types/                  # API responses and error codes.
```

The backend keeps the layer structure of stage 1 unchanged inside `backend/`. Entries that the backend does not need yet — `domain/entities/`, `adapters/persistence/`, `db/` — are created at their prescribed location once the first entity, repository, or schema appears, never elsewhere.

In the frontend, pages, partials and styles are plain HTML and CSS; behaviour lives in TypeScript modules. A module registers itself with `App`, is imported by `main.ts`, and does nothing when its markup is missing on a page. Components never call the API directly; they go through `services/`.

---

## Dependency Direction

Within every stage, the layers obey a unidirectional rule. All dependencies point **inwards**; no inner layer may reference an outer one.

```text
index → { adapters, config } → application → domain
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
- **`domain/ports/`** shall declare interfaces only. Ports are owned by the domain, not by their implementations — this is what allows the dependency to be inverted.
- **`application/`** shall know ports and domain types exclusively, never a concrete implementation. Dependencies are received as constructor or function arguments, never imported.
- **`adapters/`** shall encapsulate all side effects (network, filesystem, database, process, clock, randomness). An adapter implements a port; it contains no business rules.
- **`config/`** is the composition root: the single place where concrete adapters are instantiated and passed into use cases. It is also the only place permitted to read environment variables.
- **`shared/`** shall contain declarations without behaviour. It is imported across boundaries and must therefore stay free of logic; a function that belongs to a layer belongs in that layer.

`frontend/` and `backend/` shall never import from one another. Their only common ground is `shared/`.

### The `db/` Exception

`db/` sits beside the layers rather than inside `adapters/`, and this is a deliberate exception to the rule above. Migrations are deployment artefacts executed before the application starts, not runtime adapters, and ORM tooling keeps them coupled to the schema definition. The exception extends to `db/` alone: no other infrastructure concern may be placed beside the layers on this precedent. Repository implementations remain in `adapters/persistence/` and continue to implement ports from `domain/ports/`.

---

## Control and Data Flow

```text
   Caller / Request                                        Result / Response
        │                                                          ▲
        ▼                                                          │
   ┌──────────────────────┐                          ┌─────────────┴────────┐
   │ Adapter (inbound)    │                          │ Adapter (inbound)    │
   │ adapters/http        │                          │ Result → DTO         │
   │ Input validation     │                          │                      │
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

In this repository: `adapters/http/contact-route.ts` validates `POST /api/contact`, `application/submit-contact-request.ts` composes and sends the mail through the `MailSender` port, and `adapters/external/smtp-mail-sender.ts` implements that port.

---

## Conventions

- Entries marked **(optional)** are part of the normative shape but are created only when needed. They are introduced at their prescribed location as soon as the first entity, value object, or port is modelled, the first use case is written, the first side effect occurs, the first environment access is required, the first schema is persisted, or the first cross-boundary contract appears — never elsewhere.
- The entrypoints (`src/index.ts` and `src/instrument.ts` for the backend, `src/frontend/scripts/main.ts` for the website) shall contain no logic; they perform bootstrap only and delegate immediately. They are excluded from coverage measurement precisely because they must not contain anything worth measuring.
- Tests are colocated with the code they cover and named `<module>.test.ts` (e.g. `application/submit-contact-request.test.ts` beside `application/submit-contact-request.ts`).
- Barrel files (re-exporting `index.ts` files inside subdirectories) shall not be used. Only the backend entrypoint is named `index.ts`; every other module is imported by its own path.
- Relative imports shall use explicit `.js` extensions, as required by `nodenext` module resolution with `verbatimModuleSyntax` in an ES module package (`"type": "module"`). TypeScript, Vite and tsx resolve them to the corresponding `.ts` sources.
- Type-only imports and exports shall be marked with `import type` / `export type`. `verbatimModuleSyntax` and `isolatedModules` make this mandatory rather than stylistic.
- Use cases shall return typed result objects. Mapping a result into a transport representation shall occur exclusively in an inbound adapter.
- Exported functions shall declare an explicit return type (`@typescript-eslint/explicit-function-return-type`).
- `any` is prohibited (`@typescript-eslint/no-explicit-any`); use `unknown` and narrow. Every promise shall be awaited or explicitly handled (`@typescript-eslint/no-floating-promises`).
- Diagnostic output shall not use `console` (`no-console`). Logging belongs behind a port, so that the domain does not depend on an output channel.
- Log entries and error reports shall not contain personal data. Visitor input (form fields, e-mail addresses, IP addresses) shall never be interpolated into error messages, log messages or error report context; refer to it by non-identifying attributes instead (e.g. the contact topic). Error messages are passed to the log and to Sentry verbatim — `scrubEvent` in `config/sentry.ts` removes request data, but cannot clean message text.
- Secrets and environment values shall never be read outside `config/`. Values required elsewhere are passed in as arguments.

The compiler options in [tsconfig.json](../tsconfig.json) are part of these conventions and shall not be relaxed: `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, and `noUnusedParameters` are enabled deliberately. `tsconfig.json` includes the DOM libraries for the frontend; the backend build ([tsconfig.backend.json](../tsconfig.backend.json)) restricts `lib` to `ES2024`, so backend code cannot use browser globals.

---

## Testing

Tests are executed by Vitest as configured in [vitest.config.ts](../vitest.config.ts), in two projects:

- **frontend** — `src/frontend/**/*.test.ts` in a DOM environment (happy-dom). Shared helpers live in `src/frontend/scripts/testing/`.
- **backend** — all other `src/**/*.test.ts` in the `node` environment. HTTP routes are tested with `fastify.inject`, without opening a port.
- **Coverage** — measured over `src/**/*.ts` by the V8 provider, excluding `*.d.ts`, `*.test.ts`, the entrypoints (`src/index.ts`, `src/instrument.ts`, `src/frontend/scripts/main.ts`), and the test helpers.
- **Thresholds** — 80 % lines, 80 % functions, 80 % statements, 75 % branches. `npm run coverage` fails below any of these.

`domain/` and `application/` shall be covered by direct unit tests without mocks; their purity is what makes this possible and is the reason the thresholds are attainable. Adapters are covered where the logic warrants it — an adapter that only forwards a call is not the place to spend the coverage budget.

---

## Build

`npm run build` produces two outputs:

- **Website** — Vite builds `src/frontend/pages/` into `dist/frontend/`: pages at the site root with partials inserted, bundled and hashed CSS and JavaScript, and the files from `public/` copied unchanged.
- **Backend** — `tsc -p tsconfig.backend.json` compiles `src/index.ts`, `src/instrument.ts`, `src/backend/`, and `src/shared/` into `dist/backend/` (ES modules with source maps, tests excluded). `npm run start` runs it with `instrument.js` preloaded.

`npm run typecheck` runs against [tsconfig.json](../tsconfig.json), which covers all sources and `*.config.ts` at the repository root and emits nothing. Type checking therefore covers configuration files that the build itself does not compile.

`dist/` is generated output and excluded from version control.
