import { access } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { processNextDeletionJob } from '../../../application/process-next-deletion-job.js';
import { RETENTION_MS } from '../../../application/testing/deletion-scenario.js';
import type { ReleaseArtifact } from '../../../domain/entities/release-artifact.js';
import type { Release } from '../../../domain/entities/release.js';
import type { ApplicationId } from '../../../domain/value-objects/identifier.js';
import { quarantineDirectoryKey } from '../../../domain/value-objects/storage-key.js';
import type {
  ApiErrorDto,
  ApplicationDto,
  DeletionJobDto,
  ProjectDto,
  ReleaseDetailDto,
} from '../../../../shared/types/api.js';
import { ADMIN_GITHUB_ID, createHttpFixture, json, type HttpFixture } from '../testing/http-fixture.js';

describe('artifact removal', (): void => {
  let fixture: HttpFixture;
  let admin: string;
  let release: Release;
  let apk: ReleaseArtifact;
  let ipa: ReleaseArtifact;
  let dsym: ReleaseArtifact;

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
    ipa = await fixture.storeArtifact(release, 'ipa', 'wrong ios build');
    dsym = await fixture.storeArtifact(release, 'dsym', 'symbols');
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  const worker = (): ReturnType<typeof processNextDeletionJob> =>
    processNextDeletionJob({
      unitOfWork: fixture.test.unitOfWork,
      storage: fixture.storage,
      clock: fixture.clock,
      workerId: 'test',
      leaseMs: 60_000,
      quarantineRetentionMs: RETENTION_MS,
    });
  const remove = (artifact: ReleaseArtifact, reason = 'Falsche Signatur'): ReturnType<HttpFixture['call']> =>
    fixture.call(admin, { method: 'POST', url: `/api/artifacts/${artifact.id}/remove`, payload: { reason } });
  const detail = async (): Promise<ReleaseDetailDto> =>
    json<ReleaseDetailDto>(await fixture.call(admin, { method: 'GET', url: `/api/releases/${release.id}` }));
  const artifactOf = async (id: string): Promise<ReleaseDetailDto['artifacts'][number] | undefined> =>
    (await detail()).artifacts.find((artifact) => artifact.id === id);
  const fileExists = (key: string): Promise<boolean> =>
    access(fixture.resolver.resolve(key as never)).then(
      () => true,
      () => false,
    );

  it('removes a single artifact through quarantine and purges it after the retention period', async (): Promise<void> => {
    expect(json<ApiErrorDto>(await remove(ipa, ' ')).error.code).toBe('reason_required');

    const requested = await remove(ipa);
    expect(requested.statusCode).toBe(202);

    // Gone for users at once, while the file still waits for the worker.
    expect((await fixture.call(admin, { method: 'GET', url: `/api/artifacts/${ipa.id}/download` })).statusCode).toBe(
      404,
    );
    expect((await artifactOf(ipa.id))?.removal).toMatchObject({ state: 'requested', reason: 'Falsche Signatur' });
    expect((await detail()).lifecycleState).toBe('active');

    const deleteRelease = await fixture.call(admin, {
      method: 'DELETE',
      url: `/api/releases/${release.id}`,
      payload: { rowVersion: 1, confirmation: 'k-mobile 4.13.0 (125)', reason: 'Alles weg' },
    });
    expect(json<ApiErrorDto>(deleteRelease).error.code).toBe('deletion_already_requested');

    expect(await worker()).toMatchObject({ outcome: 'quarantined' });
    const { deletionJobId } = json<{ deletionJobId: string }>(requested);
    const quarantined = `${quarantineDirectoryKey(deletionJobId as never, release.id)}/${ipa.id}.ipa`;

    expect(await fileExists(ipa.storageKey)).toBe(false);
    expect(await fileExists(quarantined)).toBe(true);
    expect(await fileExists(apk.storageKey)).toBe(true);
    expect(await artifactOf(ipa.id)).toMatchObject({ storageState: 'quarantined', removal: { state: 'quarantined' } });
    expect((await detail()).missingPlatforms).toEqual(['ios']);

    const jobs = json<DeletionJobDto[]>(await fixture.call(admin, { method: 'GET', url: '/api/deletion-jobs' }));
    expect(jobs).toEqual([
      expect.objectContaining({ artifactId: ipa.id, releaseId: release.id, state: 'quarantined' }),
    ]);

    fixture.clock.advance(RETENTION_MS);
    expect(await worker()).toMatchObject({ outcome: 'purged' });
    expect(await fileExists(quarantined)).toBe(false);

    admin = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');
    expect(await artifactOf(ipa.id)).toMatchObject({ storageState: 'purged', removal: null });
    expect((await detail()).lifecycleState).toBe('active');

    const actions = fixture.test.unitOfWork
      .read(({ auditLog }) => auditLog.list({ actionPrefix: 'artifact.delete', limit: 10, offset: 0 }))
      .map((entry) => entry.action);
    expect(actions).toEqual(['artifact.delete.completed', 'artifact.delete.quarantined', 'artifact.delete.requested']);
  });

  it('restores a removed artifact from quarantine', async (): Promise<void> => {
    await remove(dsym);
    await worker();

    const restored = await fixture.call(admin, { method: 'POST', url: `/api/artifacts/${dsym.id}/restore` });

    expect(restored.statusCode).toBe(204);
    expect(await fileExists(dsym.storageKey)).toBe(true);
    expect(await artifactOf(dsym.id)).toMatchObject({ storageState: 'stored', removal: null });
    expect((await fixture.call(admin, { method: 'POST', url: `/api/artifacts/${dsym.id}/restore` })).statusCode).toBe(
      404,
    );
  });

  it('keeps published releases installable and the release deletion independent', async (): Promise<void> => {
    expect(
      (
        await fixture.call(admin, {
          method: 'POST',
          url: `/api/releases/${release.id}/publish`,
          payload: { rowVersion: 1 },
        })
      ).statusCode,
    ).toBe(200);

    const locked = await remove(ipa);
    expect(json<ApiErrorDto>(locked).error.code).toBe('artifact_locked_after_publication');
    expect((await remove(dsym)).statusCode).toBe(202);
    expect(json<ApiErrorDto>(await remove(dsym)).error.code).toBe('deletion_already_requested');

    await worker();

    // The release can now be deleted; its job moves the remaining files and leaves the dSYM in its own quarantine.
    const current = await detail();
    const deletion = await fixture.call(admin, {
      method: 'DELETE',
      url: `/api/releases/${release.id}`,
      payload: { rowVersion: current.rowVersion, confirmation: current.deletionConfirmation, reason: 'Fehlbuild' },
    });
    expect(deletion.statusCode).toBe(202);
    expect(await worker()).toMatchObject({ outcome: 'quarantined' });

    const states = (await detail()).artifacts.map((artifact) => [artifact.kind, artifact.storageState]);
    expect(states).toEqual(
      expect.arrayContaining([
        ['apk', 'quarantined'],
        ['ipa', 'quarantined'],
        ['dsym', 'quarantined'],
      ]),
    );

    const restore = await fixture.call(admin, { method: 'POST', url: `/api/artifacts/${dsym.id}/restore` });
    expect(json<ApiErrorDto>(restore).error.code).toBe('invalid_release_state');
  });

  it('needs artifacts.delete', async (): Promise<void> => {
    const outsider = await fixture.signIn('3000', 'outsider');
    const refused = await fixture.call(outsider, {
      method: 'POST',
      url: `/api/artifacts/${ipa.id}/remove`,
      payload: { reason: 'x' },
    });

    expect(refused.statusCode).toBe(403);
  });
});
