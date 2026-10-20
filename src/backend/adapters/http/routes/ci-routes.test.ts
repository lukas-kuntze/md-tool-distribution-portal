import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CiJob } from '../../../domain/ports/ci-token-verifier.js';
import type {
  ApiErrorDto,
  ApplicationDto,
  AuditEntryDto,
  CiBindingDto,
  CiSettingsDto,
  ProjectDto,
  ReleaseDetailDto,
  UploadResultDto,
} from '../../../../shared/types/api.js';
import { apk, ipa } from '../../external/binaries/testing/binary-fixtures.js';
import { ADMIN_GITHUB_ID, createHttpFixture, json, PUBLIC_URL, type HttpFixture } from '../testing/http-fixture.js';

const SHA = 'c'.repeat(40);
const android = apk({ packageName: 'de.md.pflege', versionCode: 350, versionName: '3.5.0' });
const iphone = { bundleIdentifier: 'de.md.pflege', version: '3.5.0', buildNumber: '350' };

const job: CiJob = {
  repositoryId: 4711,
  repository: 'medifox/pflege-mobil',
  ref: 'refs/heads/main',
  environment: null,
  sha: SHA,
  actor: 'octocat',
  workflowRun: { id: 9001, attempt: 1, url: 'https://github.com/medifox/pflege-mobil/actions/runs/9001/attempts/1' },
};

