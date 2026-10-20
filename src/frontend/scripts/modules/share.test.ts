import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SharedContentDto, ShareLinkDto } from '../../../shared/types/api.js';
import { APPLICATION_ID, PROJECT_ID } from '../testing/fixtures.js';
import { apiError, click, fakeApi, loadPage, respond, submitForm, textOf, type } from '../testing/page.js';
import { Overlays } from './overlays.js';
import { linkStatus, ShareLinks } from './share-links.js';
import { SharePage } from './share-page.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

function link(overrides: Partial<ShareLinkDto> = {}): ShareLinkDto {
  return {
    id: 'link-1',
    label: 'Pflegedienst Meyer',
    releases: 'all',
    scope: { type: 'project', projectId: PROJECT_ID },
    scopeName: 'MD Ambulant',
    createdAt: '2026-10-17T08:00:00.000Z',
    createdBy: 'Ada Admin',
    expiresAt: null,
    revokedAt: null,
    active: true,
    ...overrides,
  };
}

const CONTENT: SharedContentDto = {
  label: 'Pflegedienst Meyer',
  releases: 'all',
  expiresAt: '2026-12-31T22:59:59.000Z',
  project: { name: 'MD Ambulant', description: 'Pflegedokumentation' },
  applications: [
    {
      id: APPLICATION_ID,
      name: 'K Mobile',
      description: 'Mobile Pflege',
      platforms: ['android', 'ios'],
      installNotes: 'Nur für Diensthandys.',
      iconUrl: '/public/shares/token/applications/app/icon?v=abc',
      releases: [
        {
          id: 'r125',
          version: '4.13.0',
          buildNumber: 125,
          flavorName: null,
          publishedAt: '2026-10-15T09:00:00.000Z',
          releaseNotes: '<b>Fehlerbehebungen</b>',
          artifacts: [
            {
              id: 'apk',
              kind: 'apk',
              platform: 'android',
              sizeBytes: 1024,
              downloadUrl: '/public/shares/t/artifacts/apk/download',
              installUrl: null,
            },
            {
              id: 'ipa',
              kind: 'ipa',
              platform: 'ios',
              sizeBytes: 2048,
              downloadUrl: '/public/shares/t/artifacts/ipa/download',
              installUrl: 'itms-services://?action=download-manifest&url=x',
            },
          ],
        },
        {
          id: 'r124',
          version: '4.12.0',
          buildNumber: 124,
          flavorName: 'Production',
          publishedAt: null,
          releaseNotes: '',
          artifacts: [],
        },
      ],
    },
    {
      id: 'other',
      name: 'Doku AirPad',
      description: '',
      platforms: ['ios'],
      installNotes: '',
      iconUrl: null,
      releases: [],
    },
  ],
};

describe('share links in the administration', (): void => {
  beforeAll((): void => {
    Overlays.init();
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mount(): HTMLElement {
    loadPage('project', `/project.html?id=${PROJECT_ID}`);
    const container = document.querySelector<HTMLElement>('#panel-shares') as HTMLElement;
    ShareLinks.mount(container, { type: 'project', projectId: PROJECT_ID }, () =>
      Promise.resolve([
        { scope: { type: 'project', projectId: PROJECT_ID }, label: 'Ganzes Projekt' },
        { scope: { type: 'application', applicationId: APPLICATION_ID }, label: 'Nur K Mobile' },
      ]),
    );
    return container;
  }

  it('lists links with their state and creates one that is shown only once', async (): Promise<void> => {
    const calls = fakeApi({
      'GET /api/share-links': [link(), link({ id: 'link-2', active: false, expiresAt: '2026-10-01T00:00:00Z' })],
      'POST /api/share-links': respond(201, {
        shareLink: link({ id: 'link-3' }),
        url: 'https://apps.example.com/share.html#secret',
      }),
    });
    const container = mount();

    await vi.waitFor(() => expect(textOf('#panel-shares tbody')).toContain('Pflegedienst Meyer'));
    expect(textOf('#panel-shares tbody')).toContain('Abgelaufen');
    expect(textOf('#panel-shares tbody')).toContain('unbefristet');
    expect(textOf('#panel-shares tbody')).toContain('Alle Releases');
    expect(container.querySelectorAll('tbody button')).toHaveLength(1);

    click(container.querySelector('.toolbar .btn-secondary') as HTMLElement);
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('#share-create')?.hidden).toBe(false));

    submitForm('#share-create form');
    expect(textOf('#share-create .form-error')).toBe('Bitte gib an, für wen die Freigabe ist.');

    type('#share-label', 'Pflegedienst Meyer');
    type('#share-scope', '1');
    type('#share-expires', '2026-12-31');
    click('#share-releases-latest');
    submitForm('#share-create form');

    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('#share-created')?.hidden).toBe(false));
    expect((document.querySelector('#share-url') as HTMLInputElement).value).toBe(
      'https://apps.example.com/share.html#secret',
    );
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      scope: { type: 'application', applicationId: APPLICATION_ID },
      label: 'Pflegedienst Meyer',
      releases: 'latest',
      expiresAt: new Date('2026-12-31T23:59:59').toISOString(),
    });
    expect(calls.filter((call) => call.method === 'GET').map((call) => call.path)).toContain(
      `/api/share-links?scope=project&id=${PROJECT_ID}`,
    );
  });

  it('presets the dialog from the settings and keeps the maximum lifetime', async (): Promise<void> => {
    fakeApi({
      'GET /api/share-links': [],
      'GET /api/settings/presets': {
        shareLinkDefaultDays: 14,
        shareLinkMaxDays: 30,
        shareLinkDefaultReleases: 'latest',
        defaultVisibility: 'private',
      },
    });
    const container = mount();

    await vi.waitFor(() => expect(container.querySelector('.toolbar .btn-secondary')).not.toBeNull());
    click(container.querySelector('.toolbar .btn-secondary') as HTMLElement);
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('#share-create')?.hidden).toBe(false));

    const expires = document.querySelector('#share-expires') as HTMLInputElement;
    const inDays = (count: number): string => {
      const date = new Date();
      date.setDate(date.getDate() + count);
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');
    };
    expect(expires.value).toBe(inDays(14));
    expect(expires.max).toBe(inDays(30));
    expect((document.querySelector('#share-releases-latest') as HTMLInputElement).checked).toBe(true);

    type('#share-label', 'Pflegedienst Meyer');
    type('#share-expires', inDays(45));
    submitForm('#share-create form');
    expect(textOf('#share-create .form-error')).toContain('Höchstens bis');

    type('#share-expires', '');
    submitForm('#share-create form');
    expect(textOf('#share-create .form-error')).toBe('Bitte gib an, bis wann die Freigabe gilt.');
  });

  it('revokes after confirmation', async (): Promise<void> => {
    const calls = fakeApi({
      'GET /api/share-links': [link()],
      'POST /api/share-links/link-1/revoke': respond(204),
    });
    const container = mount();

    await vi.waitFor(() => expect(container.querySelector('tbody button')).not.toBeNull());
    click(container.querySelector('tbody button') as HTMLElement);
    expect(textOf('#share-revoke .modal-body')).toContain('„Pflegedienst Meyer“');

    click('#share-revoke .btn-danger');
    await vi.waitFor(() => expect(calls.some((call) => call.path === '/api/share-links/link-1/revoke')).toBe(true));
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('#share-revoke')?.hidden).toBe(true));
  });

  it('describes states and explains empty lists', async (): Promise<void> => {
    expect(linkStatus(link({ revokedAt: '2026-10-18T08:00:00Z', active: false })).text).toContain('Widerrufen');
    fakeApi({ 'GET /api/share-links': [] });
    mount();
    await vi.waitFor(() => expect(textOf('#panel-shares')).toContain('Keine Freigaben'));
  });
});

