import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Release } from '../../../domain/entities/release.js';
import { parseBuildNumber } from '../../../domain/value-objects/build-number.js';
import type { ApplicationId } from '../../../domain/value-objects/identifier.js';
import { parseVersion } from '../../../domain/value-objects/version.js';
import { processNextDeletionJob } from '../../../application/process-next-deletion-job.js';
import type {
  ApplicationDto,
  DashboardDto,
  ProjectDto,
  ReleaseDetailDto,
  ReleaseSummaryDto,
} from '../../../../shared/types/api.js';
import { ADMIN_GITHUB_ID, createHttpFixture, json, type HttpFixture } from '../testing/http-fixture.js';

describe('dashboard route', (): void => {
  let fixture: HttpFixture;
  let admin: string;
  let kMobile: ApplicationDto;
  let airPad: ApplicationDto;

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
    const createApp = async (slug: string, visibility: string): Promise<ApplicationDto> =>
      json<ApplicationDto>(
        await fixture.call(admin, {
          method: 'POST',
          url: `/api/projects/${project.id}/applications`,
          payload: {
            slug,
            name: slug,
            platforms: ['android'],
            visibility,
            bundleIdentifiers: { android: `de.md.${slug.replace('-', '')}` },
          },
        }),
      );

    kMobile = await createApp('k-mobile', 'organization');
    airPad = await createApp('air-pad', 'private');

    const first = await published(kMobile.id, '4.13.0', 125);
    await published(kMobile.id, '4.14.0', 126);
    fixture.seedRelease(kMobile.id as ApplicationId, {
      version: parseVersion('4.15.0'),
      buildNumber: parseBuildNumber(127),
    });
    await published(airPad.id, '1.0.0', 1);

    const apk = fixture.test.unitOfWork.read(({ releases }) => releases.listArtifacts(first.id))[0];
    await fixture.call(admin, { method: 'GET', url: `/api/artifacts/${apk?.id ?? ''}/download` });
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  async function published(applicationId: string, version: string, buildNumber: number): Promise<Release> {
    const release = fixture.seedRelease(applicationId as ApplicationId, {
      version: parseVersion(version),
      buildNumber: parseBuildNumber(buildNumber),
      requiredPlatforms: ['android'],
    });
    await fixture.storeArtifact(release, 'apk', 'android build');
    await fixture.call(admin, {
      method: 'POST',
      url: `/api/releases/${release.id}/publish`,
      payload: { rowVersion: 1 },
    });
    return release;
  }

  const dashboard = async (cookie: string): Promise<DashboardDto> => {
    const response = await fixture.call(cookie, { method: 'GET', url: '/api/dashboard' });
    if (response.statusCode !== 200) throw new Error(response.body);
    return json<DashboardDto>(response);
  };

  it('counts releases and downloads of everything an administrator sees', async (): Promise<void> => {
    const view = await dashboard(admin);

    expect(view.downloadDays).toBe(30);
    expect(view.totals).toEqual({ projects: 1, applications: 2, published: 3, drafts: 1, inDeletion: 0, downloads: 1 });
    expect(
      view.projects[0]?.applications.map((application) => [
        application.name,
        application.published,
        application.drafts,
        application.downloads,
        application.latest?.version,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['k-mobile', 2, 1, 1, '4.14.0'],
        ['air-pad', 1, 0, 0, '1.0.0'],
      ]),
    );
    expect(view.recentReleases.map((release) => release.buildNumber)).toHaveLength(4);
    expect(view.recentReleases[0]).toMatchObject({ projectName: 'MD Ambulant' });
  });

  it('shows other members only what they may see, without drafts', async (): Promise<void> => {
    const member = await fixture.signIn('3000', 'member');
    const view = await dashboard(member);

    expect(view.totals).toMatchObject({ projects: 1, applications: 1, published: 2, drafts: 0 });
    expect(view.projects[0]?.applications.map((application) => application.name)).toEqual(['k-mobile']);
    expect(view.recentReleases.map((release) => release.buildNumber).sort()).toEqual([125, 126]);
  });

  it('lists quarantined releases close to final deletion, share links and the previous sign-in', async (): Promise<void> => {
    expect((await dashboard(admin)).previousSignInAt).toBeNull();

    const airPadRelease = json<ReleaseSummaryDto[]>(
      await fixture.call(admin, { method: 'GET', url: `/api/applications/${airPad.id}/releases` }),
    )[0];
    const detail = json<ReleaseDetailDto>(
      await fixture.call(admin, { method: 'GET', url: `/api/releases/${airPadRelease?.id ?? ''}` }),
    );
    await fixture.call(admin, {
      method: 'DELETE',
      url: `/api/releases/${detail.id}`,
      payload: { rowVersion: detail.rowVersion, confirmation: detail.deletionConfirmation, reason: 'Fehlbuild' },
    });
    await processNextDeletionJob({
      unitOfWork: fixture.test.unitOfWork,
      storage: fixture.storage,
      clock: fixture.clock,
      workerId: 'test',
      leaseMs: 60_000,
      quarantineRetentionMs: 3 * 24 * 60 * 60_000,
    });

    const projectId = kMobile.projectId;
    const share = async (expiresAt: string | null): Promise<void> => {
      await fixture.call(admin, {
        method: 'POST',
        url: '/api/share-links',
        payload: { scope: { type: 'project', projectId }, label: 'Kunde', expiresAt },
      });
    };
    await share(null);
    await share(new Date(fixture.clock.now().getTime() + 5 * 24 * 60 * 60_000).toISOString());

    fixture.clock.advance(60_000);
    admin = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');
    const view = await dashboard(admin);

    expect(view.quarantineEnding).toEqual([
      expect.objectContaining({ releaseId: detail.id, applicationName: 'air-pad', version: '1.0.0', canRestore: true }),
    ]);
    expect(view.shareLinks).toEqual({ active: 2, expiringSoon: 1 });
    expect(view.previousSignInAt).not.toBeNull();

    const member = await fixture.signIn('3000', 'member');
    const memberView = await dashboard(member);
    expect(memberView.quarantineEnding).toEqual([]);
    expect(memberView.shareLinks).toBeNull();
  });
});
