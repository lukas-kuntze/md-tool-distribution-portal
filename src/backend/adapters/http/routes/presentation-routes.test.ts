import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ApplicationId } from '../../../domain/value-objects/identifier.js';
import type {
  ApiErrorDto,
  ApplicationDto,
  CatalogDto,
  CurrentUserDto,
  FlavorDto,
  ProjectDto,
  SharedContentDto,
  ShareLinkCreatedDto,
} from '../../../../shared/types/api.js';
import { ADMIN_GITHUB_ID, createHttpFixture, json, type HttpFixture } from '../testing/http-fixture.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);

describe('application presentation and download page', (): void => {
  let fixture: HttpFixture;
  let admin: string;
  let application: ApplicationDto;

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
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  const uploadIcon = (body: Buffer, contentType = 'image/png'): ReturnType<HttpFixture['call']> =>
    fixture.call(admin, {
      method: 'PUT',
      url: `/api/applications/${application.id}/icon`,
      headers: { 'content-type': contentType },
      payload: body,
    });
  const assetFiles = (): Promise<string[]> =>
    readdir(path.join(fixture.resolver.root, 'assets', application.id)).catch(() => []);

  it('stores, serves, replaces and removes the icon', async (): Promise<void> => {
    expect(application.iconUrl).toBeNull();

    const first = json<ApplicationDto>(await uploadIcon(PNG));
    expect(first.iconUrl).toMatch(new RegExp(`^/api/applications/${application.id}/icon\\?v=[0-9a-f]{16}$`));

    const served = await fixture.call(admin, { method: 'GET', url: first.iconUrl ?? '' });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toBe('private, max-age=86400');
    expect(served.rawPayload.equals(PNG)).toBe(true);

    // Declared as PNG, but the bytes decide: a JPEG is stored as JPEG and the old file is removed.
    const second = json<ApplicationDto>(await uploadIcon(JPEG));
    expect(second.iconUrl).not.toBe(first.iconUrl);
    expect(await assetFiles()).toEqual([expect.stringMatching(/\.jpg$/)]);
    expect((await fixture.call(admin, { method: 'GET', url: second.iconUrl ?? '' })).headers['content-type']).toBe(
      'image/jpeg',
    );

    const removed = json<ApplicationDto>(
      await fixture.call(admin, { method: 'DELETE', url: `/api/applications/${application.id}/icon`, payload: {} }),
    );
    expect(removed.iconUrl).toBeNull();
    expect(await assetFiles()).toEqual([]);
    expect(
      (await fixture.call(admin, { method: 'GET', url: `/api/applications/${application.id}/icon` })).statusCode,
    ).toBe(404);
  });

  it('stores the project icon and shows it in the project list', async (): Promise<void> => {
    const url = `/api/projects/${application.projectId}/icon`;
    const uploaded = json<ProjectDto>(
      await fixture.call(admin, { method: 'PUT', url, headers: { 'content-type': 'image/png' }, payload: PNG }),
    );

    expect(uploaded.iconUrl).toMatch(/^\/api\/projects\/.+\/icon\?v=[0-9a-f]{16}$/);
    expect(json<ProjectDto[]>(await fixture.call(admin, { method: 'GET', url: '/api/projects' }))[0]?.iconUrl).toBe(
      uploaded.iconUrl,
    );
    expect((await fixture.call(admin, { method: 'GET', url: uploaded.iconUrl ?? '' })).rawPayload.equals(PNG)).toBe(
      true,
    );
    expect(await readdir(path.join(fixture.resolver.root, 'assets', application.projectId))).toHaveLength(1);

    // Members without access to the project learn nothing about it, not even its icon.
    const outsider = await fixture.signIn('3000', 'outsider');
    expect((await fixture.call(outsider, { method: 'GET', url })).statusCode).toBe(404);

    const removed = json<ProjectDto>(await fixture.call(admin, { method: 'DELETE', url, payload: {} }));
    expect(removed.iconUrl).toBeNull();
    expect((await fixture.call(admin, { method: 'GET', url })).statusCode).toBe(404);
  });

  it('refuses files that are no PNG or JPEG and icons above 512 KB', async (): Promise<void> => {
    const svg = await uploadIcon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect(json<ApiErrorDto>(svg).error.code).toBe('invalid_icon');

    const large = await uploadIcon(Buffer.concat([PNG, Buffer.alloc(512 * 1024)]));
    expect(large.statusCode).toBe(413);
    expect(await assetFiles()).toEqual([]);

    const outsider = await fixture.signIn('3000', 'outsider');
    const refused = await fixture.call(outsider, {
      method: 'PUT',
      url: `/api/applications/${application.id}/icon`,
      headers: { 'content-type': 'image/png' },
      payload: PNG,
    });
    expect(refused.statusCode).toBe(403);
  });

  it('saves installation notes and the flavor order', async (): Promise<void> => {
    const updated = json<ApplicationDto>(
      await fixture.call(admin, {
        method: 'PATCH',
        url: `/api/applications/${application.id}`,
        payload: {
          rowVersion: application.rowVersion,
          installNotes: '  Nur für Diensthandys.\nAb iOS 16.  ',
          flavorsEnabled: true,
        },
      }),
    );
    expect(updated.installNotes).toBe('Nur für Diensthandys.\nAb iOS 16.');

    const beta = json<FlavorDto>(
      await fixture.call(admin, {
        method: 'POST',
        url: `/api/applications/${application.id}/flavors`,
        payload: { key: 'beta', name: 'Beta' },
      }),
    );
    const order = [beta.id, application.flavors[0]?.id ?? ''];
    const reordered = json<ApplicationDto>(
      await fixture.call(admin, {
        method: 'PUT',
        url: `/api/applications/${application.id}/flavor-order`,
        payload: { flavorIds: order },
      }),
    );
    expect(reordered.flavors.map((flavor) => flavor.id)).toEqual(order);

    const incomplete = await fixture.call(admin, {
      method: 'PUT',
      url: `/api/applications/${application.id}/flavor-order`,
      payload: { flavorIds: [beta.id] },
    });
    expect(json<ApiErrorDto>(incomplete).error.code).toBe('invalid_flavor_order');
  });

  it('shows icon and notes on share links and on the download page for the organisation', async (): Promise<void> => {
    await uploadIcon(PNG);
    await fixture.call(admin, {
      method: 'PATCH',
      url: `/api/applications/${application.id}`,
      payload: { rowVersion: application.rowVersion, installNotes: 'Bitte vorher abmelden.' },
    });
    const release = fixture.seedRelease(application.id as ApplicationId);
    await fixture.storeArtifact(release, 'apk', 'android build');
    await fixture.storeArtifact(release, 'ipa', 'ios build');
    await fixture.call(admin, {
      method: 'POST',
      url: `/api/releases/${release.id}/publish`,
      payload: { rowVersion: 1 },
    });

    const created = json<ShareLinkCreatedDto>(
      await fixture.call(admin, {
        method: 'POST',
        url: '/api/share-links',
        payload: { scope: { type: 'application', applicationId: application.id }, label: 'Meyer' },
      }),
    );
    const token = new URL(created.url).hash.slice(1);
    const shared = json<SharedContentDto>(await fixture.app.inject({ method: 'GET', url: `/public/shares/${token}` }));
    const sharedApp = shared.applications[0];
    expect(sharedApp?.installNotes).toBe('Bitte vorher abmelden.');
    expect(sharedApp?.iconUrl).toContain(`/public/shares/${token}/applications/${application.id}/icon?v=`);

    const publicIcon = await fixture.app.inject({ method: 'GET', url: new URL(sharedApp?.iconUrl ?? '').pathname });
    expect(publicIcon.statusCode).toBe(200);
    expect(publicIcon.rawPayload.equals(PNG)).toBe(true);

    // A member without any role starts on the download page and sees nothing while the app is private.
    const member = await fixture.signIn('4000', 'member');
    const session = json<CurrentUserDto>(await fixture.call(member, { method: 'GET', url: '/api/session' }));
    expect(session.capabilities.administers).toBe(false);
    expect(json<CatalogDto>(await fixture.call(member, { method: 'GET', url: '/api/catalog' })).projects).toEqual([]);

    const current = json<ApplicationDto>(
      await fixture.call(admin, { method: 'GET', url: `/api/applications/${application.id}` }),
    );
    await fixture.call(admin, {
      method: 'PATCH',
      url: `/api/applications/${application.id}`,
      payload: { rowVersion: current.rowVersion, visibility: 'organization' },
    });

    const catalog = json<CatalogDto>(await fixture.call(member, { method: 'GET', url: '/api/catalog' }));
    const entry = catalog.projects[0]?.applications[0];
    expect(catalog.projects.map((project) => project.name)).toEqual(['MD Ambulant']);
    expect(entry).toMatchObject({ name: 'K Mobile', installNotes: 'Bitte vorher abmelden.' });
    expect(entry?.releases[0]?.artifacts.map((artifact) => [artifact.kind, artifact.installUrl])).toEqual(
      expect.arrayContaining([
        ['apk', null],
        ['ipa', null],
      ]),
    );
    expect((await fixture.call(member, { method: 'GET', url: entry?.iconUrl ?? '' })).statusCode).toBe(200);

    const apk = entry?.releases[0]?.artifacts.find((artifact) => artifact.kind === 'apk');
    expect((await fixture.call(member, { method: 'GET', url: apk?.downloadUrl ?? '' })).statusCode).toBe(200);
  });
});
