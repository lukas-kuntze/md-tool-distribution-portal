import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALL_APPLICATION_CAPABILITIES,
  application,
  APPLICATION_ID,
  flavor,
  FLAVOR_ID,
  project,
  PROJECT_ID,
  releaseSummary,
} from '../testing/fixtures.js';
import { apiError, click, fakeApi, loadPage, respond, submitForm, textOf, type, type Routes } from '../testing/page.js';
import { ApplicationPage } from './application-page.js';
import { Overlays } from './overlays.js';
import { Tabs } from './tabs.js';

const hidden = (selector: string): boolean => document.querySelector<HTMLElement>(selector)?.hidden === true;

function routes(extra: Routes = {}): Routes {
  return {
    [`GET /api/applications/${APPLICATION_ID}`]: application(),
    [`GET /api/projects/${PROJECT_ID}`]: project(),
    [`GET /api/applications/${APPLICATION_ID}/releases`]: [releaseSummary()],
    ...extra,
  };
}

describe('application page', (): void => {
  beforeAll((): void => {
    Overlays.init();
    Tabs.init();
  });

  beforeEach((): void => {
    loadPage('application', `/application.html?id=${APPLICATION_ID}`);
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists releases with platform badges and filters them', async (): Promise<void> => {
    const calls = fakeApi(
      routes({
        [`GET /api/applications/${APPLICATION_ID}/releases`]: [
          releaseSummary({ missingPlatforms: ['ios'] }),
          releaseSummary({ id: 'r2', buildNumber: 124, publicationStatus: 'published', lifecycleState: 'quarantined' }),
        ],
      }),
    );

    await ApplicationPage.init();
    await vi.waitFor(() => expect(textOf('[data-release-list]')).toContain('4.13.0 (125)'));

    expect(textOf('[data-application-name]')).toBe('K Mobile');
    expect(textOf('[data-release-list]')).toContain('Unvollständig');
    expect(textOf('[data-release-list]')).toContain('In Quarantäne');
    expect(hidden('#tab-flavors')).toBe(true);
    expect(hidden('#release-filter-flavor')).toBe(false);
    expect(
      document.querySelector<HTMLElement>('#release-filter-flavor')?.closest<HTMLElement>('.form-group')?.hidden,
    ).toBe(true);

    type('#release-filter-status', 'published');
    type('#release-filter-lifecycle', 'pending_deletion,quarantined');
    await vi.waitFor(() =>
      expect(calls.at(-1)?.path).toBe(
        `/api/applications/${APPLICATION_ID}/releases?status=published&lifecycle=pending_deletion%2Cquarantined&limit=25&offset=0`,
      ),
    );
  });

  it('pages through long release lists and explains empty ones', async (): Promise<void> => {
    const full = Array.from({ length: 25 }, (_, index) =>
      releaseSummary({ id: `r${index}`, buildNumber: 200 - index }),
    );
    const calls = fakeApi(
      routes({
        [`GET /api/applications/${APPLICATION_ID}/releases`]: (call: { path: string }) =>
          respond(200, call.path.includes('offset=25') ? full.slice(0, 5) : full, { 'x-total-count': '30' }),
      }),
    );
    const pagination = (): string[] =>
      Array.from(document.querySelectorAll('[data-release-list] .pagination-item'), (item) =>
        [item.textContent, item.getAttribute('aria-current') ?? '', item.getAttribute('aria-disabled') ?? ''].join('|'),
      );

    await ApplicationPage.init();
    await vi.waitFor(() => expect(document.querySelectorAll('[data-release-list] tbody tr')).toHaveLength(25));
    expect(pagination()).toEqual(['chevron_left||true', '1|page|', '2||', 'chevron_right||']);

    click('[data-release-list] [aria-label="Nächste Seite"]');
    await vi.waitFor(() => expect(calls.at(-1)?.path).toContain('offset=25'));
    await vi.waitFor(() => expect(document.querySelectorAll('[data-release-list] tbody tr')).toHaveLength(5));
    expect(pagination()).toEqual(['chevron_left||', '1||', '2|page|', 'chevron_right||true']);
  });

  it('manages flavors once flavor support is on', async (): Promise<void> => {
    const production = flavor({ name: 'Production', hasReleases: true });
    const support = flavor({
      id: 'f2',
      key: 'support',
      name: 'Unterstützung',
      isDefault: false,
      bundleIdentifiers: {},
    });
    const calls = fakeApi(
      routes({
        [`GET /api/applications/${APPLICATION_ID}`]: application({
          flavorsEnabled: true,
          flavors: [production, support],
        }),
        [`POST /api/applications/${APPLICATION_ID}/flavors`]: flavor({ id: 'f3' }),
        'PATCH /api/flavors/f2': support,
      }),
    );

    await ApplicationPage.init();
    expect(hidden('#tab-flavors')).toBe(false);
    expect(textOf('[data-flavor-list]')).toContain('Production Standard');
    expect(document.querySelectorAll('#release-filter-flavor option')).toHaveLength(3);

    click('[data-edit-flavor="' + FLAVOR_ID + '"]');
    expect((document.querySelector('#flavor-key') as HTMLInputElement).disabled).toBe(true);
    expect(hidden('[data-flavor-locked]')).toBe(false);
    click('#flavor-modal [data-modal-close]');

    click('[data-edit-flavor="f2"]');
    type('#flavor-status', 'disabled');
    submitForm('#flavor-form');
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      name: 'Unterstützung',
      status: 'disabled',
      key: 'support',
      bundleIdentifiers: { android: null, ios: null },
      rowVersion: 1,
    });

    click('[data-action="create-flavor"]');
    type('#flavor-name', 'Demo');
    type('#flavor-key', 'Demo');
    submitForm('#flavor-form');
    expect(textOf('#flavor-form .form-error')).toContain('--flavor');

    type('#flavor-key', 'demo');
    type('#flavor-ios', 'de.md.demo');
    submitForm('#flavor-form');
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      key: 'demo',
      name: 'Demo',
      bundleIdentifiers: { ios: 'de.md.demo' },
    });
  });

  it('orders flavors and saves the presentation on download pages', async (): Promise<void> => {
    const production = flavor({ name: 'Production' });
    const support = flavor({ id: 'f2', key: 'support', name: 'Unterstützung', isDefault: false });
    const calls = fakeApi(
      routes({
        [`GET /api/applications/${APPLICATION_ID}`]: application({
          flavorsEnabled: true,
          flavors: [production, support],
          iconUrl: `/api/applications/${APPLICATION_ID}/icon?v=abc`,
          installNotes: 'Alt',
        }),
        [`PUT /api/applications/${APPLICATION_ID}/flavor-order`]: application({ flavors: [support, production] }),
        [`PATCH /api/applications/${APPLICATION_ID}`]: application({ installNotes: 'Nur Diensthandys' }),
        [`DELETE /api/applications/${APPLICATION_ID}/icon`]: application({ iconUrl: null }),
      }),
    );

    await ApplicationPage.init();
    expect(document.querySelector('[data-application-name] img.app-icon')).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>(`[data-move-flavor="${FLAVOR_ID}:-1"]`)?.disabled).toBe(true);

    click('[data-move-flavor="f2:-1"]');
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ flavorIds: ['f2', FLAVOR_ID] });
    // The page reloads the application after reordering.
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.path === `/api/applications/${APPLICATION_ID}`)).toHaveLength(2),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((document.querySelector('#install-notes') as HTMLTextAreaElement).value).toBe('Alt');
    expect(hidden('[data-action="remove-icon"]')).toBe(false);
    type('#install-notes', 'Nur Diensthandys');
    submitForm('#install-notes-form');
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      installNotes: 'Nur Diensthandys',
      rowVersion: 1,
    });

    click('[data-action="remove-icon"]');
    await vi.waitFor(() => expect(hidden('[data-action="remove-icon"]')).toBe(true));
  });

  it('saves settings and identifiers of an application without flavors', async (): Promise<void> => {
    const calls = fakeApi(
      routes({
        [`PATCH /api/applications/${APPLICATION_ID}`]: application({ name: 'K Mobile 2', rowVersion: 2 }),
        [`PATCH /api/flavors/${FLAVOR_ID}`]: flavor(),
      }),
    );

    await ApplicationPage.init();
    expect(hidden('#tab-settings')).toBe(false);
    expect(hidden('#identifier-form')).toBe(false);
    expect((document.querySelector('#identifier-android') as HTMLInputElement).value).toBe('de.md.kmobile');

    type('#settings-name', 'K Mobile 2');
    click('#settings-android');
    click('#settings-ios');
    submitForm('#application-settings-form');
    expect(textOf('#application-settings-form .form-error')).toBe('Mindestens eine Plattform muss aktiviert sein.');

    click('#settings-ios');
    submitForm('#application-settings-form');
    await vi.waitFor(() => expect(textOf('[data-application-name]')).toBe('K Mobile 2'));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      name: 'K Mobile 2',
      description: '',
      framework: 'flutter',
      platforms: ['ios'],
      visibility: 'private',
      rowVersion: 1,
    });

    type('#identifier-ios', 'de.md.kmobile.ios');
    submitForm('#identifier-form');
    await vi.waitFor(() => expect(calls.some((call) => call.path === `/api/flavors/${FLAVOR_ID}`)).toBe(true));
    expect(calls.find((call) => call.path === `/api/flavors/${FLAVOR_ID}`)?.body).toEqual({
      bundleIdentifiers: { android: 'de.md.kmobile', ios: 'de.md.kmobile.ios' },
      rowVersion: 1,
    });
  });

  it('asks for a name before enabling flavors and reverts the switch when disabling fails', async (): Promise<void> => {
    const calls = fakeApi(
      routes({
        [`PATCH /api/applications/${APPLICATION_ID}`]: (call: { body: unknown }) =>
          (call.body as { flavorsEnabled?: boolean }).flavorsEnabled === false
            ? apiError(422, 'too_many_active_flavors')
            : application({ flavorsEnabled: true }),
        [`PATCH /api/flavors/${FLAVOR_ID}`]: flavor({ name: 'Production' }),
      }),
    );
    const toggle = document.querySelector<HTMLInputElement>('#flavors-enabled');

    await ApplicationPage.init();
    click('#flavors-enabled');
    expect(toggle?.checked).toBe(false);
    expect(hidden('#flavors-enable')).toBe(false);
    expect((document.querySelector('#flavors-enable-name') as HTMLInputElement).value).toBe('Production');

    submitForm('#flavors-enable-form');
    await vi.waitFor(() => expect(hidden('#flavors-enable')).toBe(true));
    expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.body)).toEqual([
      { flavorsEnabled: true, rowVersion: 1 },
      { name: 'Production', rowVersion: 1 },
    ]);

    loadPage('application', `/application.html?id=${APPLICATION_ID}`);
    fakeApi(
      routes({
        [`GET /api/applications/${APPLICATION_ID}`]: application({ flavorsEnabled: true }),
        [`PATCH /api/applications/${APPLICATION_ID}`]: apiError(422, 'too_many_active_flavors'),
      }),
    );
    await ApplicationPage.init();
    const enabled = document.querySelector<HTMLInputElement>('#flavors-enabled');
    expect(enabled?.checked).toBe(true);
    click('#flavors-enabled');
    await vi.waitFor(() => expect(enabled?.checked).toBe(true));
    expect(textOf('[data-toast-stack]')).toContain('höchstens ein Flavor aktiv');
  });

  it('hides management for readers and survives a hidden project', async (): Promise<void> => {
    const reader = { ...ALL_APPLICATION_CAPABILITIES, manage: false, managePermissions: false, readAudit: false };
    fakeApi(
      routes({
        [`GET /api/applications/${APPLICATION_ID}`]: application({ capabilities: reader }),
        [`GET /api/projects/${PROJECT_ID}`]: apiError(403, 'permission_denied'),
        [`GET /api/applications/${APPLICATION_ID}/releases`]: [],
      }),
    );

    await ApplicationPage.init();
    await vi.waitFor(() => expect(textOf('[data-release-list]')).toContain('Keine Releases'));

    expect(hidden('#tab-settings')).toBe(true);
    expect(hidden('#tab-access')).toBe(true);
    expect(Array.from(document.querySelectorAll('.breadcrumb-item'), (item) => item.textContent)).toEqual([
      'Projekte',
      'Projekt',
      'K Mobile',
    ]);
  });
});
