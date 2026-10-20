import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { project } from '../testing/fixtures.js';
import { apiError, click, fakeApi, loadPage, stubNavigation, submitForm, textOf, type, user } from '../testing/page.js';
import { Overlays } from './overlays.js';
import { ProjectsPage } from './projects-page.js';
import { Shell } from './shell.js';

describe('projects page', (): void => {
  beforeAll((): void => {
    Overlays.init();
  });

  beforeEach((): void => {
    loadPage('projects', '/projects.html');
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists projects and shows actions by capability', async (): Promise<void> => {
    fakeApi({ 'GET /api/session': user({ createProjects: false }), 'GET /api/projects': [project()] });

    await Promise.all([Shell.init(), ProjectsPage.init()]);

    expect(textOf('[data-page-title]')).toBe('Projektverwaltung');
    expect(textOf('[data-user-name]')).toBe('Ada Admin');
    expect(document.querySelector('[data-nav-item="projects"]')?.getAttribute('aria-current')).toBe('page');
    expect(document.querySelector<HTMLElement>('[data-modal-open="project-create"]')?.hidden).toBe(true);
    expect(textOf('[data-project-list] tbody')).toContain('MD Ambulant');
    expect(document.querySelector('[data-project-list] a')?.getAttribute('href')).toBe(
      '/project.html?id=0192f3a4-0000-7000-8000-0000000000a1',
    );
  });

  it('switches to archived projects and explains empty lists', async (): Promise<void> => {
    const calls = fakeApi({ 'GET /api/projects': [] });

    await ProjectsPage.init();
    expect(textOf('[data-project-list]')).toContain('Noch keine Projekte');

    type('[data-project-status]', 'archived');
    await vi.waitFor(() => expect(textOf('[data-project-list]')).toContain('Keine archivierten Projekte'));
    expect(calls.map((call) => call.path)).toContain('/api/projects?status=archived');
  });

  it('creates a project with a suggested slug and opens it', async (): Promise<void> => {
    const navigation = stubNavigation();
    const calls = fakeApi({ 'GET /api/projects': [], 'POST /api/projects': project({ id: 'new-id' }) });

    await ProjectsPage.init();
    click('[data-modal-open="project-create"]');
    expect(document.querySelector<HTMLElement>('#project-create')?.hidden).toBe(false);

    type('#project-create-name', 'K Mobile Ä');
    expect((document.querySelector('#project-create-slug') as HTMLInputElement).value).toBe('k-mobile-ae');

    submitForm('#project-create-form');
    await vi.waitFor(() => expect(navigation.targets).toEqual(['/project.html?id=new-id']));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'K Mobile Ä',
      slug: 'k-mobile-ae',
      description: '',
    });
  });

  it('checks the slug before calling the API and shows API refusals', async (): Promise<void> => {
    fakeApi({ 'GET /api/projects': [], 'POST /api/projects': apiError(409, 'slug_taken') });

    await ProjectsPage.init();
    type('#project-create-name', 'X');
    type('#project-create-slug', 'Not A Slug');
    submitForm('#project-create-form');

    expect(document.querySelector('#project-create-slug')?.classList.contains('is-invalid')).toBe(true);

    type('#project-create-slug', 'x');
    submitForm('#project-create-form');
    await vi.waitFor(() =>
      expect(textOf('#project-create-form [data-form-alert]')).toBe(
        'Das hat nicht geklapptDieser Slug ist bereits vergeben.',
      ),
    );
  });

  it('offers a retry when loading fails', async (): Promise<void> => {
    fakeApi({ 'GET /api/projects': apiError(500, 'internal_error') });

    await ProjectsPage.init();

    expect(textOf('[data-project-list] .error-state')).toContain('unerwarteter Fehler');
  });
});
