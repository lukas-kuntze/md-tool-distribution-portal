import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { application, project, PROJECT_ID } from '../testing/fixtures.js';
import { apiError, click, fakeApi, loadPage, stubNavigation, submitForm, textOf, type } from '../testing/page.js';
import { Overlays } from './overlays.js';
import { ProjectPage } from './project-page.js';
import { Tabs } from './tabs.js';

const hidden = (selector: string): boolean => document.querySelector<HTMLElement>(selector)?.hidden === true;

describe('project page', (): void => {
  beforeAll((): void => {
    Overlays.init();
    Tabs.init();
  });

  beforeEach((): void => {
    loadPage('project', `/project.html?id=${PROJECT_ID}`);
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows project and application icons and removes the project icon from the edit dialog', async (): Promise<void> => {
    const iconUrl = `/api/projects/${PROJECT_ID}/icon?v=abc`;
    const calls = fakeApi({
      [`GET /api/projects/${PROJECT_ID}`]: project({ iconUrl }),
      [`GET /api/projects/${PROJECT_ID}/applications`]: [
        application({ iconUrl: '/api/applications/a/icon?v=1' }),
        application({ id: 'b', name: 'Ohne Icon' }),
      ],
      [`DELETE /api/projects/${PROJECT_ID}/icon`]: project({ iconUrl: null }),
    });

    await ProjectPage.init();
    await vi.waitFor(() => expect(textOf('[data-application-list]')).toContain('Ohne Icon'));

    expect(document.querySelector('[data-project-name] img.app-icon')?.getAttribute('src')).toBe(iconUrl);
    expect(
      Array.from(document.querySelectorAll('[data-application-list] .app-icon'), (icon) => icon.tagName.toLowerCase()),
    ).toEqual(['img', 'span']);

    click('[data-action="edit-project"]');
    expect(document.querySelector('[data-project-icon] img')?.getAttribute('src')).toBe(iconUrl);
    click('[data-project-icon] [data-action="remove-icon"]');
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
    await vi.waitFor(() => expect(document.querySelector('[data-project-name] img')).toBeNull());
    expect(document.querySelector<HTMLElement>('[data-project-icon] [data-action="remove-icon"]')?.hidden).toBe(true);
  });

  it('shows the project, its applications and the tabs the user may use', async (): Promise<void> => {
    fakeApi({
      [`GET /api/projects/${PROJECT_ID}`]: project({
        capabilities: {
          update: true,
          createApplications: true,
          managePermissions: false,
          readAudit: true,
          manageShares: false,
        },
      }),
      [`GET /api/projects/${PROJECT_ID}/applications`]: [
        application({ visibility: 'organization', flavorsEnabled: true, description: 'Mobile Pflege' }),
      ],
    });

    await ProjectPage.init();
    await vi.waitFor(() => expect(textOf('[data-application-list]')).toContain('K Mobile'));

    expect(document.title).toBe('MD Ambulant · App-Distribution');
    expect(textOf('[data-project-name]')).toBe('MD Ambulant Aktiv');
    expect(textOf('[data-application-list]')).toContain('Flutter');
    expect(textOf('[data-application-list]')).toContain('Organisation');
    expect(textOf('[data-application-list]')).toContain('1 Flavors');
    expect(hidden('[data-action="archive-project"]')).toBe(false);
    expect(hidden('[data-action="restore-project"]')).toBe(true);
    expect(hidden('#tab-access')).toBe(true);
    expect(hidden('#tab-audit')).toBe(false);
  });

  it('edits, archives and restores the project', async (): Promise<void> => {
    const calls = fakeApi({
      [`GET /api/projects/${PROJECT_ID}`]: project(),
      [`GET /api/projects/${PROJECT_ID}/applications`]: [],
      [`PATCH /api/projects/${PROJECT_ID}`]: project({ name: 'MD Mobil', rowVersion: 2 }),
      [`POST /api/projects/${PROJECT_ID}/archive`]: project({ status: 'archived', rowVersion: 3 }),
      [`POST /api/projects/${PROJECT_ID}/restore`]: project({ rowVersion: 4 }),
    });

    await ProjectPage.init();
    await vi.waitFor(() => expect(textOf('[data-application-list]')).toContain('Noch keine Anwendungen'));

    click('[data-action="edit-project"]');
    expect((document.querySelector('#project-edit-name') as HTMLInputElement).value).toBe('MD Ambulant');
    type('#project-edit-name', 'MD Mobil');
    submitForm('#project-edit-form');
    await vi.waitFor(() => expect(textOf('[data-project-name]')).toContain('MD Mobil'));

    click('[data-action="archive-project"]');
    click('[data-confirm-archive]');
    await vi.waitFor(() => expect(textOf('[data-project-alert]')).toContain('schreibgeschützt'));
    expect(hidden('[data-action="create-application"]')).toBe(true);

    click('[data-action="restore-project"]');
    await vi.waitFor(() => expect(textOf('[data-project-alert]')).toBe(''));
    expect(calls.filter((call) => call.method !== 'GET').map((call) => call.body)).toEqual([
      { name: 'MD Mobil', description: 'Pflege', rowVersion: 1 },
      { rowVersion: 2 },
      { rowVersion: 3 },
    ]);
  });

  it('creates an application with platforms and identifiers', async (): Promise<void> => {
    const navigation = stubNavigation();
    const calls = fakeApi({
      [`GET /api/projects/${PROJECT_ID}`]: project(),
      [`GET /api/projects/${PROJECT_ID}/applications`]: [],
      [`POST /api/projects/${PROJECT_ID}/applications`]: application({ id: 'new-app' }),
    });

    await ProjectPage.init();
    click('[data-action="create-application"]');
    type('#application-create-name', 'K Mobile');
    type('#application-create-android-id', 'kmobile');
    submitForm('#application-create-form');
    expect(textOf('#application-create-form .form-error')).toBe('Ungültiges Format, z. B. de.firma.app.');

    type('#application-create-android-id', 'de.md.kmobile');
    click('#application-create-ios');
    expect(hidden('[data-identifier-for="ios"]')).toBe(true);
    type('#application-create-visibility', 'organization');
    submitForm('#application-create-form');

    await vi.waitFor(() => expect(navigation.targets).toEqual(['/application.html?id=new-app']));
    expect(calls.at(-1)?.body).toEqual({
      name: 'K Mobile',
      slug: 'k-mobile',
      description: '',
      framework: 'flutter',
      platforms: ['android'],
      visibility: 'organization',
      bundleIdentifiers: { android: 'de.md.kmobile' },
    });
  });

  it('loads access and audit only when their tab opens', async (): Promise<void> => {
    const calls = fakeApi({
      [`GET /api/projects/${PROJECT_ID}`]: project(),
      [`GET /api/projects/${PROJECT_ID}/applications`]: [],
      'GET /api/role-assignments': [],
      'GET /api/audit-logs': [],
    });

    await ProjectPage.init();
    expect(calls.some((call) => call.path.startsWith('/api/role-assignments'))).toBe(false);

    click('#tab-access');
    await vi.waitFor(() => expect(textOf('#panel-access')).toContain('Keine Zuweisungen'));
    click('#tab-audit');
    await vi.waitFor(() => expect(textOf('#panel-audit')).toContain('Keine Einträge'));
    click('#tab-access');

    expect(calls.filter((call) => call.path.startsWith('/api/role-assignments'))).toHaveLength(1);
    expect(calls.find((call) => call.path.startsWith('/api/audit-logs'))?.path).toBe(
      `/api/audit-logs?scope=project&id=${PROJECT_ID}&limit=50&offset=0`,
    );
  });

  it('reports unknown projects', async (): Promise<void> => {
    fakeApi({ [`GET /api/projects/${PROJECT_ID}`]: apiError(404, 'project_not_found') });
    await ProjectPage.init();
    expect(textOf('[data-page-state]')).toContain('Das Projekt wurde nicht gefunden.');
    expect(hidden('[data-page-content]')).toBe(true);

    loadPage('project', '/project.html');
    await ProjectPage.init();
    expect(textOf('[data-page-state]')).toContain('Das Projekt wurde nicht gefunden.');
  });
});
