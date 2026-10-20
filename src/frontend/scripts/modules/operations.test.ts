import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AuditEntryDto, DeletionJobDto, StorageOverviewDto } from '../../../shared/types/api.js';
import { RELEASE_ID } from '../testing/fixtures.js';
import { apiError, click, fakeApi, loadPage, submitForm, textOf, type, user } from '../testing/page.js';
import { AuditLog, filterOf } from './audit-log.js';
import { Overlays } from './overlays.js';
import { StoragePage } from './storage-page.js';

function entry(overrides: Partial<AuditEntryDto> = {}): AuditEntryDto {
  return {
    id: 42,
    occurredAt: '2026-10-17T08:00:00.000Z',
    actor: { type: 'user', label: 'ada', userId: 'u1' },
    action: 'release.delete.requested',
    target: { type: 'release', id: RELEASE_ID },
    projectId: null,
    applicationId: null,
    outcome: 'success',
    details: { reason: '<b>Absturz</b>' },
    ...overrides,
  };
}

function job(overrides: Partial<DeletionJobDto> = {}): DeletionJobDto {
  return {
    jobId: 'job-1',
    releaseId: RELEASE_ID,
    artifactId: null,
    state: 'failed',
    requestedAt: '2026-10-17T08:00:00.000Z',
    reason: 'Absturz',
    purgeAfter: null,
    attempts: 5,
    lastErrorCode: 'io_ebusy',
    requiresManualReview: true,
    failedPhase: 'quarantine',
    nextAttemptAt: null,
    completedAt: null,
    rowVersion: 1,
    ...overrides,
  };
}

