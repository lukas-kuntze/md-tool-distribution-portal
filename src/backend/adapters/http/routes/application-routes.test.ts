import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ApiErrorDto, ApplicationDto, FlavorDto, ProjectDto } from '../../../../shared/types/api.js';
import { ADMIN_GITHUB_ID, createHttpFixture, json, type HttpFixture } from '../testing/http-fixture.js';

describe('application routes', (): void => {
  let fixture: HttpFixture;
  let admin: string;
  let project: ProjectDto;

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
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  async function createApplication(visibility: 'private' | 'organization' = 'private'): Promise<ApplicationDto> {
    const response = await fixture.call(admin, {
      method: 'POST',
      url: `/api/projects/${project.id}/applications`,
      payload: {
        slug: 'k-mobile',
        name: 'K Mobile',
        framework: 'dotnet_maui',
        platforms: ['ios', 'android'],
        visibility,
        bundleIdentifiers: { android: 'de.md.kmobile', ios: 'de.md.kmobile' },
      },
    });

    expect(response.statusCode).toBe(201);
    return json<ApplicationDto>(response);
  }

  it('creates an application with its default flavor', async (): Promise<void> => {
    const application = await createApplication();

    expect(application).toMatchObject({
      framework: 'dotnet_maui',
      platforms: ['android', 'ios'],
      flavorsEnabled: false,
      flavors: [
        { key: 'default', isDefault: true, bundleIdentifiers: { android: 'de.md.kmobile', ios: 'de.md.kmobile' } },
      ],
      capabilities: { manage: true, deleteReleases: true },
    });
    expect(
      json<ApplicationDto[]>(
        await fixture.call(admin, { method: 'GET', url: `/api/projects/${project.id}/applications` }),
      ),
    ).toHaveLength(1);
  });

  it('enables flavors, adds one and archives it again', async (): Promise<void> => {
    const application = await createApplication();
    const enabled = await fixture.call(admin, {
      method: 'PATCH',
      url: `/api/applications/${application.id}`,
      payload: { rowVersion: 1, flavorsEnabled: true },
    });
    const flavorResponse = await fixture.call(admin, {
      method: 'POST',
      url: `/api/applications/${application.id}/flavors`,
      payload: {
        key: 'unterstuetzung',
        name: 'Unterstützung',
        bundleIdentifiers: { android: 'de.md.kmobile.support' },
      },
    });
    const flavor = json<FlavorDto>(flavorResponse);
    const archived = await fixture.call(admin, {
      method: 'PATCH',
      url: `/api/flavors/${flavor.id}`,
      payload: { rowVersion: 1, status: 'archived', name: 'Unterstützung (alt)' },
    });

    expect(json<ApplicationDto>(enabled).flavorsEnabled).toBe(true);
    expect(flavorResponse.statusCode).toBe(201);
    expect(json<FlavorDto>(archived)).toMatchObject({ status: 'archived', name: 'Unterstützung (alt)', rowVersion: 2 });
  });

  it('keeps package names unique and flavor support consistent', async (): Promise<void> => {
    const application = await createApplication();

    const withoutFlavors = await fixture.call(admin, {
      method: 'POST',
      url: `/api/applications/${application.id}/flavors`,
      payload: { key: 'support', name: 'Support' },
    });
    await fixture.call(admin, {
      method: 'PATCH',
      url: `/api/applications/${application.id}`,
      payload: { rowVersion: 1, flavorsEnabled: true },
    });
    const duplicate = await fixture.call(admin, {
      method: 'POST',
      url: `/api/applications/${application.id}/flavors`,
      payload: { key: 'support', name: 'Support', bundleIdentifiers: { ios: 'de.md.kmobile' } },
    });

    expect(json<ApiErrorDto>(withoutFlavors).error.code).toBe('flavors_not_enabled');
    expect(json<ApiErrorDto>(duplicate).error.code).toBe('bundle_identifier_taken');
  });

  it('shows organisation-wide applications to every signed-in user, private ones only to members', async (): Promise<void> => {
    const application = await createApplication('organization');
    const user = await fixture.signIn('2000', 'octocat');

    const visible = json<ApplicationDto>(
      await fixture.call(user, { method: 'GET', url: `/api/applications/${application.id}` }),
    );
    expect(visible.capabilities).toMatchObject({ manage: false, downloadArtifacts: true, readDrafts: false });

    await fixture.call(admin, {
      method: 'PATCH',
      url: `/api/applications/${application.id}`,
      payload: { rowVersion: 1, visibility: 'private' },
    });
    expect((await fixture.call(user, { method: 'GET', url: `/api/applications/${application.id}` })).statusCode).toBe(
      404,
    );
    expect(
      (
        await fixture.call(user, {
          method: 'PATCH',
          url: `/api/applications/${application.id}`,
          payload: { rowVersion: 2, name: 'X' },
        })
      ).statusCode,
    ).toBe(403);
  });
});
