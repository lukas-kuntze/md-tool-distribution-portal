<div align="center">

# Softwareentwicklung & IT-Dienstleistungen Kuntze

**DevX Template: TypeScript**  
A maintainable, well-tested foundation for building applications and libraries in TypeScript.

</div>

---

## Overview

The **TypeScript** template provides a standardized, well-tested foundation for TypeScript projects.

Building upon the **DevX Template: Basic**, it adds a layered source structure, a reproducible Node 24 toolchain (TypeScript, Vitest), and enforced quality assurance while enhancing **Developer Experience (DevX)**. The included sources are a minimal, working reference. Replace the domain logic in `src/` with your own; the surrounding structure, tooling, and conventions remain identical.

---

## Getting Started

### 1. Clone the Repository

```bash
git clone git@github.com:lukas-kuntze/<repository>.git
cd <repository>
```

### 2. Initialize the Repository

Run the setup script once after cloning to configure the local development environment and activate the repository-managed Git hooks.

**Linux / macOS**

```bash
./scripts/setup.sh
```

**Windows (PowerShell)**

```powershell
./scripts/setup.ps1
```

The setup script configures the local Git environment, including the repository-managed Git hooks (`core.hooksPath`).

### 3. Install Dependencies

```bash
npm ci
```

A pre-configured [dev container](.devcontainer/devcontainer.json) is available for a reproducible environment.

---

## Scripts

- `npm run format` — Format the workspace with Prettier.
- `npm run format:check` — Verify formatting without writing changes.
- `npm run lint` — Lint the source with ESLint.
- `npm run typecheck` — Type-check the project without emitting output.
- `npm run test` — Run the test suite once with Vitest.
- `npm run test:watch` — Run the test suite in watch mode.
- `npm run coverage` — Run the test suite and enforce coverage thresholds.
- `npm run build` — Compile the TypeScript sources into `dist/`.
- `npm run all` — Run format, lint, typecheck, test, and build sequentially.

---

## Source Layout

Domain logic lives in `src/` and is covered by colocated unit tests (`<module>.test.ts`). The build output in `dist/` is generated and therefore excluded from version control.

The normative source layout, dependency rules, and conventions are documented in [src/README.md](src/README.md).

---

## Documentation

- [CHANGELOG.md](CHANGELOG.md) — Notable changes per release.
- [CONTRIBUTING.md](CONTRIBUTING.md) — Contribution guidelines and development standards.
- [LICENSE](LICENSE) — Licensing information.
- [SECURITY.md](SECURITY.md) — Security policy and vulnerability reporting.
- [src/README.md](src/README.md) — Normative source layout and conventions.

---

## Additional Resources

- [Conventional Commits Specification](https://www.conventionalcommits.org/en/v1.0.0/)
- [Engineering Documentation](https://github.com/lukas-kuntze/kuntze-it-engineering-documentation)
- [GitHub Actions Documentation](https://docs.github.com/actions)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
