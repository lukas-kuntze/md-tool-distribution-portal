import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardDto } from '../../../shared/types/api.js';
import { APPLICATION_ID, PROJECT_ID, RELEASE_ID } from '../testing/fixtures.js';
import { apiError, fakeApi, loadPage, textOf } from '../testing/page.js';
import { DashboardPage, newestOf } from './dashboard-page.js';

const DASHBOARD: DashboardDto = {
  downloadDays: 30,
  quarantineDays: 7,
  shareExpiryDays: 14,
  previousSignInAt: '2026-10-16T07:30:00.000Z',
  shareLinks: { active: 3, expiringSoon: 1 },
  quarantineEnding: [
    {
      releaseId: 'r-q',
      version: '4.10.0',
      buildNumber: 120,
      purgeAfter: '2026-10-20T08:00:00.000Z',
      applicationId: APPLICATION_ID,
      applicationName: 'K Mobile',
      projectName: 'MD Ambulant',
      canRestore: true,
    },
  ],
  totals: { projects: 2, applications: 3, published: 1234, drafts: 2, inDeletion: 1, downloads: 57 },
  projects: [
    {
      id: PROJECT_ID,
      name: 'MD Ambulant',
      applications: [
        {
          id: APPLICATION_ID,
          name: 'K Mobile',
          published: 4,
          drafts: 2,
          inDeletion: 1,
          downloads: 50,
          latest: {
            releaseId: RELEASE_ID,
            version: '4.13.0',
            buildNumber: 125,
            publishedAt: '2026-10-15T09:00:00.000Z',
          },
        },
        {
          id: 'other',
          name: 'Doku AirPad',
          published: 1,
          drafts: 0,
          inDeletion: 0,
          downloads: 7,
          latest: { releaseId: 'r-old', version: '1.0.0', buildNumber: 1, publishedAt: '2026-09-01T09:00:00.000Z' },
        },
      ],
    },
    { id: 'empty', name: 'Neu', applications: [] },
  ],
  recentReleases: [
    {
      id: RELEASE_ID,
      version: '4.13.0',
      buildNumber: 125,
      publicationStatus: 'published',
      lifecycleState: 'active',
      createdAt: '2026-10-14T09:00:00.000Z',
      publishedAt: '2026-10-15T09:00:00.000Z',
      applicationId: APPLICATION_ID,
      applicationName: 'K Mobile',
      projectId: PROJECT_ID,
      projectName: 'MD Ambulant',
    },
    {
      id: 'r2',
      version: '4.12.0',
      buildNumber: 124,
      publicationStatus: 'withdrawn',
      lifecycleState: 'quarantined',
      createdAt: '2026-10-10T09:00:00.000Z',
      publishedAt: null,
      applicationId: APPLICATION_ID,
      applicationName: 'K Mobile',
      projectId: PROJECT_ID,
      projectName: 'MD Ambulant',
    },
  ],
};

describe('dashboard', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('shows totals, projects and the newest releases', async (): Promise<void> => {
    loadPage('index', '/');
    fakeApi({ 'GET /api/dashboard': DASHBOARD });

    await DashboardPage.init();

    // The icon is decoration; its ligature text is not part of what the card says.
    expect(
      Array.from(document.querySelectorAll('.stat-card'), (card) =>
        Array.from(card.children)
          .filter((child) => !child.classList.contains('stat-icon'))
          .map((child) => child.textContent)
          .join(''),
      ),
    ).toEqual([
      'Projekte2',
      'Anwendungen3',
      'Veröffentlicht1.2342 Entwürfe · 1 in Löschung',
      'Downloads57letzte 30 Tage',
      'Aktive Freigaben31 läuft in 14 Tagen ab',
    ]);
    expect(Array.from(document.querySelectorAll('.stat-icon'), (icon) => icon.textContent)).toEqual([
      'folder',
      'apps',
      'rocket_launch',
      'download',
      'link',
    ]);

    expect(textOf('[data-dashboard-signin]')).toMatch(/^Zuletzt angemeldet am 16.10.2026/);
    expect(document.querySelector<HTMLElement>('[data-dashboard-quarantine]')?.hidden).toBe(false);
    expect(textOf('[data-dashboard-quarantine]')).toContain('1 Release');
    expect(textOf('[data-dashboard-quarantine-list]')).toContain('4.10.0 (120)');
    expect(textOf('[data-dashboard-quarantine-list]')).toContain('Wiederherstellen');

    const rows = Array.from(document.querySelectorAll('[data-dashboard-projects] tbody tr'), (row) =>
      Array.from(row.querySelectorAll('td'), (cell) => cell.textContent),
    );
    expect(rows[0]).toEqual(['MD Ambulant', '2', '5', '2', '57', 'K Mobile 4.13.0 (125)15.10.2026']);
    expect(rows[1]?.[5]).toBe('noch keine');
    expect(textOf('[data-dashboard-releases] tbody')).toContain('In Quarantäne');
    expect(document.querySelector('[data-dashboard-releases] a')?.getAttribute('href')).toBe(
      `/release.html?id=${RELEASE_ID}`,
    );
  });

  it('explains an empty dashboard and loading errors', async (): Promise<void> => {
    loadPage('index', '/');
    fakeApi({
      'GET /api/dashboard': {
        ...DASHBOARD,
        totals: { projects: 0, applications: 0, published: 0, drafts: 0, inDeletion: 0, downloads: 0 },
        previousSignInAt: null,
        shareLinks: null,
        quarantineEnding: [],
        projects: [],
        recentReleases: [],
      },
    });
    await DashboardPage.init();
    expect(textOf('[data-dashboard-projects]')).toContain('Noch nichts zu sehen');
    expect(textOf('[data-dashboard-releases]')).toContain('Noch keine Releases');
    expect(textOf('[data-dashboard-signin]')).toBe('Willkommen! Das ist deine erste Anmeldung.');
    expect(document.querySelector<HTMLElement>('[data-dashboard-quarantine]')?.hidden).toBe(true);
    expect(document.querySelectorAll('.stat-card')).toHaveLength(4);

    loadPage('index', '/');
    fakeApi({ 'GET /api/dashboard': apiError(500, 'internal_error') });
    await DashboardPage.init();
    expect(textOf('[data-page-state]')).toContain('Laden fehlgeschlagen');
  });

  it('finds the most recently published version of a project', (): void => {
    expect(newestOf(DASHBOARD.projects[0] ?? { id: '', name: '', applications: [] })?.name).toBe('K Mobile');
    expect(newestOf({ id: 'x', name: 'x', applications: [] })).toBeNull();
  });
});
