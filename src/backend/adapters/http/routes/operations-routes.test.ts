import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuditEntryDto, DeletionJobDto, PlatformSettingsDto, ProjectDto } from '../../../../shared/types/api.js';
import {
  ADMIN_GITHUB_ID,
  createHttpFixture,
  INSTALL_LINK_SECRET,
  json,
  type HttpFixture,
} from '../testing/http-fixture.js';

describe('operations routes', (): void => {
  let fixture: HttpFixture;
  let admin: string;

  beforeEach(async (): Promise<void> => {
    fixture = await createHttpFixture();
    admin = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  it('lists audit entries newest first with filters and scope', async (): Promise<void> => {
    const project = json<ProjectDto>(
      await fixture.call(admin, {
        method: 'POST',
        url: '/api/projects',
        payload: { slug: 'md-ambulant', name: 'MD Ambulant' },
      }),
    );
    await fixture.call(admin, { method: 'POST', url: '/api/projects', payload: { slug: 'other', name: 'Other' } });

    const all = json<AuditEntryDto[]>(await fixture.call(admin, { method: 'GET', url: '/api/audit-logs' }));
    const scoped = json<AuditEntryDto[]>(
      await fixture.call(admin, { method: 'GET', url: `/api/audit-logs?scope=project&id=${project.id}` }),
    );
    const filtered = json<AuditEntryDto[]>(
      await fixture.call(admin, { method: 'GET', url: '/api/audit-logs?action=auth.&limit=1' }),
    );

    expect(all.map((entry) => entry.action)).toEqual(['project.created', 'project.created', 'auth.sign_in']);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toMatchObject({ action: 'project.created', actor: { type: 'user', label: 'admin' } });
    expect(filtered.map((entry) => entry.action)).toEqual(['auth.sign_in']);
    expect(
      (await fixture.call(admin, { method: 'GET', url: '/api/audit-logs?action=project.&limit=1' })).headers[
        'x-total-count'
      ],
    ).toBe('2');
  });

  it('reserves audit log and deletion jobs to the right permissions', async (): Promise<void> => {
    const user = await fixture.signIn('2000', 'octocat');

    expect((await fixture.call(user, { method: 'GET', url: '/api/audit-logs' })).statusCode).toBe(403);
    expect((await fixture.call(user, { method: 'GET', url: '/api/deletion-jobs' })).statusCode).toBe(403);
    expect(
      json<DeletionJobDto[]>(await fixture.call(admin, { method: 'GET', url: '/api/deletion-jobs?state=failed' })),
    ).toEqual([]);
  });

  it('shows the platform settings to operators only, without secrets', async (): Promise<void> => {
    const settings = json<PlatformSettingsDto>(
      await fixture.call(admin, { method: 'GET', url: '/api/platform-settings' }),
    );

    expect(settings).toMatchObject({
      version: '0.1.0',
      publicUrl: 'https://apps.example.com',
      limits: { quarantineDays: 7, installLinkMinutes: 10, sessionAbsoluteHours: 12, sessionIdleMinutes: 120 },
      worker: { pollSeconds: 30, leaseMinutes: 15, reconcileHours: 24 },
    });
    expect(JSON.stringify(settings)).not.toContain(INSTALL_LINK_SECRET);

    const user = await fixture.signIn('2000', 'octocat');
    expect((await fixture.call(user, { method: 'GET', url: '/api/platform-settings' })).statusCode).toBe(403);
  });
});
