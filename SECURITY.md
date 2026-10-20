# Security Policy

## Supported Versions

Security updates are provided for the most recent release only. Installations are expected to run the latest release before reporting a vulnerability.

---

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues, pull requests, or discussions.

Report vulnerabilities privately through **GitHub Security Advisories**, using the **Report a vulnerability** button in the repository's **Security** tab. The report remains visible to the maintainers only and is linked to the repository throughout its handling.

> **Note for maintainers:** private vulnerability reporting is a per-repository setting. It must be enabled under **Settings → Advanced Security → Private vulnerability reporting**; otherwise the button referenced above is not available and this policy leaves no usable reporting channel.

To help assess and reproduce the issue, please include as much of the following as possible:

- The type of issue and the affected component, route, file, or configuration.
- The steps required to reproduce the issue.
- Any proof-of-concept code, configuration, or logs — with secrets, tokens and share links removed.
- The impact you expect an attacker could achieve.

---

## Handling Process

Reports are handled according to the following targets:

| Stage                                          | Target                  |
| ---------------------------------------------- | ----------------------- |
| Acknowledgement of receipt                     | Within 5 business days  |
| Initial assessment and severity classification | Within 10 business days |
| Status updates until resolution                | At least every 14 days  |

Once a fix is available, it is released and the reporter is informed. Reporters are credited in the accompanying security advisory unless they request otherwise.

---

## Disclosure Policy

Vulnerabilities are handled under coordinated disclosure. Please refrain from publicly disclosing a reported vulnerability until a fix has been released and the corresponding security advisory has been published.

---

## Security Model

The portal distributes installable app builds, so the protections below are part of its intended behaviour. A way around any of them is a vulnerability and in scope.

**Authentication and sessions**

- Sign-in uses GitHub OAuth. Membership in the configured organisation is required to sign in but grants no permissions; users are bound to their stable numeric GitHub id, not their login.
- Sessions are stored server-side as token hashes, with absolute and idle expiry. The cookie is `HttpOnly`, `SameSite=Lax` and, over HTTPS, uses the `__Host-` prefix.
- State-changing requests are only accepted with an `Origin` header matching `PUBLIC_URL`.

**Authorization**

- Every action is checked against roles scoped to the platform, a project or an application. Refused actions are recorded in the audit log.
- Applications and projects a user may not see are reported as not found, so that their existence does not leak.
- Roles can only be granted within the granting person's own scope and permissions; the last platform administrator cannot be removed. See [docs/rollen-und-berechtigungen.md](docs/rollen-und-berechtigungen.md).

**Links without a session**

- iOS installation links (`/install/…`) carry a short-lived token signed with HMAC (`INSTALL_LINK_SECRET`). User, permissions and release state are checked again on every request.
- Share links for customers (`/public/shares/…`) contain a random secret that is stored only as a hash. They are read-only, can expire and can be revoked at any time; every view and download is audited.

**Storage**

- Artifacts and icons are stored below `STORAGE_ROOT`, which must not overlap with any directory served by IIS (`SERVED_AREAS`); startup fails otherwise. Files are streamed by the web service after its checks, never served directly.
- Storage paths are derived from server-generated identifiers only. Symbolic links and junctions inside the storage area are refused.
- Uploaded icons are accepted as PNG or JPEG only, recognised by their content, and served with `Content-Security-Policy: default-src 'none'` and `X-Content-Type-Options: nosniff`.
- Deletion goes through a quarantine and removes only verified, expected files — never recursively.

**Audit**

- The audit log is append-only, enforced by database triggers.

**Secrets**

- Configuration, including `GITHUB_CLIENT_SECRET` and `INSTALL_LINK_SECRET`, is read from environment variables. Real values belong in the service environment or a local, ignored `.env`, never in `.env.example` or any other committed file. A secret that has been committed must be rotated, not just removed.

---

## Scope

This policy applies to the contents of this repository and to installations of the portal built from it.

Out of scope are the security of the hosting environment (Windows Server, IIS, TLS configuration, file system permissions), of GitHub as identity provider, and of the distributed apps themselves. Vulnerabilities in third-party dependencies shall be reported to the respective maintainers; if a dependency vulnerability affects this repository directly, a report through the channels above is welcome.
