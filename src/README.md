# Source Layout

This document defines the source code structure for TypeScript projects created from the **DevX Template: TypeScript**. The structure is **normative** and applies to every project regardless of its size or delivery format.

The layering follows hexagonal / Clean Architecture as specified in the organisation-wide [engineering documentation](https://github.com/lukas-kuntze/kuntze-it-engineering-documentation). A project built on this template is therefore structured from day one so that it can grow into a modular application without its layers ever being renamed or rearranged internally.

---

## The Rule

Every project follows a single rule:

> **The layers are always named the same. A level above them exists only where it separates something.**

The layer directories — `domain/`, `application/`, `adapters/`, `config/`, `shared/` — are identical in every project and at every stage. What varies is only how deeply they are nested, and each enclosing level answers a real question: _is there a frontend?_ and _are there modules?_ A directory that separates nothing is not created.

This yields three stages. A project starts at the stage it needs and moves up when — and only when — the answer to one of those questions changes.

---

## Stage 1 — Library, CLI, or Service

No frontend, no module system. The layers sit directly under `src/`. **This is the stage this template itself occupies.**

```text
src/
├── index.ts                # Entrypoint. Public API surface (library) or bootstrap (service).
├── domain/                 # Innermost layer. Pure business model, free of dependencies.
│   ├── entities/           # (optional) Objects with identity and lifecycle.
│   ├── value-objects/      # (optional) Immutable objects defined solely by their value.
│   └── ports/              # (optional) Interfaces required by the domain and the use cases.
├── application/            # (optional) Use cases. Orchestrate the domain, depend only on ports.
│   ├── <use-case>.ts
│   └── <use-case>.test.ts
├── adapters/               # (optional) Port implementations. All side effects reside here.
│   ├── http/               # Inbound: controllers, route handlers, request validation.
│   ├── persistence/        # Outbound: repositories implementing the domain ports.
│   └── external/           # Outbound: third-party APIs, filesystem, mail, process execution.
├── config/                 # (optional) Configuration loading and the composition root.
├── db/                     # (optional) Schema, migrations, ORM configuration. See below.
└── shared/                 # (optional) Cross-cutting contracts without behaviour.
    ├── dtos/               # Data transfer objects used at the system boundaries.
    ├── types/              # Shared type declarations.
    └── constants/          # Error codes, defaults, and other fixed values.
```

At this stage `shared/` holds contracts crossing _layer_ boundaries. From stage 2 onwards it holds contracts crossing the _frontend/backend_ boundary — the directory keeps its name, but its meaning narrows to that one boundary.

## Stage 2 — Full-Stack Application without Modules

A frontend exists, so a level separating it from the backend is justified.

```text
src/
├── index.ts                # Application entry point.
├── frontend/
│   ├── components/         # Shared UI.
│   ├── pages/
│   ├── hooks/
│   ├── services/           # API client. Components never call the API directly.
│   ├── styles/
│   └── types/
├── backend/
│   ├── domain/             # ─┐
│   ├── application/        #  │ identical to stage 1,
│   ├── adapters/           #  │ unchanged internally
│   ├── config/             # ─┘
│   └── db/                 # (optional) Schema, migrations, ORM configuration. See below.
└── shared/                 # Contracts shared by frontend and backend.
    ├── dtos/
    ├── types/
    └── constants/
```

## Stage 3 — Modular Application

Feature modules are licensed, built, and delivered individually. A level separating the base application from the modules is justified.

```text
src/
├── core/                       # Base application.
│   ├── frontend/               # ─┐
│   ├── backend/                #  │ identical to stage 2,
│   └── shared/                 # ─┘ unchanged internally
├── modules/                    # Feature modules. Self-contained full-stack units.
│   └── <id>/                   # Directory name = module ID = table prefix = route base.
│       ├── module.config.ts    # Manifest. Data only — no framework imports.
│       ├── frontend/           # index.ts exports routes and widgets.
│       ├── backend/            # index.ts exports registerRoutes, lifecycle, registerEvents.
│       └── shared/             # Module-local contracts.
├── module-loader/              # ModuleScanner, ModuleRegistry, ModuleSource, LicenseChecker.
└── index.ts                    # Application entry point.
```

A module repeats the layer structure of stage 1 inside its own `backend/`. It reaches the base application exclusively through the `ModuleContext`; direct imports from `core/` are prohibited. The full contract — manifest fields, `apiVersion`, lifecycle hooks, event bus, licensing, table prefixes, and user-deletion strategies — is **not** part of this template; it is defined in the organisation-wide [engineering documentation](https://github.com/lukas-kuntze/kuntze-it-engineering-documentation).

---

## Moving Between Stages

Because the layer directories are unchanged internally, moving up a stage is a relocation, not a restructuring:

```text
Stage 1 → 2:   src/{domain,application,adapters,config}   →  src/backend/
               src/shared                                 →  src/shared/      (unchanged path)

Stage 2 → 3:   src/{frontend,backend,shared}              →  src/core/
```

Both steps are a `git mv` plus an import-path update; no file changes its content or its role. Perform such a move as a separate commit (`refactor:`) that contains nothing else, so the diff stays reviewable.

Do not pre-emptively adopt a higher stage. An empty `core/` in a project without modules, or a `backend/` in a project without a frontend, names a distinction that does not exist — and a convention that is visibly pointless in most repositories stops being followed in the ones where it matters.

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

From stage 2 onwards, `frontend/` and `backend/` shall never import from one another. Their only common ground is `shared/`.

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

---

## Conventions

- Entries marked **(optional)** are part of the normative shape but are created only when needed. They are introduced at their prescribed location as soon as the first entity, value object, or port is modelled, the first use case is written, the first side effect occurs, the first environment access is required, the first schema is persisted, or the first cross-boundary contract appears — never elsewhere.
- The entrypoint (`index.ts`) shall contain no logic. In a library it re-exports the public API so that importing it produces no side effects; in an application it performs bootstrap only and delegates immediately. It is excluded from coverage measurement precisely because it must not contain anything worth measuring.
- What `index.ts` does not export is internal. Consumers rely on the package entry (`exports` in `package.json`), which resolves to `dist/index.js` and `dist/index.d.ts`.
- Tests are colocated with the code they cover and named `<module>.test.ts` (e.g. `application/register-user.test.ts` beside `application/register-user.ts`).
- Barrel files (re-exporting `index.ts` files inside subdirectories) shall not be used. Only the root entrypoint is named `index.ts`; every other module is imported by its own path. From stage 3 onwards, `modules/<id>/{frontend,backend}/index.ts` is the sole exception — the module contract requires those exact entry points.
- Relative imports shall use explicit `.js` extensions, as required by `nodenext` module resolution with `verbatimModuleSyntax` in an ES module package (`"type": "module"`). TypeScript resolves them to the corresponding `.ts` sources.
- Type-only imports and exports shall be marked with `import type` / `export type`. `verbatimModuleSyntax` and `isolatedModules` make this mandatory rather than stylistic.
- Use cases shall return typed result objects. Mapping a result into a transport representation shall occur exclusively in an inbound adapter.
- Exported functions shall declare an explicit return type (`@typescript-eslint/explicit-function-return-type`).
- `any` is prohibited (`@typescript-eslint/no-explicit-any`); use `unknown` and narrow. Every promise shall be awaited or explicitly handled (`@typescript-eslint/no-floating-promises`).
- Diagnostic output shall not use `console` (`no-console`). Logging belongs behind a port, so that the domain does not depend on an output channel.
- Secrets and environment values shall never be read outside `config/`. Values required elsewhere are passed in as arguments.

The compiler options in [tsconfig.json](../tsconfig.json) are part of these conventions and shall not be relaxed per project: `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, and `noUnusedParameters` are enabled deliberately. `lib` is restricted to `ES2024`, so DOM globals are unavailable — a project reaching stage 2 must extend `lib` for its `frontend/` sources.

---

## Testing

Tests are executed by Vitest as configured in [vitest.config.ts](../vitest.config.ts):

- **Discovery** — `src/**/*.test.ts`. Tests outside `src/` are not collected.
- **Environment** — `node`. No browser environment is provided; stage 2 requires an added environment for frontend tests.
- **Coverage** — measured over `src/**/*.ts` by the V8 provider, excluding `*.d.ts`, `*.test.ts`, and `src/index.ts`.
- **Thresholds** — 80 % lines, 80 % functions, 80 % statements, 75 % branches. `npm run coverage` fails below any of these.

`domain/` and `application/` shall be covered by direct unit tests without mocks; their purity is what makes this possible and is the reason the thresholds are attainable. Adapters are covered where the logic warrants it — an adapter that only forwards a call is not the place to spend the coverage budget.

---

## Build

`npm run build` compiles `src/` to `dist/` with `tsc -p tsconfig.build.json`:

- **Output** — ES modules mirroring the `src/` tree, plus `.d.ts` declarations, declaration maps, and source maps.
- **Excluded** — `**/*.test.ts`. Tests never reach the published output.
- **Consumed as** — `dist/index.js` (`main`, `exports.default`) and `dist/index.d.ts` (`types`). Only `dist/` is listed in `files`.

`npm run typecheck` runs against [tsconfig.json](../tsconfig.json), which additionally includes `*.config.ts` at the repository root and emits nothing. Type checking therefore covers configuration files that the build itself does not compile.

A project at stage 2 or 3 replaces this build: the frontend requires a bundler, and stage 3 selects the modules to include at build time. `tsc` alone is sufficient only for stage 1.

`dist/` is generated output and excluded from version control.
