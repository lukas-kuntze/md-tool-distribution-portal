import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  ApiErrorDto,
  ApplicationDto,
  ProjectDto,
  ReleaseDetailDto,
  RoleDto,
  UploadResultDto,
  UserSummaryDto,
} from '../../../../shared/types/api.js';
import { apk, binaryManifest, ipa, zip } from '../../external/binaries/testing/binary-fixtures.js';
import {
  ADMIN_GITHUB_ID,
  createHttpFixture,
  json,
  MAX_UPLOAD_BYTES,
  type HttpFixture,
} from '../testing/http-fixture.js';

const COMMIT = 'a'.repeat(40);
const android = { packageName: 'de.md.kmobile', versionCode: 125, versionName: '4.13.0' };
const ios = { bundleIdentifier: 'de.md.kmobile', version: '4.13.0', buildNumber: '125' };

describe('upload routes', (): void => {
  let fixture: HttpFixture;
  let admin: string;
  let application: ApplicationDto;

  beforeEach(async (): Promise<void> => {
    fixture = await createHttpFixture();
    admin = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');

    const project = json<ProjectDto>(
      await fixture.call(admin, { method: 'POST', url: '/api/projects', payload: { slug: 'md', name: 'MD' } }),
    );
    application = json<ApplicationDto>(
      await fixture.call(admin, {
        method: 'POST',
        url: `/api/projects/${project.id}/applications`,
        payload: {
          slug: 'k-mobile',
          name: 'K Mobile',
          platforms: ['android', 'ios'],
          bundleIdentifiers: { android: 'de.md.kmobile', ios: 'de.md.kmobile' },
        },
      }),
    );
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  const uploadBuild = (
    content: Buffer,
    query: Record<string, string> = { commitSha: COMMIT },
    cookie = admin,
  ): ReturnType<HttpFixture['call']> =>
    fixture.call(cookie, {
      method: 'POST',
      url: `/api/applications/${application.id}/builds?${new URLSearchParams({ fileName: 'app-release.bin', ...query }).toString()}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: content,
    });

  const uploadFile = (releaseId: string, kind: string, content: Buffer | string): ReturnType<HttpFixture['call']> =>
    fixture.call(admin, {
      method: 'POST',
      url: `/api/releases/${releaseId}/artifacts?kind=${kind}&fileName=${encodeURIComponent(`C:\\builds\\file.${kind}`)}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.isBuffer(content) ? content : Buffer.from(content),
    });

  const detail = async (releaseId: string): Promise<ReleaseDetailDto> =>
    json<ReleaseDetailDto>(await fixture.call(admin, { method: 'GET', url: `/api/releases/${releaseId}` }));

  const errorOf = (response: Awaited<ReturnType<HttpFixture['call']>>): [number, string] => [
    response.statusCode,
    json<ApiErrorDto>(response).error.code,
  ];

  async function incomingFiles(): Promise<string[]> {
    const directory = fixture.resolver.dirname(fixture.resolver.resolveIncoming(fixture.ids.next<'Upload'>()));
    return readdir(directory).catch(() => []);
  }

  it('creates a draft release from the first build and attaches the second platform to it', async (): Promise<void> => {
    const androidBuild = apk(android, ['arm64-v8a']);
    const first = await uploadBuild(androidBuild);

    expect(first.statusCode).toBe(201);
    const created = json<UploadResultDto>(first);
    expect(created.releaseCreated).toBe(true);

    expect(await detail(created.releaseId)).toMatchObject({
      version: '4.13.0',
      buildNumber: 125,
      gitCommitSha: COMMIT,
      publicationStatus: 'draft',
      missingPlatforms: ['ios'],
      artifacts: [
        {
          id: created.artifactId,
          kind: 'apk',
          abi: 'arm64-v8a',
          storageState: 'stored',
          sizeBytes: androidBuild.length,
          sha256: createHash('sha256').update(androidBuild).digest('hex'),
          originalFileName: 'app-release.bin',
        },
      ],
    });

    // The iOS build of the same state names neither release nor commit: flavor and build number find the release.
    const second = json<UploadResultDto>(await uploadBuild(ipa(ios), {}));
    expect(second).toMatchObject({ releaseId: created.releaseId, releaseCreated: false });

    const release = await detail(created.releaseId);
    expect(release.missingPlatforms).toEqual([]);
    expect(
      (
        await fixture.call(admin, {
          method: 'POST',
          url: `/api/releases/${release.id}/publish`,
          payload: { rowVersion: release.rowVersion },
        })
      ).statusCode,
    ).toBe(200);

    const download = await fixture.call(admin, { method: 'GET', url: `/api/artifacts/${created.artifactId}/download` });
    expect(download.rawPayload.equals(androidBuild)).toBe(true);
    expect(await incomingFiles()).toEqual([]);
  });

  it('refuses builds that do not belong to the release, the flavor or the application', async (): Promise<void> => {
    const { releaseId } = json<UploadResultDto>(await uploadBuild(apk(android)));

    expect(errorOf(await uploadBuild(ipa({ ...ios, version: '4.14.0' }), {}))).toEqual([
      422,
      'artifact_version_mismatch',
    ]);
    expect(errorOf(await uploadBuild(ipa(ios), { commitSha: 'b'.repeat(40) }))).toEqual([
      422,
      'artifact_commit_mismatch',
    ]);
    expect(errorOf(await uploadBuild(apk({ ...android, packageName: 'de.other.app' })))).toEqual([
      422,
      'bundle_identifier_mismatch',
    ]);
    expect(errorOf(await uploadBuild(apk({ ...android, versionCode: 126 }), {}))).toEqual([422, 'commit_sha_required']);
    expect(errorOf(await uploadBuild(apk({ ...android, versionName: '4.13' })))).toEqual([422, 'invalid_version']);
    // The same file again is accepted as already stored; another file of the same variant is not.
    expect(json<UploadResultDto>(await uploadBuild(apk(android)))).toMatchObject({ releaseId, releaseCreated: false });
    const otherBuild = zip([
      { name: 'AndroidManifest.xml', data: binaryManifest(android) },
      { name: 'classes.dex', data: 'other code' },
    ]);
    expect(errorOf(await uploadBuild(otherBuild))).toEqual([409, 'artifact_exists']);
    expect(errorOf(await uploadBuild(Buffer.from('not a build')))).toEqual([415, 'unreadable_binary']);
    expect(errorOf(await uploadBuild(Buffer.alloc(MAX_UPLOAD_BYTES + 1)))).toEqual([413, 'upload_too_large']);

    // Nothing of the refused uploads remains: no file, no artifact.
    expect(await incomingFiles()).toEqual([]);
    expect((await detail(releaseId)).artifacts).toHaveLength(1);
  });

  it('finds the flavor by the identifier in the binary', async (): Promise<void> => {
    const enabled = json<ApplicationDto>(
      await fixture.call(admin, {
        method: 'PATCH',
        url: `/api/applications/${application.id}`,
        payload: { rowVersion: application.rowVersion, flavorsEnabled: true },
      }),
    );
    await fixture.call(admin, {
      method: 'POST',
      url: `/api/applications/${enabled.id}/flavors`,
      payload: {
        key: 'enterprise',
        name: 'Enterprise',
        bundleIdentifiers: { android: 'de.md.kmobile.enterprise', ios: 'de.md.kmobile.enterprise' },
      },
    });

    const { releaseId } = json<UploadResultDto>(
      await uploadBuild(apk({ ...android, packageName: 'de.md.kmobile.enterprise' })),
    );

    expect((await detail(releaseId)).flavorKey).toBe('enterprise');
  });

  it('adds dSYM, mapping and metadata files and a missing platform to an existing release', async (): Promise<void> => {
    const { releaseId } = json<UploadResultDto>(await uploadBuild(apk(android)));

    expect((await uploadFile(releaseId, 'dsym', zip([{ name: 'Runner.app.dSYM/x', data: 'dwarf' }]))).statusCode).toBe(
      201,
    );
    expect((await uploadFile(releaseId, 'mapping', 'a.b.C -> a:')).statusCode).toBe(201);
    expect((await uploadFile(releaseId, 'metadata', '{"flutter":"3.35.0"}')).statusCode).toBe(201);
    expect(errorOf(await uploadFile(releaseId, 'binary', ipa({ ...ios, buildNumber: '126' })))).toEqual([
      422,
      'artifact_build_number_mismatch',
    ]);
    expect((await uploadFile(releaseId, 'binary', ipa(ios))).statusCode).toBe(201);

    const release = await detail(releaseId);
    expect(release.artifacts.map((artifact) => artifact.kind).sort()).toEqual([
      'apk',
      'dsym',
      'ipa',
      'mapping',
      'metadata',
    ]);
    expect(release.artifacts.find((artifact) => artifact.kind === 'mapping')?.originalFileName).toBe('file.mapping');
    expect(release.missingPlatforms).toEqual([]);
  });

  it('requires the upload permission and refuses before the body is stored', async (): Promise<void> => {
    const tester = await fixture.signIn('2000', 'tina');
    const users = json<UserSummaryDto[]>(await fixture.call(admin, { method: 'GET', url: '/api/users?query=tina' }));
    const roles = json<RoleDto[]>(await fixture.call(admin, { method: 'GET', url: '/api/roles' }));
    const grant = (key: string): ReturnType<HttpFixture['call']> =>
      fixture.call(admin, {
        method: 'POST',
        url: '/api/role-assignments',
        payload: {
          roleId: roles.find((role) => role.key === key)?.id,
          userId: users[0]?.id,
          scope: { type: 'application', applicationId: application.id },
          reason: 'Test',
        },
      });

    await grant('tester');
    expect(errorOf(await uploadBuild(apk(android), { commitSha: COMMIT }, tester))).toEqual([403, 'permission_denied']);
    expect(await incomingFiles()).toEqual([]);

    await grant('developer');
    expect((await uploadBuild(apk(android), { commitSha: COMMIT }, tester)).statusCode).toBe(201);
  });

  it('accepts uploads only as octet stream from the own origin', async (): Promise<void> => {
    const asJson = await fixture.call(admin, {
      method: 'POST',
      url: `/api/applications/${application.id}/builds?fileName=x.apk`,
      payload: { not: 'a file' },
    });
    const foreign = await fixture.call(admin, {
      method: 'POST',
      url: `/api/applications/${application.id}/builds?fileName=x.apk`,
      headers: { origin: 'https://evil.example.com', 'content-type': 'application/octet-stream' },
      payload: apk(android),
    });

    expect(asJson.statusCode).toBe(400);
    expect(foreign.statusCode).toBe(403);
  });
});
