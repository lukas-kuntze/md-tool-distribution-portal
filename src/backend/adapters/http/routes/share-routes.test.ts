import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { NewRelease, Release } from '../../../domain/entities/release.js';
import { parseBuildNumber } from '../../../domain/value-objects/build-number.js';
import { parseVersion } from '../../../domain/value-objects/version.js';
import type { ApplicationId } from '../../../domain/value-objects/identifier.js';
import type {
  ApiErrorDto,
  ApplicationDto,
  ProjectDto,
  RoleDto,
  SharedContentDto,
  ShareLinkCreatedDto,
  ShareLinkDto,
  UserSummaryDto,
} from '../../../../shared/types/api.js';
import { ADMIN_GITHUB_ID, createHttpFixture, json, PUBLIC_URL, type HttpFixture } from '../testing/http-fixture.js';

describe('share routes', (): void => {
  let fixture: HttpFixture;
  let admin: string;
  let project: ProjectDto;
  let kMobile: ApplicationDto;
  let dokuAirPad: ApplicationDto;
  let published: Release;

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

    const createApp = async (slug: string, ios: string): Promise<ApplicationDto> =>
      json<ApplicationDto>(
        await fixture.call(admin, {
          method: 'POST',
          url: `/api/projects/${project.id}/applications`,
          payload: { slug, name: slug, platforms: ['android', 'ios'], bundleIdentifiers: { android: ios, ios } },
        }),
      );

    kMobile = await createApp('k-mobile', 'de.md.kmobile');
    dokuAirPad = await createApp('doku-airpad', 'de.md.airpad');
    published = await publishedRelease(kMobile.id);
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  async function publishedRelease(applicationId: string, overrides: Partial<NewRelease> = {}): Promise<Release> {
    const release = fixture.seedRelease(applicationId as ApplicationId, overrides);
    await fixture.storeArtifact(release, 'apk', 'android build');
    await fixture.storeArtifact(release, 'ipa', 'ios build');
    await fixture.call(admin, {
      method: 'POST',
      url: `/api/releases/${release.id}/publish`,
      payload: { rowVersion: 1 },
    });
    return release;
  }

  async function share(scope: object, extra: object = {}, cookie = admin): Promise<ShareLinkCreatedDto> {
    const response = await fixture.call(cookie, {
      method: 'POST',
      url: '/api/share-links',
      payload: { scope, label: 'Pflegedienst Meyer', ...extra },
    });

    expect(response.statusCode).toBe(201);
    return json<ShareLinkCreatedDto>(response);
  }

  const tokenOf = (created: ShareLinkCreatedDto): string => new URL(created.url).hash.slice(1);
  const open = (token: string, path = ''): Promise<LightMyRequestResponse> =>
    fixture.app.inject({ method: 'GET', url: `/public/shares/${token}${path}` });

  it('shares the published releases of a project without a session', async (): Promise<void> => {
    fixture.seedRelease(dokuAirPad.id as ApplicationId);
    const created = await share({ type: 'project', projectId: project.id });

    expect(created.url).toMatch(new RegExp(`^${PUBLIC_URL}/share\\.html#[\\w-]{43}$`));
    expect(created.shareLink).toMatchObject({ label: 'Pflegedienst Meyer', scopeName: 'MD Ambulant', active: true });

    const response = await open(tokenOf(created));
    const content = json<SharedContentDto>(response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(content.project.name).toBe('MD Ambulant');
    expect(content.applications.map((application) => [application.name, application.releases.length])).toEqual([
      ['doku-airpad', 0],
      ['k-mobile', 1],
    ]);

    const [release] = content.applications[1]?.releases ?? [];
    expect(release).toMatchObject({ id: published.id, version: '4.13.0', buildNumber: 125, flavorName: null });
    expect(release?.artifacts.map((artifact) => artifact.kind).sort()).toEqual(['apk', 'ipa']);

    const ipa = release?.artifacts.find((artifact) => artifact.kind === 'ipa');
    const apk = release?.artifacts.find((artifact) => artifact.kind === 'apk');
    const download = await fixture.app.inject({ method: 'GET', url: new URL(apk?.downloadUrl ?? '').pathname });

    expect(download.statusCode).toBe(200);
    expect(download.body).toBe('android build');
    expect(ipa?.installUrl).toContain('itms-services://?action=download-manifest&url=');

    const manifest = await open(tokenOf(created), `/artifacts/${ipa?.id ?? ''}/manifest.plist`);
    expect(manifest.body).toContain(`/public/shares/${tokenOf(created)}/artifacts/${ipa?.id ?? ''}/download</string>`);
    expect(manifest.body).toContain('<string>de.md.kmobile</string>');

    const entries = fixture.test.unitOfWork.read(({ auditLog }) => auditLog.list({ limit: 50, offset: 0 }));
    expect(entries.filter((entry) => entry.actor.type === 'share').map((entry) => entry.action)).toEqual([
      'artifact.downloaded',
      'share_link.viewed',
    ]);
    expect(entries.find((entry) => entry.actor.type === 'share')?.actor.label).toBe('Pflegedienst Meyer');
  });

  it('shows only the newest release when the link says so', async (): Promise<void> => {
    const newer = await publishedRelease(kMobile.id, {
      version: parseVersion('4.14.0'),
      buildNumber: parseBuildNumber(130),
    });
    const latest = await share({ type: 'project', projectId: project.id }, { releases: 'latest' });
    const all = await share({ type: 'project', projectId: project.id });
    const releasesOf = async (created: ShareLinkCreatedDto): Promise<number[]> =>
      json<SharedContentDto>(await open(tokenOf(created))).applications.flatMap((application) =>
        application.releases.map((release) => release.buildNumber),
      );
    const olderApk = fixture.test.unitOfWork
      .read(({ releases }) => releases.listArtifacts(published.id))
      .find((artifact) => artifact.kind === 'apk');

    expect(latest.shareLink.releases).toBe('latest');
    expect(all.shareLink.releases).toBe('all');
    expect(await releasesOf(latest)).toEqual([130]);
    expect(await releasesOf(all)).toEqual([130, 125]);
    expect((await open(tokenOf(latest), `/artifacts/${olderApk?.id ?? ''}/download`)).statusCode).toBe(404);
    expect((await open(tokenOf(all), `/artifacts/${olderApk?.id ?? ''}/download`)).statusCode).toBe(200);
    expect(newer.buildNumber).toBe(130);
  });

  it('limits an application link to that application', async (): Promise<void> => {
    const other = await publishedRelease(dokuAirPad.id);
    const token = tokenOf(await share({ type: 'application', applicationId: kMobile.id }));
    const content = json<SharedContentDto>(await open(token));
    const otherArtifact = fixture.test.unitOfWork.read(({ releases }) => releases.listArtifacts(other.id))[0];

    expect(content.applications.map((application) => application.name)).toEqual(['k-mobile']);
    expect((await open(token, `/artifacts/${otherArtifact?.id ?? ''}/download`)).statusCode).toBe(404);
  });

  it('never hands out drafts, build by-products or anything after revocation and expiry', async (): Promise<void> => {
    const draft = fixture.seedRelease(kMobile.id as ApplicationId, { buildNumber: 126 as Release['buildNumber'] });
    const draftApk = await fixture.storeArtifact(draft, 'apk', 'draft');
    const dsym = await fixture.storeArtifact(published, 'dsym', 'symbols');
    const created = await share({ type: 'project', projectId: project.id }, { expiresAt: '2026-11-01T00:00:00Z' });
    const token = tokenOf(created);

    expect((await open(token, `/artifacts/${draftApk.id}/download`)).statusCode).toBe(404);
    expect((await open(token, `/artifacts/${dsym.id}/download`)).statusCode).toBe(404);

    fixture.clock.advance(30 * 24 * 60 * 60_000);
    const expired = await open(token);
    expect(expired.statusCode).toBe(404);
    expect(json<ApiErrorDto>(expired).error.code).toBe('share_link_not_found');
    // The admin session has expired as well after a month.
    admin = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');

    const second = await share({ type: 'project', projectId: project.id });
    const revoke = await fixture.call(admin, { method: 'POST', url: `/api/share-links/${second.shareLink.id}/revoke` });
    expect(revoke.statusCode).toBe(204);
    expect((await open(tokenOf(second))).statusCode).toBe(404);
    expect(
      (await fixture.call(admin, { method: 'POST', url: `/api/share-links/${second.shareLink.id}/revoke` })).statusCode,
    ).toBe(404);
    expect((await open('x'.repeat(43))).statusCode).toBe(404);
    expect((await open('short')).statusCode).toBe(400);

    const listed = json<ShareLinkDto[]>(
      await fixture.call(admin, { method: 'GET', url: `/api/share-links?scope=project&id=${project.id}` }),
    );
    expect(listed.map((link) => [link.id, link.active])).toEqual([
      [second.shareLink.id, false],
      [created.shareLink.id, false],
    ]);
  });

  it('lists application links on the project and only their own on the application', async (): Promise<void> => {
    await share({ type: 'project', projectId: project.id });
    const appLink = await share({ type: 'application', applicationId: kMobile.id });

    const ofProject = json<ShareLinkDto[]>(
      await fixture.call(admin, { method: 'GET', url: `/api/share-links?scope=project&id=${project.id}` }),
    );
    const ofApplication = json<ShareLinkDto[]>(
      await fixture.call(admin, { method: 'GET', url: `/api/share-links?scope=application&id=${kMobile.id}` }),
    );

    expect(ofProject).toHaveLength(2);
    expect(ofApplication.map((link) => [link.id, link.scopeName])).toEqual([[appLink.shareLink.id, 'k-mobile']]);
    expect((await fixture.call(admin, { method: 'GET', url: '/api/share-links?scope=global' })).statusCode).toBe(400);
  });

  it('needs shares.manage and refuses invalid links', async (): Promise<void> => {
    const manager = await fixture.signIn('2000', 'release-manager');
    const roles = json<RoleDto[]>(await fixture.call(admin, { method: 'GET', url: '/api/roles' }));
    const users = json<UserSummaryDto[]>(
      await fixture.call(admin, { method: 'GET', url: '/api/users?query=release-manager' }),
    );
    await fixture.call(admin, {
      method: 'POST',
      url: '/api/role-assignments',
      payload: {
        roleId: roles.find((role) => role.key === 'release-manager')?.id,
        userId: users[0]?.id,
        scope: { type: 'project', projectId: project.id },
        reason: 'Releases',
      },
    });

    const refused = await fixture.call(manager, {
      method: 'POST',
      url: '/api/share-links',
      payload: { scope: { type: 'project', projectId: project.id }, label: 'Kunde' },
    });
    expect(refused.statusCode).toBe(403);
    expect(
      json<ApplicationDto>(await fixture.call(manager, { method: 'GET', url: `/api/applications/${kMobile.id}` }))
        .capabilities.manageShares,
    ).toBe(false);
    expect(
      json<ApplicationDto>(await fixture.call(admin, { method: 'GET', url: `/api/applications/${kMobile.id}` }))
        .capabilities.manageShares,
    ).toBe(true);

    const past = await fixture.call(admin, {
      method: 'POST',
      url: '/api/share-links',
      payload: { scope: { type: 'project', projectId: project.id }, label: 'Kunde', expiresAt: '2020-01-01T00:00:00Z' },
    });
    expect(json<ApiErrorDto>(past).error.code).toBe('invalid_share_link');

    await fixture.call(admin, {
      method: 'POST',
      url: `/api/projects/${project.id}/archive`,
      payload: { rowVersion: 1 },
    });
    const archived = await fixture.call(admin, {
      method: 'POST',
      url: '/api/share-links',
      payload: { scope: { type: 'application', applicationId: kMobile.id }, label: 'Kunde' },
    });
    expect(json<ApiErrorDto>(archived).error.code).toBe('invalid_share_link');
  });

  it('hides links of archived projects', async (): Promise<void> => {
    const token = tokenOf(await share({ type: 'application', applicationId: kMobile.id }));

    await fixture.call(admin, {
      method: 'POST',
      url: `/api/projects/${project.id}/archive`,
      payload: { rowVersion: 1 },
    });

    expect((await open(token)).statusCode).toBe(404);
  });
});
