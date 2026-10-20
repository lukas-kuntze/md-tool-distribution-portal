# MD Tool Distribution Upload

GitHub Action that uploads app builds from a workflow run into the MEDIFOX DAN distribution portal.

The action authenticates with the **OIDC token of the job** — there is no secret to store. The portal accepts the upload only if the application has a **CI binding** for the repository, the branch or tag pattern and, if set, the environment of the run. Version, build number and flavor are read from the files; commit, repository, branch or tag and workflow run are taken from the verified token.

> **Setup:** in the portal, open the application, tab „CI“, and connect the repository (owner/name and its numeric id), the branch or tag pattern and, optionally, the environment. The tab shows `portal-url` and `application-id` and a workflow to start from.

---

## Usage

```yaml
jobs:
  release:
    runs-on: macos-latest
    environment: production # only if the CI binding requires it
    permissions:
      id-token: write # required: lets the job request its OIDC token
      contents: read
    steps:
      - uses: actions/checkout@v5

      # … flutter build apk --flavor production / flutter build ipa --flavor production …

      - name: Zip dSYMs
        run: ditto -c -k --keepParent build/ios/archive/Runner.xcarchive/dSYMs/Runner.app.dSYM Runner.app.dSYM.zip

      - uses: lukas-kuntze/md-tool-distribution-portal/src/action@v1
        id: upload
        with:
          portal-url: https://apps.example.com
          application-id: 0192f3a4-…
          flavor: production
          files: |
            build/app/outputs/flutter-apk/app-production-release.apk
            build/ios/ipa/*.ipa
          dsym: Runner.app.dSYM.zip
          mapping: build/app/outputs/mapping/productionRelease/mapping.txt
          release-notes-file: RELEASE_NOTES.md

      - run: echo "Release ${{ steps.upload.outputs.release-url }}"
```

APK and IPA built in separate jobs of the same run can be uploaded by separate steps: both carry the same version, build number and commit and end up in the same release.

### Inputs

| Input                                  | Required | Description                                                                                   |
| -------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `portal-url`                           | yes      | Address of the portal. HTTPS is required (`localhost` excepted).                              |
| `application-id`                       | yes      | Id of the application in the portal.                                                          |
| `files`                                | yes      | APK, AAB and IPA files, one path or glob per line. All must share version and build number.   |
| `flavor`                               | no       | Flavor key; checked against the flavor the portal derives from the package name or bundle id. |
| `dsym`                                 | no       | Zipped dSYM bundles.                                                                          |
| `mapping`                              | no       | R8/ProGuard `mapping.txt` files.                                                              |
| `metadata`                             | no       | Additional build information as JSON files.                                                   |
| `release-notes` / `release-notes-file` | no       | Release notes for users; kept if the release already has release notes or is published.       |
| `changelog` / `changelog-file`         | no       | Technical changelog; same rule.                                                               |
| `audience`                             | no       | Audience of the OIDC token; defaults to the origin of `portal-url`.                           |

Paths are relative to the workspace. A pattern that matches nothing fails the step, so a missing build is never silently skipped.

### Outputs

| Output        | Description                                 |
| ------------- | ------------------------------------------- |
| `release-id`  | Id of the release the builds were added to. |
| `release-url` | Address of the release in the portal.       |

---

## Behaviour

- Files are streamed; they are never read into memory, so large IPAs are fine.
- Every request uses a fresh OIDC token, which is masked in the log.
- Network errors and HTTP 408, 429, 502, 503 and 504 are retried up to three times. Re-running a workflow is safe: the portal recognises files it already stored.
- If the portal refuses the upload, the step fails with the portal's error code and message.

---

## Portal API

| Request                                                                                | Body                            |
| -------------------------------------------------------------------------------------- | ------------------------------- |
| `POST /api/ci/applications/<application-id>/builds?fileName=…[&flavor=…]`              | file (`octet-stream`)           |
| `POST /api/ci/releases/<release-id>/artifacts?fileName=…&kind=dsym\|mapping\|metadata` | file (`octet-stream`)           |
| `PATCH /api/ci/releases/<release-id>/texts`                                            | `{ releaseNotes?, changelog? }` |

All requests carry `Authorization: Bearer <OIDC token>`. Uploads answer `{ releaseId, artifactId, releaseCreated }`, the texts request `{ applied }`.

---

## Development

The action uses Node built-ins only, so `tsc` produces it without a bundler:

```bash
npm run build:action   # compiles src/action/*.ts into src/action/dist/
```

`dist/` is committed, because GitHub runs the action straight from the repository. The CI workflow fails when it does not match the sources. Tests live next to the sources (`upload.test.ts`) and run with the rest of the suite.

For workflows in other repositories to use the action while this repository is private, allow access under **Settings → Actions → General → Access**.
