# Description

Provide a concise and objective summary of the implemented change.

The description shall include:

- **Purpose:** A clear statement of the implemented change.
- **Problem Statement:** The issue, deficiency, or requirement addressed by this change.
- **Justification:** The business and/or technical rationale for the implementation.
- **Scope and Impact:** The affected components, interfaces, or services, including the expected impact on existing functionality.
- **Dependencies:** Prerequisites, related changes, external dependencies, or migration requirements.

**Related Issue(s):**

Fixes #<Issue-ID>

---

## Change Classification

Select all applicable categories.

- [ ] Bug fix (non-breaking correction of existing functionality)
- [ ] Feature enhancement (new, backward-compatible functionality)
- [ ] Breaking change (modification affecting backward compatibility)
- [ ] Documentation update required

---

## Verification and Validation

Describe the verification activities performed to confirm that the implemented change satisfies the specified requirements.

Include, where applicable:

- Test approach
- Test cases executed
- Expected results
- Actual results
- Reproduction steps
- Test environment
- Known limitations or deviations

---

## Quality Assurance Checklist

Confirm that the following requirements have been fulfilled prior to requesting review.

### Security

- [ ] No confidential information (e.g. passwords, API keys, access tokens, certificates, or other credentials) is included.
- [ ] Security implications have been assessed and addressed, where applicable.

### Development Quality

- [ ] The implementation complies with the project's coding standards and architectural guidelines.
- [ ] A self-review has been completed.
- [ ] Relevant documentation has been created or updated, where applicable.
- [ ] New and existing tests have been executed successfully.
- [ ] Backward compatibility has been verified, where applicable.

### Traceability

- [ ] The pull request title follows one of the approved naming conventions:
  - `[ISSUE-XXXX] — Short description`
  - `<type>: Short description`
- [ ] The associated issue is referenced in this pull request.
- [ ] The first line of the commit message reflects the associated issue, where applicable.

### Release Management

- [ ] At least one approved release note label has been assigned to this pull request.

Supported labels:

- **feat** / **feature** — New functionality or functional enhancement (minor release)
- **fix** — Defect correction (patch release)
- **docs** — Documentation changes
- **style** — Non-functional formatting or style changes
- **refactor** — Internal code restructuring without functional changes
- **perf** — Performance improvements
- **test** — Test implementation or maintenance
- **build** — Build system or dependency changes
- **ci** — CI/CD configuration changes
- **chore** — General maintenance activities
- **revert** — Reversion of a previous change

> **Note**
>
> If the source branch follows the established naming convention (e.g. `feat/<branch-name>` or `fix/<branch-name>`), the corresponding release note label will be assigned automatically.
