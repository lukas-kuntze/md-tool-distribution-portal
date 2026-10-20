import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SettingsCache } from '../../../application/manage-settings.js';
import type {
  ApiErrorDto,
  ApplicationDto,
  BrandingDto,
  DashboardDto,
  ProjectDto,
  SettingPresetsDto,
  SettingsDto,
} from '../../../../shared/types/api.js';
import { ADMIN_GITHUB_ID, createHttpFixture, json, type HttpFixture } from '../testing/http-fixture.js';

describe('settings', (): void => {
  let fixture: HttpFixture;
  let admin: string;

  beforeEach(async (): Promise<void> => {
    fixture = await createHttpFixture();
    admin = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  const load = async (): Promise<SettingsDto> =>
    json<SettingsDto>(await fixture.call(admin, { method: 'GET', url: '/api/settings' }));
  const save = (settings: SettingsDto, cookie = admin): ReturnType<HttpFixture['call']> =>
    fixture.call(cookie, { method: 'PUT', url: '/api/settings', payload: settings });

  it('saves the settings, audits the changes and refuses lost updates', async (): Promise<void> => {
    const current = await load();
    expect(current).toMatchObject({ quarantineDays: 7, portalName: 'App-Distribution', rowVersion: 1 });

    const saved = json<SettingsDto>(await save({ ...current, quarantineDays: 14, portalName: ' MEDIFOX DAN Apps ' }));
    expect(saved).toMatchObject({ quarantineDays: 14, portalName: 'MEDIFOX DAN Apps', rowVersion: 2 });
    expect(await load()).toEqual(saved);

    const stale = await save({ ...current, quarantineDays: 21 });
    expect(json<ApiErrorDto>(stale).error.code).toBe('concurrent_modification');

    const invalid = await save({ ...saved, sessionAbsoluteHours: 1, sessionIdleMinutes: 120 });
    expect(json<ApiErrorDto>(invalid).error.code).toBe('invalid_settings');

    const audit = fixture.test.unitOfWork.read(({ auditLog }) =>
      auditLog.list({ actionPrefix: 'settings.', limit: 10, offset: 0 }),
    );
    expect(audit.map((entry) => [entry.action, entry.details])).toEqual([
      [
        'settings.updated',
        {
          before: { quarantineDays: 7, portalName: 'App-Distribution' },
          after: { quarantineDays: 14, portalName: 'MEDIFOX DAN Apps' },
        },
      ],
    ]);
  });

  it('is reserved to platform administrators, while presets and branding are open', async (): Promise<void> => {
    const member = await fixture.signIn('3000', 'member');
    const current = await load();

    expect((await fixture.call(member, { method: 'GET', url: '/api/settings' })).statusCode).toBe(403);
    expect((await save(current, member)).statusCode).toBe(403);
    expect(
      json<SettingPresetsDto>(await fixture.call(member, { method: 'GET', url: '/api/settings/presets' })),
    ).toEqual({
      shareLinkDefaultDays: null,
      shareLinkMaxDays: null,
      shareLinkDefaultReleases: 'all',
      defaultVisibility: 'private',
    });

    await save({ ...current, supportContact: 'it-service@example.com', publicNotice: 'Nur Diensthandys' });
    const branding = await fixture.app.inject({ method: 'GET', url: '/public/branding' });
    expect(json<BrandingDto>(branding)).toEqual({
      portalName: 'App-Distribution',
      supportContact: 'it-service@example.com',
      publicNotice: 'Nur Diensthandys',
      footerText: 'Bereitgestellt über die App-Distribution',
    });
  });

  it('applies visibility, share link and dashboard settings', async (): Promise<void> => {
    await save({
      ...(await load()),
      defaultVisibility: 'organization',
      shareLinkDefaultDays: 14,
      shareLinkMaxDays: 30,
      dashboardDownloadDays: 7,
    });

    const project = json<ProjectDto>(
      await fixture.call(admin, { method: 'POST', url: '/api/projects', payload: { slug: 'p', name: 'P' } }),
    );
    const application = json<ApplicationDto>(
      await fixture.call(admin, {
        method: 'POST',
        url: `/api/projects/${project.id}/applications`,
        payload: { slug: 'a', name: 'A', platforms: ['android'] },
      }),
    );
    expect(application.visibility).toBe('organization');

    const share = (expiresAt: string | null): ReturnType<HttpFixture['call']> =>
      fixture.call(admin, {
        method: 'POST',
        url: '/api/share-links',
        payload: { scope: { type: 'project', projectId: project.id }, label: 'Kunde', expiresAt },
      });
    const now = fixture.clock.now().getTime();
    const inDays = (count: number): string => new Date(now + count * 24 * 60 * 60_000).toISOString();

    expect(json<ApiErrorDto>(await share(null)).error.code).toBe('share_link_too_long');
    expect(json<ApiErrorDto>(await share(inDays(32))).error.code).toBe('share_link_too_long');
    // The last allowed day counts in full, as the dialog sends the end of the chosen day.
    expect((await share(inDays(30.9))).statusCode).toBe(201);

    expect(json<DashboardDto>(await fixture.call(admin, { method: 'GET', url: '/api/dashboard' })).downloadDays).toBe(
      7,
    );
  });

  it('lets running processes pick up a change after a few seconds', async (): Promise<void> => {
    const cache = new SettingsCache(fixture.test.unitOfWork, fixture.clock);
    expect(cache.current().quarantineDays).toBe(7);

    await save({ ...(await load()), quarantineDays: 30 });
    expect(cache.current().quarantineDays).toBe(7);

    fixture.clock.advance(5_000);
    expect(cache.current().quarantineDays).toBe(30);
  });
});