describe('audit log', (): void => {
  beforeAll((): void => {
    Overlays.init();
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('lists entries, filters them and shows details as text', async (): Promise<void> => {
    loadPage('audit');
    const calls = fakeApi({
      'GET /api/session': user(),
      'GET /api/audit-logs': [
        entry(),
        entry({ id: 41, actor: { type: 'ci', label: 'md/k-mobile', userId: null }, outcome: 'denied' }),
      ],
    });

    await AuditLog.init();
    await vi.waitFor(() => expect(textOf('[data-audit-page] tbody')).toContain('release.delete.requested'));
    expect(textOf('[data-audit-page] tbody')).toContain('CI');
    expect(textOf('[data-audit-page] tbody')).toContain('Verweigert');

    click('[data-audit-page] tbody button');
    expect(textOf('#audit-details pre.code')).toContain('"reason": "<b>Absturz</b>"');
    expect(document.querySelector('#audit-details b')).toBeNull();

    type('#audit-global-action', 'release.');
    type('#audit-global-outcome', 'denied');
    submitForm('[data-audit-page] form');
    await vi.waitFor(() =>
      expect(calls.at(-1)?.path).toBe('/api/audit-logs?scope=global&limit=50&offset=0&action=release.&outcome=denied'),
    );
  });

  it('explains missing permission and empty results', async (): Promise<void> => {
    loadPage('audit');
    fakeApi({ 'GET /api/session': user({ readAudit: false }) });
    await AuditLog.init();
    expect(textOf('[data-audit-page]')).toContain('Keine Berechtigung');

    loadPage('audit');
    fakeApi({ 'GET /api/session': user(), 'GET /api/audit-logs': [] });
    await AuditLog.init();
    await vi.waitFor(() => expect(textOf('[data-audit-page]')).toContain('Keine Einträge'));
  });

  it('turns date fields into whole local days', (): void => {
    const form = document.createElement('form');
    form.innerHTML =
      '<input name="action" value=""><select name="outcome"><option value=""></option></select><input name="from" value="2026-10-01"><input name="to" value="2026-10-02">';

    const filter = filterOf(form, 2);

    expect(filter).toMatchObject({ limit: 50, offset: 100 });
    expect(filter.from).toBe(new Date('2026-10-01T00:00:00').toISOString());
    expect(filter.to).toBe(new Date('2026-10-02T23:59:59.999').toISOString());
  });
});

describe('storage page', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('lists failed deletion jobs and retries them', async (): Promise<void> => {
    loadPage('storage');
    const calls = fakeApi({
      'GET /api/session': user(),
      'GET /api/deletion-jobs': [
        job(),
        job({
          jobId: 'job-2',
          state: 'quarantined',
          requiresManualReview: false,
          failedPhase: null,
          lastErrorCode: null,
        }),
      ],
      'POST /api/deletion-jobs/job-1/retry': job({ state: 'requested' }),
    });

    await StoragePage.init();
    expect(textOf('[data-job-list] tbody')).toContain('Manuelle Prüfung');
    expect(textOf('[data-job-list] tbody')).toContain('io_ebusy');
    expect(document.querySelector('[data-job-list] a')?.getAttribute('href')).toBe(`/release.html?id=${RELEASE_ID}`);

    click('[data-job-list] tbody button');
    await vi.waitFor(() => expect(calls.some((call) => call.path === '/api/deletion-jobs/job-1/retry')).toBe(true));

    type('[data-job-filter]', 'completed,restored,cancelled');
    await vi.waitFor(() =>
      expect(calls.at(-1)?.path).toBe('/api/deletion-jobs?state=completed%2Crestored%2Ccancelled'),
    );
  });

  it('shows usage and the latest reconciliation and starts a new one', async (): Promise<void> => {
    loadPage('storage');
    const usage = {
      storedBytes: 3 * 1024 * 1024,
      storedArtifacts: 4,
      quarantinedBytes: 1024,
      quarantinedArtifacts: 1,
      missingArtifacts: 1,
    };
    const overview: StorageOverviewDto = {
      total: usage,
      projects: [{ ...usage, projectId: 'p1', name: 'MD Ambulant' }],
      latestReport: {
        id: 'r1',
        trigger: 'schedule',
        startedAt: '2026-10-17T02:00:00.000Z',
        finishedAt: '2026-10-17T02:00:05.000Z',
        filesChecked: 6,
        bytesChecked: 4096,
        missing: [
          {
            artifactId: 'a1',
            releaseId: RELEASE_ID,
            applicationId: 'app1',
            expectedPath: 'artifacts/app1/r1/a1.ipa',
            sizeBytes: 2048,
            problem: 'missing',
            quarantined: false,
          },
        ],
        recovered: [],
        orphaned: [{ path: 'artifacts/app1/stray/x.apk', sizeBytes: 5, type: 'file' }],
      },
    };
    const calls = fakeApi({
      'GET /api/session': user(),
      'GET /api/deletion-jobs': [],
      'GET /api/storage': overview,
      'POST /api/storage/reconcile': { ...overview.latestReport, id: 'r2', missing: [], orphaned: [] },
    });

    await StoragePage.init();

    expect(Array.from(document.querySelectorAll('.stat-card .stat-label'), (label) => label.textContent)).toEqual([
      'Belegt gesamt',
      'Abrufbar',
      'In Quarantäne',
      'Abweichungen',
    ]);
    expect(Array.from(document.querySelectorAll('.stat-card .stat-icon'), (icon) => icon.textContent)).toEqual([
      'storage',
      'cloud_done',
      'hourglass_bottom',
      'rule',
    ]);
    expect(textOf('[data-storage-stats]')).toContain('3 MB');
    expect(textOf('[data-storage-projects] tbody')).toContain('MD Ambulant');
    expect(textOf('[data-storage-report]')).toContain('Fehlende Dateien (1)');
    expect(textOf('[data-storage-report]')).toContain('artifacts/app1/stray/x.apk');
    expect(document.querySelector('.stat-delta.negative')).not.toBeNull();

    click('[data-action="reconcile"]');
    await vi.waitFor(() => expect(calls.some((call) => call.path === '/api/storage/reconcile')).toBe(true));
  });

  it('needs storage.manage and reports failures', async (): Promise<void> => {
    loadPage('storage');
    fakeApi({ 'GET /api/session': user({ manageStorage: false }) });
    await StoragePage.init();
    expect(textOf('[data-job-list]')).toContain('Keine Berechtigung');

    loadPage('storage');
    fakeApi({ 'GET /api/session': user(), 'GET /api/deletion-jobs': apiError(403, 'permission_denied') });
    await StoragePage.init();
    expect(textOf('[data-job-list]')).toContain('Dafür fehlt dir die Berechtigung.');

    loadPage('storage');
    fakeApi({
      'GET /api/session': user(),
      'GET /api/deletion-jobs': [],
      'GET /api/storage': {
        total: {
          storedBytes: 0,
          storedArtifacts: 0,
          quarantinedBytes: 0,
          quarantinedArtifacts: 0,
          missingArtifacts: 0,
        },
        projects: [],
        latestReport: null,
      },
    });
    await StoragePage.init();
    expect(textOf('[data-job-list]')).toContain('Keine Löschaufträge');
    expect(textOf('[data-storage-report]')).toContain('Noch kein Abgleich');
  });
});
