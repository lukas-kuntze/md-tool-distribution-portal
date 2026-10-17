# Contributing

Thank you for your interest in contributing.

This document defines the contribution process and development standards for the **DevX Template: TypeScript** and repositories created from it. Following these guidelines helps ensure consistent development practices, maintainability, and code quality.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Commit Messages](#commit-messages)
  - [Format](#format)
  - [Examples](#examples)
  - [Supported Types](#supported-types)
  - [Merge Commits](#merge-commits)
- [Branch Naming](#branch-naming)
  - [Format](#format-1)
  - [Examples](#examples-1)
  - [Supported Prefixes](#supported-prefixes)
- [Local Validation](#local-validation)
- [Pull Requests](#pull-requests)
- [Questions](#questions)

---

## Development Setup

Clone the repository:

```bash
git clone git@github.com:lukas-kuntze/<repository>.git
cd <repository>
```

Initialize the local development environment.

**Linux / macOS**

```bash
./scripts/setup.sh
```

**Windows (PowerShell)**

```powershell
./scripts/setup.ps1
```

The setup script configures the local Git environment, including the repository-managed Git hooks.

Install the project dependencies:

```bash
npm ci
```

Node.js 24 or newer is required. A pre-configured [dev container](.devcontainer/devcontainer.json) is available for a reproducible environment.

---

## Commit Messages

Commit messages **shall** comply with the
[Conventional Commits Specification](https://www.conventionalcommits.org/en/v1.0.0/).

### Format

```text
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Examples

```text
feat(auth): add OAuth2 authentication
fix(api): correct response validation
docs(readme): update installation guide
refactor(core): simplify configuration loading
chore(deps): update project dependencies
```

### Supported Types

- **build** — Build system or dependency changes
- **chore** — Repository maintenance or tooling
- **ci** — Continuous Integration changes
- **docs** — Documentation updates
- **feat** / **feature** — New functionality
- **fix** — Bug fixes
- **perf** — Performance improvements
- **refactor** — Code restructuring without functional changes
- **revert** — Revert previous changes
- **style** — Formatting or stylistic changes
- **test** — Test additions or modifications

Commit message compliance is verified locally by the repository-managed `commit-msg` Git hook.

### Merge Commits

Merge commits are **not** exempt from these requirements. The `commit-msg` hook is invoked by `git merge` in addition to `git commit`, and the message Git generates automatically (`Merge branch 'main' into <branch>`) does not comply with the specification and will therefore be rejected.

When integrating the target branch into a feature branch, either provide a compliant message explicitly:

```bash
git merge main -m "chore: merge main into <branch>"
```

Or rebase instead, which avoids creating a merge commit altogether:

```bash
git rebase main
```

---

## Branch Naming

Branch names **shall** follow a consistent naming convention.

### Format

```text
<type>/<short-description>
```

### Examples

```text
feat/add-authentication
fix/login-validation
docs/update-readme
refactor/config-loading
chore/update-dependencies
```

### Supported Prefixes

```text
build/
chore/
ci/
docs/
feat/
feature/
fix/
perf/
refactor/
revert/
style/
test/
```

The description following the prefix shall consist of lower-case letters, digits, dots, hyphens, and underscores.

Branches created by automated dependency updates are exempt from this convention, because their names are dictated by the
tool rather than by the contributor:

```text
dependabot/<ecosystem>/<dependency>-<version>
```

Branch name compliance is verified locally by the repository-managed `pre-push` Git hook. Because the hook runs before the branch reaches the remote, a rejected branch can be renamed without any further consequences:

```bash
git branch -m <new-name>
```

---

## Local Validation

Run the full validation chain before pushing:

```bash
npm run all
```

This executes formatting, linting, type checking, tests, and the build in sequence — the same checks the Continuous Integration workflow performs. Individual steps are available as separate scripts (`npm run format`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run coverage`, `npm run build`); see the [README](README.md#scripts) for the complete list.

New or modified domain logic in `src/` **shall** be covered by colocated unit tests (`<module>.test.ts`). Coverage thresholds are enforced by `npm run coverage`.

The normative source layout, dependency direction, and conventions are documented in [src/README.md](src/README.md) and **shall** be observed when adding modules.

---

## Pull Requests

Before submitting a pull request, ensure that:

- The branch is up to date with the target branch.
- The pull request title follows one of the approved naming conventions:
  - `<type>: <description>` (Conventional Commits)
  - `[ISSUE-XXXX] — <description>`
- The Pull Request Template has been completed.
- The change is focused on a single logical objective.
- Documentation has been updated where applicable.
- All local validation checks complete successfully (`npm run all`).
- All CI workflows pass successfully.

Where applicable, reference related issues using:

```text
Fixes: #123
```

---

## Questions

If you have questions, suggestions, or have identified an issue, please create a GitHub Issue using the appropriate issue template.
