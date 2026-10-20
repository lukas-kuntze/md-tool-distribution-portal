import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReleaseDetailDto } from '../../../shared/types/api.js';
import {
  ALL_APPLICATION_CAPABILITIES,
  APPLICATION_ID,
  application,
  artifact,
  project,
  PROJECT_ID,
  release,
  RELEASE_ID,
} from '../testing/fixtures.js';
import {
  apiError,
  click,
  fakeApi,
  loadPage,
  respond,
  stubNavigation,
  submitForm,
  textOf,
  type,
  type Routes,
} from '../testing/page.js';
import { Overlays } from './overlays.js';
import { isAppleMobileDevice } from '../core/device.js';
import { deletionConfirmed, ReleasePage } from './release-page.js';
import { Tabs } from './tabs.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

function routes(detail: ReleaseDetailDto, extra: Routes = {}): Routes {
  return {
    [`GET /api/releases/${RELEASE_ID}`]: detail,
    [`GET /api/applications/${APPLICATION_ID}`]: application(),
    [`GET /api/projects/${PROJECT_ID}`]: project(),
    ...extra,
  };
}

const hidden = (selector: string): boolean => document.querySelector<HTMLElement>(selector)?.hidden === true;

describe('release page', (): void => {
  beforeAll((): void => {
    Overlays.init();
    Tabs.init();
  });

  beforeEach((): void => {
    loadPage('release', `/release.html?id=${RELEASE_ID}`);
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the release with its artifacts, origin and the actions the user may take', async (): Promise<void> => {
    fakeApi(routes(release()));

    await ReleasePage.init();

    expect(Array.from(document.querySelectorAll('.breadcrumb-item'), (item) => item.textContent)).toEqual([
      'Projekte',
      'MD Ambulant',
      'K Mobile',
      '4.13.0 (125)',
    ]);
    expect(textOf('[data-release-title]')).toBe('4.13.0 Build 125');
    expect(textOf('[data-release-meta]')).toBe('Entwurf');
    expect(hidden('[data-action="publish"]')).toBe(false);
    expect(hidden('[data-action="withdraw"]')).toBe(true);
    expect(hidden('[data-action="delete"]')).toBe(false);
    expect(hidden('[data-more-actions]')).toBe(false);
    expect(textOf('[data-artifact-list]')).toContain('Android');
    expect(textOf('[data-artifact-list]')).toContain('Runner.ipa');
    expect(textOf('[data-artifact-list]')).toContain('50 MB');
    expect(document.querySelector('[data-artifact-list] a[download]')?.getAttribute('href')).toMatch(
      /^\/api\/artifacts\/.+\/download$/,
    );
    expect(document.querySelectorAll('[data-install]')).toHaveLength(1);
    expect(textOf('[data-release-details]')).toContain('#4711 (Versuch 1)');
    expect((document.querySelector('#release-notes') as HTMLTextAreaElement).value).toBe('Neu');
  });

  it('marks incomplete drafts and hides everything a reader may not do', async (): Promise<void> => {
    const readOnly = {
      ...ALL_APPLICATION_CAPABILITIES,
      publishReleases: false,
      deleteReleases: false,
      updateReleases: false,
    };
    fakeApi(
      routes(release({ missingPlatforms: ['ios'], capabilities: readOnly, deletionConfirmation: null, artifacts: [] })),
    );

    await ReleasePage.init();

    expect(textOf('[data-release-alert]')).toContain('Es fehlt ein installierbares Artefakt für: iOS');
    expect(textOf('[data-release-meta]')).toContain('Unvollständig');
    expect(hidden('[data-action="publish"]')).toBe(true);
    expect(hidden('[data-more-actions]')).toBe(true);
    expect((document.querySelector('#release-notes') as HTMLTextAreaElement).readOnly).toBe(true);
    expect(textOf('[data-artifact-list]')).toContain('Keine Artefakte');
  });

  it('publishes and saves the texts', async (): Promise<void> => {
    const calls = fakeApi(
      routes(release(), {
        [`POST /api/releases/${RELEASE_ID}/publish`]: release({ publicationStatus: 'published', rowVersion: 2 }),
        [`PATCH /api/releases/${RELEASE_ID}`]: release({ releaseNotes: 'Geändert', rowVersion: 3 }),
      }),
    );

    await ReleasePage.init();
    click('[data-action="publish"]');
    await vi.waitFor(() => expect(textOf('[data-release-meta]')).toBe('Veröffentlicht'));
    expect(hidden('[data-action="withdraw"]')).toBe(false);

    type('#release-notes', 'Geändert');
    submitForm('#release-texts-form');
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      releaseNotes: 'Geändert',
      changelog: '',
      rowVersion: 2,
    });
  });

  it('deletes only after reason and exact confirmation text (concept 7.4)', async (): Promise<void> => {
    const calls = fakeApi(
      routes(release({ publicationStatus: 'published' }), {
        [`DELETE /api/releases/${RELEASE_ID}`]: { deletionJobId: 'job' },
      }),
    );

    await ReleasePage.init();
    click('[data-action="delete"]');

    const confirm = document.querySelector<HTMLButtonElement>('#release-delete-form button[type="submit"]');
    expect(hidden('#release-delete')).toBe(false);
    expect(textOf('[data-delete-summary]')).toContain('2 Artefakte (IPA, APK)');
    expect(textOf('[data-delete-phrase]')).toBe('k-mobile 4.13.0 (125)');
    expect(hidden('[data-delete-withdraw-hint]')).toBe(false);
    expect(confirm?.disabled).toBe(true);

    type('#release-delete-reason', 'Absturz beim Start');
    type('#release-delete-confirmation', 'k-mobile 4.13.0');
    expect(confirm?.disabled).toBe(true);

    type('#release-delete-confirmation', 'k-mobile 4.13.0 (125)');
    expect(confirm?.disabled).toBe(false);

    submitForm('#release-delete-form');
    await vi.waitFor(() => expect(hidden('#release-delete')).toBe(true));
    expect(calls.find((call) => call.method === 'DELETE')?.body).toEqual({
      rowVersion: 1,
      confirmation: 'k-mobile 4.13.0 (125)',
      reason: 'Absturz beim Start',
    });
  });

  it('offers withdrawing instead of deleting', async (): Promise<void> => {
    fakeApi(
      routes(release({ publicationStatus: 'published' }), {
        [`POST /api/releases/${RELEASE_ID}/withdraw`]: release({ publicationStatus: 'withdrawn' }),
      }),
    );

    await ReleasePage.init();
    click('[data-action="delete"]');
    click('[data-delete-withdraw]');

    await vi.waitFor(() => expect(textOf('[data-release-meta]')).toBe('Zurückgezogen'));
    expect(hidden('#release-delete')).toBe(true);
  });

  it('shows quarantine with restore, failures and purged tombstones', async (): Promise<void> => {
    const deletion = {
      jobId: 'job',
      state: 'quarantined',
      requestedAt: '2026-10-17T08:00:00.000Z',
      reason: 'Absturz',
      purgeAfter: '2026-10-31T08:00:00.000Z',
      attempts: 1,
      lastErrorCode: null,
      requiresManualReview: false,
    };
    const calls = fakeApi(
      routes(release({ lifecycleState: 'quarantined', deletion }), {
        [`POST /api/releases/${RELEASE_ID}/restore`]: release({ publicationStatus: 'withdrawn' }),
      }),
    );

    await ReleasePage.init();
    expect(textOf('[data-release-alert]')).toContain('In Quarantäne bis');
    expect(document.querySelector('[data-artifact-list] a[download]')).toBeNull();
    expect(hidden('[data-action="delete"]')).toBe(true);

    click('[data-action="restore"]');
    await vi.waitFor(() => expect(calls.some((call) => call.path.endsWith('/restore'))).toBe(true));

    loadPage('release', `/release.html?id=${RELEASE_ID}`);
    fakeApi(
      routes(
        release({
          lifecycleState: 'quarantined',
          deletion: { ...deletion, state: 'failed', lastErrorCode: 'reparse_point', requiresManualReview: true },
        }),
      ),
    );
    await ReleasePage.init();
    expect(textOf('[data-release-alert]')).toContain('Löschung fehlgeschlagen');
    expect(textOf('[data-release-alert]')).toContain('manuelle Prüfung');
  });

  it('releases the build number of a purged release with a reason', async (): Promise<void> => {
    const calls = fakeApi(
      routes(release({ lifecycleState: 'purged', purgedAt: '2026-10-31T08:00:00.000Z' }), {
        [`POST /api/releases/${RELEASE_ID}/release-build-number`]: release({
          lifecycleState: 'purged',
          buildNumberReserved: false,
        }),
      }),
    );

    await ReleasePage.init();
    expect(textOf('[data-release-alert]')).toContain('Build-Nummer ist weiterhin gesperrt');

    click('[data-action="release-build-number"]');
    expect(textOf('[data-build-number]')).toBe('125');

    submitForm('#build-number-release-form');
    expect(textOf('#build-number-release-form .form-error')).toBe('Bitte begründe die Freigabe.');

    type('#build-number-reason', 'Fehlbuild');
    submitForm('#build-number-release-form');
    await vi.waitFor(() => expect(textOf('[data-release-alert]')).toContain('zur Wiederverwendung freigegeben'));
    expect(calls.at(-1)?.body).toEqual({ rowVersion: 1, reason: 'Fehlbuild' });
  });

  it('installs on iOS devices through itms-services and explains it elsewhere', async (): Promise<void> => {
    const navigation = stubNavigation();
    const ipa = artifact();
    fakeApi(
      routes(release(), {
        [`POST /api/artifacts/${ipa.id}/install-link`]: {
          installUrl: 'itms-services://?action=download-manifest&url=x',
          manifestUrl: 'x',
          expiresAt: '2026-10-17T08:10:00.000Z',
        },
      }),
    );

    await ReleasePage.init();
    click('[data-install]');
    expect(hidden('#install-hint')).toBe(false);
    expect(textOf('[data-install-page-url]')).toContain(`/release.html?id=${RELEASE_ID}`);
    click('#install-hint [data-modal-close]');

    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    click('[data-install]');
    await vi.waitFor(() => expect(navigation.targets).toEqual(['itms-services://?action=download-manifest&url=x']));
  });

  it('reports a missing or unknown release', async (): Promise<void> => {
    fakeApi({ [`GET /api/releases/${RELEASE_ID}`]: apiError(404, 'release_not_found') });
    await ReleasePage.init();
    expect(textOf('[data-page-state]')).toContain('Das Release wurde nicht gefunden.');

    loadPage('release', '/release.html');
    await ReleasePage.init();
    expect(textOf('[data-page-state]')).toContain('Das Release wurde nicht gefunden.');
  });

  it('decides on devices and confirmations without the page', (): void => {
    expect(isAppleMobileDevice({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(
      isAppleMobileDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }),
    ).toBe(true);
    expect(isAppleMobileDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', maxTouchPoints: 0 })).toBe(false);
    expect(deletionConfirmed(null, 'x', 'y')).toBe(false);
    expect(deletionConfirmed(release(), '', 'k-mobile 4.13.0 (125)')).toBe(false);
  });

  it('removes an artifact with a reason and restores it from quarantine', async (): Promise<void> => {
    const ipa = artifact();
    const quarantined = artifact({
      storageState: 'quarantined',
      removal: {
        jobId: 'job',
        state: 'quarantined',
        requestedAt: '2026-10-17T08:00:00.000Z',
        reason: 'Falsch',
        purgeAfter: '2026-10-31T08:00:00.000Z',
        attempts: 0,
        lastErrorCode: null,
        requiresManualReview: false,
      },
    });
    const calls = fakeApi(
      routes(release(), {
        [`POST /api/artifacts/${ipa.id}/remove`]: respond(202, { deletionJobId: 'job' }),
        [`GET /api/releases/${RELEASE_ID}`]: () =>
          calls.some((entry) => entry.path.endsWith('/remove')) ? release({ artifacts: [quarantined] }) : release(),
        [`POST /api/artifacts/${ipa.id}/restore`]: respond(204),
      }),
    );

    await ReleasePage.init();
    click(`[data-remove-artifact="${ipa.id}"]`);
    expect(hidden('#artifact-remove')).toBe(false);
    expect(textOf('[data-artifact-remove-name]')).toContain('IPA · Runner.ipa');

    submitForm('#artifact-remove-form');
    expect(textOf('#artifact-remove-form .form-error')).toBe('Bitte begründe die Entfernung.');

    type('#artifact-remove-reason', 'Falsche Signatur');
    submitForm('#artifact-remove-form');
    await vi.waitFor(() => expect(textOf('[data-artifact-list]')).toContain('In Quarantäne bis'));
    expect(calls.find((call) => call.path.endsWith('/remove'))?.body).toEqual({ reason: 'Falsche Signatur' });
    expect(document.querySelector('[data-artifact-list] a[download]')).toBeNull();

    click(`[data-restore-artifact="${ipa.id}"]`);
    await vi.waitFor(() => expect(calls.some((call) => call.path.endsWith('/restore'))).toBe(true));
  });

  it('locks platform builds of a published release', async (): Promise<void> => {
    fakeApi(routes(release({ publicationStatus: 'published' })));

    await ReleasePage.init();

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-remove-artifact]'));
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });
});
