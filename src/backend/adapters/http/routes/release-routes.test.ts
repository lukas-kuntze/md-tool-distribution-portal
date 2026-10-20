import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { processNextDeletionJob } from '../../../application/process-next-deletion-job.js';
import { RETENTION_MS } from '../../../application/testing/deletion-scenario.js';
import type { ReleaseArtifact } from '../../../domain/entities/release-artifact.js';
import type { Release } from '../../../domain/entities/release.js';
import type { ApplicationId } from '../../../domain/value-objects/identifier.js';
import type {
  ApiErrorDto,
  ApplicationDto,
  ProjectDto,
  ReleaseDetailDto,
  ReleaseSummaryDto,
} from '../../../../shared/types/api.js';
import { parseRange } from '../download-response.js';
import { ADMIN_GITHUB_ID, createHttpFixture, json, type HttpFixture } from '../testing/http-fixture.js';

describe('release routes', (): void => {
  let fixture: HttpFixture;
  let admin: string;
  let application: ApplicationDto;
  let release: Release;

  beforeEach(async (): Promise<void> => {
    fixture = await createHttpFixture();
    admin = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');

    const project = json<ProjectDto>(
      await fixture.call(admin, {
        method: 'POST',
        url: '/api/projects',
        payload: { slug: 'md-ambulant', name: 'MD Ambulant' },
      }),
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
    release = fixture.seedRelease(application.id as ApplicationId);
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  const upload = (kind: 'apk' | 'ipa', content: string): Promise<ReleaseArtifact> =>
    fixture.storeArtifact(release, kind, content);

  const detail = async (cookie = admin): Promise<ReleaseDetailDto> =>
    json<ReleaseDetailDto>(await fixture.call(cookie, { method: 'GET', url: `/api/releases/${release.id}` }));

  it('lists releases and reports missing platforms', async (): Promise<void> => {
    await upload('apk', 'android build');

    const response = await fixture.call(admin, {
      method: 'GET',
      url: `/api/applications/${application.id}/releases?status=draft&limit=1`,
    });
    const list = json<ReleaseSummaryDto[]>(response);

    expect(response.headers['x-total-count']).toBe('1');

    expect(list).toEqual([expect.objectContaining({ version: '4.13.0', buildNumber: 125, missingPlatforms: ['ios'] })]);
    expect(await detail()).toMatchObject({
      artifacts: [expect.objectContaining({ kind: 'apk', installable: true })],
      deletionConfirmation: 'k-mobile 4.13.0 (125)',
    });
  });

  it('publishes only complete releases and withdraws them again', async (): Promise<void> => {
    await upload('apk', 'android build');
    const incomplete = await fixture.call(admin, {
      method: 'POST',
      url: `/api/releases/${release.id}/publish`,
      payload: { rowVersion: 1 },
    });

    await upload('ipa', 'ios build');
    const published = await fixture.call(admin, {
      method: 'POST',
      url: `/api/releases/${release.id}/publish`,
      payload: { rowVersion: 1 },
    });
    const withdrawn = await fixture.call(admin, {
      method: 'POST',
      url: `/api/releases/${release.id}/withdraw`,
      payload: { rowVersion: 2 },
    });

    expect(json<ApiErrorDto>(incomplete).error.code).toBe('release_incomplete');
    expect(json<ReleaseDetailDto>(published)).toMatchObject({ publicationStatus: 'published', rowVersion: 2 });
    expect(json<ReleaseDetailDto>(withdrawn).publicationStatus).toBe('withdrawn');
  });

  it('updates release notes', async (): Promise<void> => {
    const response = await fixture.call(admin, {
      method: 'PATCH',
      url: `/api/releases/${release.id}`,
      payload: { rowVersion: 1, releaseNotes: 'Neue Formulare' },
    });

    expect(json<ReleaseDetailDto>(response)).toMatchObject({ releaseNotes: 'Neue Formulare', rowVersion: 2 });
  });

  it('streams artifacts completely and by byte range', async (): Promise<void> => {
    const apk = await upload('apk', 'android build');
    const url = `/api/artifacts/${apk.id}/download`;

    const full = await fixture.call(admin, { method: 'GET', url });
    const part = await fixture.call(admin, { method: 'GET', url, headers: { range: 'bytes=8-12' } });
    const outside = await fixture.call(admin, { method: 'GET', url, headers: { range: 'bytes=500-' } });

    expect(full.statusCode).toBe(200);
    expect(full.body).toBe('android build');
    expect(full.headers).toMatchObject({
      'content-length': '13',
      'accept-ranges': 'bytes',
      etag: `"${apk.sha256}"`,
      'content-disposition': `attachment; filename="k-mobile-4.13.0-125.apk"; filename*=UTF-8''k-mobile-4.13.0-125.apk`,
    });
    expect(part.statusCode).toBe(206);
    expect(part.body).toBe('build');
    expect(part.headers['content-range']).toBe('bytes 8-12/13');
    expect(outside.statusCode).toBe(416);
  });

  it('keeps drafts from users who may only download published releases', async (): Promise<void> => {
    const apk = await upload('apk', 'android build');
    await fixture.call(admin, {
      method: 'PATCH',
      url: `/api/applications/${application.id}`,
      payload: { rowVersion: 1, visibility: 'organization' },
    });
    const user = await fixture.signIn('2000', 'octocat');

    expect((await fixture.call(user, { method: 'GET', url: `/api/releases/${release.id}` })).statusCode).toBe(404);
    expect((await fixture.call(user, { method: 'GET', url: `/api/artifacts/${apk.id}/download` })).statusCode).toBe(
      403,
    );
    expect(
      json<ReleaseSummaryDto[]>(
        await fixture.call(user, { method: 'GET', url: `/api/applications/${application.id}/releases` }),
      ),
    ).toEqual([]);
  });

  it('deletes a release through quarantine and restores it', async (): Promise<void> => {
    await upload('apk', 'android build');
    const url = `/api/releases/${release.id}`;

    const wrong = await fixture.call(admin, {
      method: 'DELETE',
      url,
      payload: { rowVersion: 1, confirmation: 'yes', reason: 'Absturz' },
    });
    const accepted = await fixture.call(admin, {
      method: 'DELETE',
      url,
      payload: { rowVersion: 1, confirmation: 'k-mobile 4.13.0 (125)', reason: 'Absturz' },
    });

    expect(json<ApiErrorDto>(wrong).error.code).toBe('confirmation_mismatch');
    expect(accepted.statusCode).toBe(202);
    expect((await detail()).lifecycleState).toBe('pending_deletion');

    await processNextDeletionJob({
      unitOfWork: fixture.test.unitOfWork,
      storage: fixture.storage,
      clock: fixture.clock,
      workerId: 'test',
      leaseMs: 60_000,
      quarantineRetentionMs: RETENTION_MS,
    });
    expect(await detail()).toMatchObject({ lifecycleState: 'quarantined', deletion: { state: 'quarantined' } });

    const restored = await fixture.call(admin, { method: 'POST', url: `${url}/restore` });
    expect(json<ReleaseDetailDto>(restored)).toMatchObject({ lifecycleState: 'active', deletion: null });
  });
});

describe('parseRange', (): void => {
  it.each([
    [undefined, null],
    ['bytes=0-4', { start: 0, end: 4 }],
    ['bytes=5-', { start: 5, end: 9 }],
    ['bytes=-3', { start: 7, end: 9 }],
    ['bytes=8-100', { start: 8, end: 9 }],
    ['bytes=10-', 'unsatisfiable'],
    ['bytes=6-2', 'unsatisfiable'],
    ['bytes=0-1,4-5', null],
    ['items=0-1', null],
  ] as const)('reads %s for a file of 10 bytes', (header, expected): void => {
    expect(parseRange(header, 10)).toEqual(expected);
  });
});
