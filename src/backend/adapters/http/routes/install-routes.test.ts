import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ReleaseArtifact } from '../../../domain/entities/release-artifact.js';
import type { Release } from '../../../domain/entities/release.js';
import type { ApplicationId } from '../../../domain/value-objects/identifier.js';
import type { ApiErrorDto, ApplicationDto, InstallLinkDto, ProjectDto } from '../../../../shared/types/api.js';
import {
  ADMIN_GITHUB_ID,
  createHttpFixture,
  INSTALL_LINK_LIFETIME_MS,
  json,
  PUBLIC_URL,
  type HttpFixture,
} from '../testing/http-fixture.js';
import { manifestPlist } from './install-routes.js';

describe('install routes', (): void => {
  let fixture: HttpFixture;
  let admin: string;
  let release: Release;
  let ipa: ReleaseArtifact;

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
    ipa = await fixture.storeArtifact(release, 'ipa', 'ios build');
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  async function issue(cookie: string, artifactId: string = ipa.id): Promise<InstallLinkDto> {
    const response = await fixture.call(cookie, { method: 'POST', url: `/api/artifacts/${artifactId}/install-link` });

    expect(response.statusCode).toBe(200);
    return json<InstallLinkDto>(response);
  }

  const pathOf = (url: string): string => new URL(url).pathname;

  it('installs an IPA through manifest and download without cookies', async (): Promise<void> => {
    const link = await issue(admin);

    expect(link.installUrl).toBe(
      `itms-services://?action=download-manifest&url=${encodeURIComponent(link.manifestUrl)}`,
    );
    expect(link.manifestUrl).toMatch(new RegExp(`^${PUBLIC_URL}/install/[\\w-]+\\.[\\w-]+/manifest\\.plist$`));

    const manifest = await fixture.app.inject({ method: 'GET', url: pathOf(link.manifestUrl) });
    const ipaUrl = link.manifestUrl.replace('manifest.plist', 'app.ipa');

    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers['content-type']).toBe('text/xml; charset=utf-8');
    expect(manifest.body).toContain(`<string>${ipaUrl}</string>`);
    expect(manifest.body).toContain('<string>de.md.kmobile</string>');
    expect(manifest.body).toContain('<string>4.13.0</string>');
    expect(manifest.body).toContain('<string>K Mobile</string>');

    const download = await fixture.app.inject({ method: 'GET', url: pathOf(ipaUrl) });

    expect(download.statusCode).toBe(200);
    expect(download.body).toBe('ios build');
    expect(download.headers['content-disposition']).toContain('k-mobile-4.13.0-125.ipa');

    const partial = await fixture.app.inject({ method: 'GET', url: pathOf(ipaUrl), headers: { range: 'bytes=0-2' } });

    expect(partial.statusCode).toBe(206);
    expect(partial.body).toBe('ios');

    const actions = fixture.test.unitOfWork
      .read(({ auditLog }) => auditLog.list({ limit: 20, offset: 0 }))
      .map((entry) => `${entry.action}:${entry.actor.type === 'user' ? entry.actor.label : ''}`);

    expect(actions).toEqual(
      expect.arrayContaining(['artifact.install_link.issued:admin', 'artifact.downloaded:admin']),
    );
  });

  it('offers installation links for IPA files only', async (): Promise<void> => {
    const apk = await fixture.storeArtifact(release, 'apk', 'android build');
    const response = await fixture.call(admin, { method: 'POST', url: `/api/artifacts/${apk.id}/install-link` });

    expect(response.statusCode).toBe(422);
    expect(json<ApiErrorDto>(response).error.code).toBe('invalid_artifact');
  });

  it('refuses users without access to the release', async (): Promise<void> => {
    const outsider = await fixture.signIn('3000', 'outsider');
    const response = await fixture.call(outsider, { method: 'POST', url: `/api/artifacts/${ipa.id}/install-link` });

    expect(response.statusCode).toBe(403);
  });

  it('rejects tampered and expired tokens', async (): Promise<void> => {
    const link = await issue(admin);
    const [, token = ''] = /\/install\/([^/]+)\//.exec(link.manifestUrl) ?? [];
    const [payload = '', signature = ''] = token.split('.');
    const forged = `${payload}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;

    expect((await fixture.app.inject({ method: 'GET', url: `/install/${forged}/manifest.plist` })).statusCode).toBe(
      404,
    );
    expect((await fixture.app.inject({ method: 'GET', url: '/install/not-a-token/app.ipa' })).statusCode).toBe(400);

    fixture.clock.advance(INSTALL_LINK_LIFETIME_MS);
    const expired = await fixture.app.inject({ method: 'GET', url: pathOf(link.manifestUrl) });

    expect(expired.statusCode).toBe(404);
    expect(json<ApiErrorDto>(expired).error.code).toBe('install_link_invalid');
  });

  it('stops issued links once the release is being deleted', async (): Promise<void> => {
    const link = await issue(admin);
    const deletion = await fixture.call(admin, {
      method: 'DELETE',
      url: `/api/releases/${release.id}`,
      payload: { rowVersion: 1, confirmation: 'k-mobile 4.13.0 (125)', reason: 'Absturz' },
    });

    expect(deletion.statusCode).toBe(202);
    expect((await fixture.app.inject({ method: 'GET', url: pathOf(link.manifestUrl) })).statusCode).toBe(404);
    expect(
      (await fixture.app.inject({ method: 'GET', url: pathOf(link.manifestUrl.replace('manifest.plist', 'app.ipa')) }))
        .statusCode,
    ).toBe(404);
  });

  it('escapes metadata in the manifest', (): void => {
    const plist = manifestPlist(
      { artifactId: ipa.id, title: 'A & B <Test>', bundleIdentifier: 'de.md.app', version: '1.0.0' },
      'https://apps.example.com/install/x.y/app.ipa',
    );

    expect(plist).toContain('<string>A &amp; B &lt;Test&gt;</string>');
  });
});