describe('shared page for customers', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the published releases with downloads and release notes as text', async (): Promise<void> => {
    loadPage('share', '/share.html#secret-token');
    const calls = fakeApi({ 'GET /public/shares/secret-token': CONTENT });

    await SharePage.init();

    expect(calls[0]?.path).toBe('/public/shares/secret-token');
    expect(textOf('[data-share-label]')).toBe('Freigabe für Pflegedienst Meyer');
    expect(textOf('[data-share-project]')).toBe('MD Ambulant');
    expect(textOf('[data-share-notice]')).toContain('Dieser Link gilt bis');
    expect(textOf('[data-share-notice]')).toContain('Öffne diesen Link dort in Safari');
    expect(textOf('[data-share-applications]')).toContain('4.13.0 (125) Aktuell');
    expect(textOf('[data-share-applications]')).toContain('Noch keine veröffentlichte Version.');
    expect(document.querySelector('.share-notes p')?.textContent).toBe('<b>Fehlerbehebungen</b>');
    expect(
      Array.from(document.querySelectorAll('.share-actions a'), (anchor) => [
        anchor.textContent,
        anchor.getAttribute('href'),
      ]),
    ).toEqual([
      ['downloadAndroid (APK, 1 KB)', '/public/shares/t/artifacts/apk/download'],
      ['downloadiOS (IPA, 2 KB)', '/public/shares/t/artifacts/ipa/download'],
    ]);
    expect(document.querySelector<HTMLElement>('[data-page-content]')?.hidden).toBe(false);
  });

  it('installs directly on iPhone and iPad', async (): Promise<void> => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    loadPage('share', '/share.html#secret-token');
    fakeApi({ 'GET /public/shares/secret-token': { ...CONTENT, releases: 'latest', expiresAt: null } });

    await SharePage.init();

    expect(textOf('[data-share-notice]')).toBe('Hier steht immer die aktuelle Version bereit.');
    expect(document.querySelector('.share-actions a.btn-primary')?.getAttribute('href')).toBe(
      'itms-services://?action=download-manifest&url=x',
    );
  });

  it('explains invalid, missing and failing links', async (): Promise<void> => {
    loadPage('share', '/share.html#revoked');
    fakeApi({ 'GET /public/shares/revoked': apiError(404, 'share_link_not_found') });
    await SharePage.init();
    expect(textOf('[data-page-state]')).toContain('ungültig, abgelaufen oder wurde widerrufen');

    loadPage('share', '/share.html');
    await SharePage.init();
    expect(textOf('[data-page-state]')).toContain('Link nicht verfügbar');

    loadPage('share', '/share.html#broken');
    fakeApi({ 'GET /public/shares/broken': apiError(500, 'internal_error') });
    await SharePage.init();
    expect(textOf('[data-page-state]')).toContain('Laden fehlgeschlagen');

    loadPage('share', '/share.html#empty');
    fakeApi({ 'GET /public/shares/empty': { ...CONTENT, applications: [] } });
    await SharePage.init();
    expect(textOf('[data-share-applications]')).toContain('Noch nichts freigegeben');
  });
});