describe('CI bindings and uploads', (): void => {
  let fixture: HttpFixture;
  let admin: string;
  let application: ApplicationDto;

  beforeEach(async (): Promise<void> => {
    fixture = await createHttpFixture();
    admin = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');
    fixture.ciTokens.jobs.set('main-token', job);

    const project = json<ProjectDto>(
      await fixture.call(admin, { method: 'POST', url: '/api/projects', payload: { slug: 'md', name: 'MD' } }),
    );
    application = json<ApplicationDto>(
      await fixture.call(admin, {
        method: 'POST',
        url: `/api/projects/${project.id}/applications`,
        payload: {
          slug: 'pflege',
          name: 'Pflege mobil',
          platforms: ['android', 'ios'],
          bundleIdentifiers: { android: 'de.md.pflege', ios: 'de.md.pflege' },
        },
      }),
    );
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  const bind = (payload: Record<string, unknown> = {}, cookie = admin): ReturnType<HttpFixture['call']> =>
    fixture.call(cookie, {
      method: 'POST',
      url: `/api/applications/${application.id}/ci-bindings`,
      payload: {
        repositoryId: 4711,
        repositoryName: 'medifox/pflege-mobil',
        refPattern: 'refs/heads/main',
        ...payload,
      },
    });

  /** As the GitHub Action calls: bearer token, no cookie, no origin. */
  const ciCall = (
    token: string,
    method: 'POST' | 'PATCH',
    url: string,
    payload: Buffer | object,
  ): Promise<LightMyRequestResponse> =>
    fixture.app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': Buffer.isBuffer(payload) ? 'application/octet-stream' : 'application/json',
      },
      payload: Buffer.isBuffer(payload) ? payload : JSON.stringify(payload),
    });

  const uploadBuild = (content: Buffer, token = 'main-token', flavor?: string): ReturnType<typeof ciCall> =>
    ciCall(
      token,
      'POST',
      `/api/ci/applications/${application.id}/builds?${new URLSearchParams({ fileName: 'app.bin', ...(flavor === undefined ? {} : { flavor }) }).toString()}`,
      content,
    );

  const release = async (releaseId: string): Promise<ReleaseDetailDto> =>
    json<ReleaseDetailDto>(await fixture.call(admin, { method: 'GET', url: `/api/releases/${releaseId}` }));

  const audit = async (action: string): Promise<AuditEntryDto[]> =>
    json<AuditEntryDto[]>(await fixture.call(admin, { method: 'GET', url: `/api/audit-logs?action=${action}` }));

  it('manages the bindings of an application', async (): Promise<void> => {
    const created = json<CiBindingDto>(await bind({ environment: 'production' }));
    expect(created).toMatchObject({
      repositoryId: 4711,
      environment: 'production',
      createdBy: 'admin',
      revokedAt: null,
    });
    expect((await bind({ environment: 'production' })).statusCode).toBe(409);
    expect(json<ApiErrorDto>(await bind({ refPattern: 'main' })).error.code).toBe('invalid_ci_binding');

    const settings = json<CiSettingsDto>(
      await fixture.call(admin, { method: 'GET', url: `/api/applications/${application.id}/ci` }),
    );
    expect(settings).toMatchObject({ portalUrl: PUBLIC_URL, audience: PUBLIC_URL, bindings: [{ id: created.id }] });

    const outsider = await fixture.signIn('3000', 'outsider');
    expect((await bind({}, outsider)).statusCode).toBe(403);
    expect(
      (await fixture.call(outsider, { method: 'POST', url: `/api/ci-bindings/${created.id}/revoke` })).statusCode,
    ).toBe(403);

    expect(
      (await fixture.call(admin, { method: 'POST', url: `/api/ci-bindings/${created.id}/revoke` })).statusCode,
    ).toBe(204);
    expect((await audit('ci_binding.')).map((entry) => entry.action)).toEqual([
      'ci_binding.revoked',
      'ci_binding.created',
    ]);
  });

  it('creates a release from a bound workflow with its git and run data', async (): Promise<void> => {
    await bind();

    const androidUpload = await uploadBuild(android);
    expect(androidUpload.statusCode).toBe(201);
    const { releaseId, releaseCreated } = json<UploadResultDto>(androidUpload);
    expect(releaseCreated).toBe(true);

    // A retry or re-run sends the same file again: accepted, nothing stored twice.
    const repeated = await uploadBuild(android);
    expect(repeated.statusCode).toBe(201);
    expect(json<UploadResultDto>(repeated)).toEqual({
      releaseId,
      artifactId: json<UploadResultDto>(androidUpload).artifactId,
      releaseCreated: false,
    });

    const iosUpload = json<UploadResultDto>(await uploadBuild(ipa(iphone)));
    expect(iosUpload).toMatchObject({ releaseId, releaseCreated: false });

    const dsym = await ciCall(
      'main-token',
      'POST',
      `/api/ci/releases/${releaseId}/artifacts?fileName=Runner.dSYM.zip&kind=dsym`,
      Buffer.from('symbols'),
    );
    expect(dsym.statusCode).toBe(201);

    expect(await release(releaseId)).toMatchObject({
      version: '3.5.0',
      buildNumber: 350,
      gitCommitSha: SHA,
      gitBranch: 'main',
      gitTag: null,
      gitRepository: 'medifox/pflege-mobil',
      workflowRun: job.workflowRun,
      publicationStatus: 'draft',
      missingPlatforms: [],
    });
    expect((await release(releaseId)).artifacts.map((artifact) => artifact.kind).sort()).toEqual([
      'apk',
      'dsym',
      'ipa',
    ]);

    const [created] = await audit('release.created');
    expect(created).toMatchObject({
      actor: { type: 'ci', label: 'medifox/pflege-mobil@refs/heads/main', userId: null },
      details: { source: 'ci', triggeredBy: 'octocat', workflowRunUrl: job.workflowRun.url },
    });
  });

  it('sets release notes once, and only on drafts', async (): Promise<void> => {
    await bind();
    const { releaseId } = json<UploadResultDto>(await uploadBuild(android));
    const texts = (body: object): Promise<{ applied: boolean }> =>
      ciCall('main-token', 'PATCH', `/api/ci/releases/${releaseId}/texts`, body).then((response) =>
        json<{ applied: boolean }>(response),
      );

    expect(await texts({ releaseNotes: 'Neue Vitalwerte' })).toEqual({ applied: true });
    expect(await texts({ releaseNotes: 'Überschrieben?' })).toEqual({ applied: false });
    expect(await texts({ changelog: 'fix: sync' })).toEqual({ applied: true });
    expect(await release(releaseId)).toMatchObject({ releaseNotes: 'Neue Vitalwerte', changelog: 'fix: sync' });
  });

  it('refuses jobs without a matching binding and audits them', async (): Promise<void> => {
    await bind({ environment: 'production' });
    fixture.ciTokens.jobs.set('feature-token', { ...job, ref: 'refs/heads/feature', environment: 'production' });
    fixture.ciTokens.jobs.set('production-token', { ...job, environment: 'production' });

    expect((await uploadBuild(android)).statusCode).toBe(403);
    expect((await uploadBuild(android, 'feature-token')).statusCode).toBe(403);
    expect((await uploadBuild(android, 'forged-token')).statusCode).toBe(401);
    expect(
      (await fixture.app.inject({ method: 'POST', url: `/api/ci/applications/${application.id}/builds?fileName=a` }))
        .statusCode,
    ).toBe(401);

    const denied = await audit('ci.denied');
    expect(denied).toHaveLength(2);
    expect(denied[0]).toMatchObject({
      outcome: 'denied',
      actor: { type: 'ci' },
      details: { ref: 'refs/heads/feature' },
    });

    expect((await uploadBuild(android, 'production-token')).statusCode).toBe(201);
  });

  it('keeps a job to its own application, commit and flavor', async (): Promise<void> => {
    await bind();
    const { releaseId } = json<UploadResultDto>(await uploadBuild(android));

    // Another commit may not add to this release.
    fixture.ciTokens.jobs.set('other-commit', { ...job, sha: 'd'.repeat(40) });
    const foreign = await ciCall(
      'other-commit',
      'POST',
      `/api/ci/releases/${releaseId}/artifacts?fileName=m.txt&kind=mapping`,
      Buffer.from('map'),
    );
    expect(json<ApiErrorDto>(foreign).error.code).toBe('artifact_commit_mismatch');

    expect(json<ApiErrorDto>(await uploadBuild(ipa(iphone), 'main-token', 'staging')).error.code).toBe(
      'flavor_mismatch',
    );
    expect((await uploadBuild(ipa(iphone), 'main-token', 'default')).statusCode).toBe(201);

    // Cookies do not authenticate CI routes, and the session does not help either.
    const withCookie = await fixture.call(admin, {
      method: 'POST',
      url: `/api/ci/applications/${application.id}/builds?fileName=a.apk`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: android,
    });
    expect(withCookie.statusCode).toBe(401);
  });
});
