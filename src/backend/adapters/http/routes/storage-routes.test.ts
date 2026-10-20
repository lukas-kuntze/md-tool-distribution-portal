import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { processNextDeletionJob } from '../../../application/process-next-deletion-job.js';
import { RETENTION_MS } from '../../../application/testing/deletion-scenario.js';
import type { ReleaseArtifact } from '../../../domain/entities/release-artifact.js';
import type { Release } from '../../../domain/entities/release.js';
import type { ApplicationId } from '../../../domain/value-objects/identifier.js';
import type {
  ApplicationDto,
  DeletionJobDto,
  ProjectDto,
  ReleaseDetailDto,
  StorageOverviewDto,
  StorageReportDto,
} from '../../../../shared/types/api.js';
import { ADMIN_GITHUB_ID, createHttpFixture, json, type HttpFixture } from '../testing/http-fixture.js';

describe('storage overview and reconciliation', (): void => {
  let fixture: HttpFixture;
  let admin: string;
  let project: ProjectDto;
  let release: Release;
  let apk: ReleaseArtifact;
  let ipa: ReleaseArtifact;
  let dsym: ReleaseArtifact;

  beforeEach(async (): Promise<void> => {
    fixture = await createHttpFixture();
    admin = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');

    project = json<ProjectDto>(
      await fixture.call(admin, {
        method: 'POST',
        url: '/api/projects',
        payload: { slug: 'md-ambulant', name: 'MD Ambulant' },
      }),
    );
    const application = json<ApplicationDto>(
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
    apk = await fixture.storeArtifact(release, 'apk', 'android build');
    ipa = await fixture.storeArtifact(release, 'ipa', 'ios build');
    dsym = await fixture.storeArtifact(release, 'dsym', 'symbols');
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  const overview = async (): Promise<StorageOverviewDto> =>
    json<StorageOverviewDto>(await fixture.call(admin, { method: 'GET', url: '/api/storage' }));
  const reconcile = async (): Promise<StorageReportDto> =>
    json<StorageReportDto>(await fixture.call(admin, { method: 'POST', url: '/api/storage/reconcile' }));
  const artifactOf = async (id: string): Promise<ReleaseDetailDto['artifacts'][number] | undefined> =>
    json<ReleaseDetailDto>(
      await fixture.call(admin, { method: 'GET', url: `/api/releases/${release.id}` }),
    ).artifacts.find((artifact) => artifact.id === id);

  it('reports usage in total, per project and in quarantine', async (): Promise<void> => {
    await fixture.call(admin, {
      method: 'POST',
      url: `/api/artifacts/${dsym.id}/remove`,
      payload: { reason: 'Falsch' },
    });
    await processNextDeletionJob({
      unitOfWork: fixture.test.unitOfWork,
      storage: fixture.storage,
      clock: fixture.clock,
      workerId: 'test',
      leaseMs: 60_000,
      quarantineRetentionMs: RETENTION_MS,
    });

    const usage = await overview();
    const expected = {
      storedBytes: apk.sizeBytes + ipa.sizeBytes,
      storedArtifacts: 2,
      quarantinedBytes: dsym.sizeBytes,
      quarantinedArtifacts: 1,
      missingArtifacts: 0,
    };

    expect(usage.total).toEqual(expected);
    expect(usage.projects).toEqual([{ ...expected, projectId: project.id, name: 'MD Ambulant' }]);
    expect(usage.latestReport).toBeNull();

    // The quarantined file sits in the job's directory and is no orphan.
    const report = await reconcile();
    expect(report).toMatchObject({ trigger: 'manual', missing: [], orphaned: [] });
    expect((await overview()).latestReport?.id).toBe(report.id);
  });

  it('marks lost files as missing, recovers them and reports orphans', async (): Promise<void> => {
    const ipaPath = fixture.resolver.resolve(ipa.storageKey);
    await rm(ipaPath);
    await writeFile(fixture.resolver.resolve(apk.storageKey), 'truncated');
    const strayDirectory = path.join(path.dirname(ipaPath), '..', 'stray-release');
    await mkdir(strayDirectory, { recursive: true });
    await writeFile(path.join(strayDirectory, 'left-over.apk'), 'stray');

    const report = await reconcile();

    expect(report.missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifactId: ipa.id, problem: 'missing', quarantined: false }),
        expect.objectContaining({ artifactId: apk.id, problem: 'size_mismatch' }),
      ]),
    );
    expect(report.orphaned).toEqual([expect.objectContaining({ type: 'file', sizeBytes: 5 })]);
    expect(report.orphaned[0]?.path).toMatch(/stray-release\/left-over\.apk$/);
    expect(await artifactOf(ipa.id)).toMatchObject({ storageState: 'missing' });
    expect((await overview()).total.missingArtifacts).toBe(2);

    await writeFile(ipaPath, 'ios build');
    const second = await reconcile();

    expect(second.recovered).toEqual([{ artifactId: ipa.id, releaseId: release.id }]);
    expect(await artifactOf(ipa.id)).toMatchObject({ storageState: 'stored' });

    const actions = fixture.test.unitOfWork
      .read(({ auditLog }) => auditLog.list({ actionPrefix: 'storage.', limit: 10, offset: 0 }))
      .map((entry) => [entry.action, entry.outcome]);
    expect(actions).toEqual([
      ['storage.reconciled', 'failed'],
      ['storage.reconciled', 'failed'],
    ]);
  });

  it('needs storage.manage', async (): Promise<void> => {
    const outsider = await fixture.signIn('3000', 'outsider');

    expect((await fixture.call(outsider, { method: 'GET', url: '/api/storage' })).statusCode).toBe(403);
    expect((await fixture.call(outsider, { method: 'POST', url: '/api/storage/reconcile' })).statusCode).toBe(403);
  });

  it('ends a quarantine early so that the worker purges at once', async (): Promise<void> => {
    const worker = (): Promise<unknown> =>
      processNextDeletionJob({
        unitOfWork: fixture.test.unitOfWork,
        storage: fixture.storage,
        clock: fixture.clock,
        workerId: 'test',
        leaseMs: 60_000,
        quarantineRetentionMs: RETENTION_MS,
      });
    const purgeNow = (session: string, jobId: string): ReturnType<HttpFixture['call']> =>
      fixture.call(session, { method: 'POST', url: `/api/deletion-jobs/${jobId}/purge-now` });

    await fixture.call(admin, {
      method: 'POST',
      url: `/api/artifacts/${dsym.id}/remove`,
      payload: { reason: 'Falsch' },
    });
    const [requested] = json<DeletionJobDto[]>(await fixture.call(admin, { method: 'GET', url: '/api/deletion-jobs' }));
    const jobId = requested?.jobId ?? '';

    // Only a quarantined job can be purged early.
    expect((await purgeNow(admin, jobId)).statusCode).toBe(422);
    await worker();

    const outsider = await fixture.signIn('3000', 'outsider');
    expect((await purgeNow(outsider, jobId)).statusCode).toBe(403);

    const expedited = json<DeletionJobDto>(await purgeNow(admin, jobId));
    expect(expedited).toMatchObject({ state: 'quarantined', purgeAfter: fixture.clock.now().toISOString() });

    await worker();

    expect(await artifactOf(dsym.id)).toMatchObject({ storageState: 'purged', removal: null });
    expect((await overview()).total.quarantinedArtifacts).toBe(0);
    const actions = fixture.test.unitOfWork
      .read(({ auditLog }) => auditLog.list({ actionPrefix: 'release.delete.expedited', limit: 10, offset: 0 }))
      .map((entry) => entry.outcome);
    expect(actions).toEqual(['success']);
  });
});
