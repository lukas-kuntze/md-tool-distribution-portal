import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CatalogDto, SharedApplicationDto } from '../../../shared/types/api.js';
import { APPLICATION_ID, PROJECT_ID } from '../testing/fixtures.js';
import { click, fakeApi, loadPage, stubNavigation, textOf, type, user } from '../testing/page.js';
import { AppsPage } from './apps-page.js';
import { DashboardPage } from './dashboard-page.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

function app(overrides: Partial<SharedApplicationDto> = {}): SharedApplicationDto {
  return {
    id: APPLICATION_ID,
    name: 'K Mobile',
    description: 'Mobile Pflege',
    platforms: ['android', 'ios'],
    installNotes: 'Nur auf Diensthandys.',
    iconUrl: `/api/applications/${APPLICATION_ID}/icon?v=abc`,
    releases: [
      {
        id: 'r-prod',
        version: '4.13.0',
        buildNumber: 125,
        flavorName: 'Production',
        publishedAt: '2026-10-15T09:00:00.000Z',
        releaseNotes: '',
        artifacts: [
          {
            id: 'apk',
            kind: 'apk',
            platform: 'android',
            sizeBytes: 1024,
            downloadUrl: '/api/artifacts/apk/download',
            installUrl: null,
          },
          {
            id: 'ipa',
            kind: 'ipa',
            platform: 'ios',
            sizeBytes: 2048,
            downloadUrl: '/api/artifacts/ipa/download',
            installUrl: null,
          },
        ],
      },
      {
        id: 'r-beta',
        version: '4.14.0',
        buildNumber: 130,
        flavorName: 'Beta',
        publishedAt: '2026-10-16T09:00:00.000Z',
        releaseNotes: '',
        artifacts: [],
      },
    ],
    ...overrides,
  };
}

const CATALOG: CatalogDto = {
  projects: [{ id: PROJECT_ID, name: 'MD Ambulant', description: '', applications: [app()] }],
};

