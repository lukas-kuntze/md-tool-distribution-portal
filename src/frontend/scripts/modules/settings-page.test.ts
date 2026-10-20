import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlatformSettingsDto, SettingsDto } from '../../../shared/types/api.js';
import { fakeApi, loadPage, submitForm, textOf, type, user, type Call } from '../testing/page.js';
import { applyBranding } from './branding.js';
import { SettingsPage } from './settings-page.js';

const SETTINGS: PlatformSettingsDto = {
  version: '0.1.0',
  nodeVersion: 'v24.21.0',
  publicUrl: 'https://apps.example.com',
  gitHub: { webUrl: 'https://github.com', apiUrl: 'https://api.github.com', organization: 'medifox' },
  bootstrapAdministrators: 1,
  ci: { issuer: 'https://token.actions.githubusercontent.com', audience: 'https://apps.example.com' },
  storage: { databasePath: 'D:\\data\\distribution.db', storageRoot: 'D:\\storage', servedAreas: ['D:\\public'] },
  limits: {
    maxUploadMegabytes: 2048,
    quarantineDays: 7,
    installLinkMinutes: 10,
    sessionAbsoluteHours: 12,
    sessionIdleMinutes: 120,
  },
  worker: { pollSeconds: 30, leaseMinutes: 15, reconcileHours: 24 },
};

const EDITABLE: SettingsDto = {
  quarantineDays: 7,
  sessionAbsoluteHours: 12,
  sessionIdleMinutes: 120,
  installLinkMinutes: 10,
  shareLinkDefaultDays: null,
  shareLinkMaxDays: null,
  shareLinkDefaultReleases: 'all',
  defaultVisibility: 'private',
  reconcileHours: 24,
  dashboardDownloadDays: 30,
  dashboardQuarantineDays: 7,
  dashboardShareExpiryDays: 14,
  portalName: 'App-Distribution',
  supportContact: '',
  publicNotice: '',
  footerText: 'Bereitgestellt über die App-Distribution',
  rowVersion: 3,
};

describe('settings page', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('saves the settings and shows the start configuration below', async (): Promise<void> => {
    loadPage('settings');
    const calls = fakeApi({
      'GET /api/session': user(),
      'GET /api/settings': EDITABLE,
      'PUT /api/settings': (call: Call) => ({ ...(call.body as SettingsDto), rowVersion: 4 }),
      'GET /api/platform-settings': SETTINGS,
    });

    await SettingsPage.init();

    const field = (name: string): string =>
      (document.querySelector(`#settings-form [name="${name}"]`) as HTMLInputElement).value;
    expect(field('quarantineDays')).toBe('7');
    expect(field('shareLinkMaxDays')).toBe('');
    expect(textOf('[data-settings-page]')).toContain('Version0.1.0');
    expect(textOf('[data-settings-page]')).toContain('Größte Datei2.048 MB');
    // Values that are settings now appear only in the form, not in the start configuration.
    expect(textOf('[data-settings-page]')).not.toContain('QUARANTINE_RETENTION_DAYS');

    type('#settings-form [name="sessionIdleMinutes"]', '900');
    submitForm('#settings-form');
    expect(textOf('#settings-form .form-error')).toContain('nicht länger sein als die Sitzung');

    type('#settings-form [name="sessionIdleMinutes"]', '60');
    type('#settings-form [name="quarantineDays"]', '14');
    type('#settings-form [name="shareLinkMaxDays"]', '30');
    type('#settings-form [name="shareLinkDefaultDays"]', '14');
    type('#settings-form [name="portalName"]', 'MEDIFOX DAN Apps');
    submitForm('#settings-form');

    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      ...EDITABLE,
      sessionIdleMinutes: 60,
      quarantineDays: 14,
      shareLinkMaxDays: 30,
      shareLinkDefaultDays: 14,
      portalName: 'MEDIFOX DAN Apps',
    });
  });

  it('shows only the start configuration to platform operations', async (): Promise<void> => {
    loadPage('settings');
    fakeApi({
      'GET /api/session': user({ manageSettings: false }),
      'GET /api/platform-settings': SETTINGS,
    });

    await SettingsPage.init();

    expect(document.querySelector('#settings-form')).toBeNull();
    expect(textOf('[data-settings-page]')).toContain('https://token.actions.githubusercontent.com');
    expect(document.querySelectorAll('[data-settings-page] .card')).toHaveLength(5);
  });

  it('is reserved to platform administrators and operations', async (): Promise<void> => {
    loadPage('settings');
    fakeApi({ 'GET /api/session': user({ manageStorage: false, manageSettings: false }) });

    await SettingsPage.init();

    expect(textOf('[data-settings-page]')).toContain('Keine Berechtigung');
  });
});

describe('branding', (): void => {
  it('puts name, notice, contact and footer of the portal on public pages', (): void => {
    loadPage('share', '/share.html#token');
    applyBranding({
      portalName: 'MEDIFOX DAN Apps',
      supportContact: 'it-service@example.com',
      publicNotice: 'Nur Diensthandys',
      footerText: '',
    });

    expect(document.title).toBe('Freigabe · MEDIFOX DAN Apps');
    expect(textOf('[data-branding-notice]')).toBe('HinweisNur DiensthandysFragen? it-service@example.com');
    expect(document.querySelector<HTMLElement>('.public-footer')?.hidden).toBe(true);
  });
});

describe('documentation page', (): void => {
  it('links its sections and the download page links to the installation help', (): void => {
    loadPage('docs');
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('.docs-toc a'), (link) =>
      link.getAttribute('href'),
    );

    expect(anchors).toEqual(['#erste-schritte', '#installation', '#ci', '#rollen']);
    for (const anchor of anchors) {
      expect(document.querySelector(anchor ?? '')).not.toBeNull();
    }

    loadPage('apps');
    expect(document.querySelector('a[href="/docs.html#installation"]')).not.toBeNull();
  });
});