describe('download page', (): void => {
  afterEach((): void => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lists the installable apps with icon, notes and the current release per flavor', async (): Promise<void> => {
    loadPage('apps');
    fakeApi({ 'GET /api/session': user({ administers: false }), 'GET /api/catalog': CATALOG });

    await AppsPage.init();

    expect(textOf('[data-apps-projects] h2')).toBe('MD Ambulant');
    expect(document.querySelector('.share-app img.app-icon')?.getAttribute('src')).toBe(
      `/api/applications/${APPLICATION_ID}/icon?v=abc`,
    );
    expect(textOf('.install-notes')).toContain('Nur auf Diensthandys.');
    // Both flavors are current; the first release of each flavor carries the badge.
    expect(document.querySelectorAll('.share-release .badge-success')).toHaveLength(2);
    expect(document.querySelector<HTMLElement>('[data-admin-link]')?.hidden).toBe(true);
    expect(textOf('[data-apps-notice]')).toContain('iPhone und iPad');
  });

  it('requests a signed installation link on iPhone', async (): Promise<void> => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    const navigation = stubNavigation();
    loadPage('apps');
    const calls = fakeApi({
      'GET /api/session': user(),
      'GET /api/catalog': CATALOG,
      'POST /api/artifacts/ipa/install-link': {
        installUrl: 'itms-services://?action=download-manifest&url=signed',
        manifestUrl: 'https://apps.example.com/install/signed/manifest.plist',
        expiresAt: '2026-10-17T10:00:00.000Z',
      },
    });

    await AppsPage.init();
    expect(document.querySelector<HTMLElement>('[data-admin-link]')?.hidden).toBe(false);

    click('.share-actions button.btn-primary');
    await vi.waitFor(() =>
      expect(navigation.targets).toEqual(['itms-services://?action=download-manifest&url=signed']),
    );
    expect(calls.some((call) => call.path === '/api/artifacts/ipa/install-link')).toBe(true);
  });

  it('narrows the page to one project when opened from a project page', async (): Promise<void> => {
    loadPage('apps', `/apps.html?project=${PROJECT_ID}`);
    fakeApi({
      'GET /api/session': user(),
      'GET /api/catalog': {
        projects: [...CATALOG.projects, { id: 'other', name: 'MD Stationär', description: '', applications: [app()] }],
      },
    });

    await AppsPage.init();

    const projects = (): (string | null)[] =>
      Array.from(document.querySelectorAll('[data-apps-projects] h2.section-title'), (title) => title.textContent);
    expect(textOf('[data-apps-title]')).toBe('Apps installieren · MD Ambulant');
    expect(projects()).toEqual(['MD Ambulant']);
    expect(document.querySelector<HTMLSelectElement>('#apps-project')?.value).toBe(PROJECT_ID);
    // Apps of a project stand side by side in a grid.
    expect(document.querySelectorAll('[data-apps-projects] .apps-grid > .card')).toHaveLength(1);

    type('#apps-project', 'other');
    expect(projects()).toEqual(['MD Stationär']);
    expect(textOf('[data-apps-title]')).toBe('Apps installieren · MD Stationär');
    expect(window.location.search).toBe('?project=other');

    type('#apps-project', '');
    expect(projects()).toEqual(['MD Ambulant', 'MD Stationär']);
    expect(textOf('[data-apps-title]')).toBe('Apps installieren');
    expect(window.location.search).toBe('');
  });

  it('offers no project filter for a single project', async (): Promise<void> => {
    loadPage('apps');
    fakeApi({ 'GET /api/session': user(), 'GET /api/catalog': CATALOG });

    await AppsPage.init();

    expect(document.querySelector<HTMLElement>('#apps-project')?.closest<HTMLElement>('.form-group')?.hidden).toBe(
      true,
    );
  });

  it('explains an empty catalog', async (): Promise<void> => {
    loadPage('apps');
    fakeApi({ 'GET /api/session': user({ administers: false }), 'GET /api/catalog': { projects: [] } });

    await AppsPage.init();

    expect(textOf('[data-apps-projects]')).toContain('Keine Apps verfügbar');
  });

  it('sends users without an administrative role from the dashboard to the download page', async (): Promise<void> => {
    loadPage('index', '/');
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => undefined);
    fakeApi({ 'GET /api/session': user({ administers: false }) });

    await DashboardPage.init();

    expect(replace).toHaveBeenCalledWith('/apps.html');
  });

  it('filters the releases by flavor and keeps the choice in the address', async (): Promise<void> => {
    loadPage('apps', '/apps.html?flavor=Beta');
    fakeApi({ 'GET /api/session': user({ administers: false }), 'GET /api/catalog': CATALOG });

    await AppsPage.init();

    const select = document.querySelector<HTMLSelectElement>('#apps-flavor');
    expect(Array.from(select?.options ?? [], (option) => option.text)).toEqual(['Alle Flavors', 'Beta', 'Production']);
    expect(select?.value).toBe('Beta');
    expect(textOf('[data-apps-projects]')).toContain('4.14.0');
    expect(textOf('[data-apps-projects]')).not.toContain('4.13.0');

    type('#apps-flavor', 'Production');
    expect(textOf('[data-apps-projects]')).toContain('4.13.0');
    expect(textOf('[data-apps-projects]')).not.toContain('4.14.0');
    expect(window.location.search).toBe('?flavor=Production');

    type('#apps-flavor', '');
    expect(textOf('[data-apps-projects]')).toContain('4.14.0');
    expect(window.location.search).toBe('');
  });

  it('offers no flavor filter when no application uses flavors', async (): Promise<void> => {
    loadPage('apps');
    const plain = app({ releases: app().releases.map((release) => ({ ...release, flavorName: null })) });
    fakeApi({
      'GET /api/session': user({ administers: false }),
      'GET /api/catalog': { projects: [{ ...CATALOG.projects[0], applications: [plain] }] },
    });

    await AppsPage.init();

    expect(document.querySelector('#apps-flavor')).toBeNull();
  });
});
