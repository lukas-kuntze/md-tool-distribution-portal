import type { DeletionJobDto, StorageOverviewDto, StorageReportDto } from '../../../shared/types/api.js';
import { operations } from '../../services/operations-service.js';
import { currentUser } from '../../services/session-service.js';
import { App } from '../core/app.js';
import {
  alertBox,
  badge,
  cell,
  dataTable,
  emptyState,
  errorState,
  h,
  icon,
  loadingState,
  render,
  required,
} from '../core/dom.js';
import { formatBytes, formatDateTime } from '../core/format.js';
import { whileBusy } from '../core/forms.js';
import { DELETION_STATE_LABELS, labelOf } from '../core/labels.js';
import { describeError } from '../core/messages.js';
import { Overlays } from './overlays.js';
import { Toast } from './toast.js';

const number = new Intl.NumberFormat('de-DE');

/**
 * Storage view (`storage.html`), concept 5.6/6.5/7.2: usage in total, per project and in quarantine, the
 * latest database-to-file-system reconciliation and the deletion jobs, above all the failed ones that wait
 * for a manual check and "Erneut versuchen". Needs `storage.manage`.
 */
export const StoragePage = App.register('StoragePage', {
  async init(): Promise<void> {
    const root = document.querySelector<HTMLElement>('[data-storage-page]');

    if (root === null) {
      return;
    }

    const filter = required<HTMLSelectElement>('[data-job-filter]', root);
    const list = required('[data-job-list]', root);
    const overview = required('[data-storage-overview]', root);
    const reconcile = required<HTMLButtonElement>('[data-action="reconcile"]', root);
    let canPurge = false;

    const load = async (): Promise<void> => {
      render(list, loadingState());

      try {
        const states = filter.value === '' ? undefined : filter.value.split(',');
        render(list, jobTable(await operations.deletionJobs(states), load, canPurge));
      } catch (error) {
        render(
          list,
          errorState(describeError(error), () => void load()),
        );
      }
    };

    const loadOverview = async (): Promise<void> => {
      const stats = required('[data-storage-stats]', overview);
      overview.hidden = false;
      render(stats, loadingState());

      try {
        showOverview(overview, await operations.storage());
      } catch (error) {
        render(
          stats,
          errorState(describeError(error), () => void loadOverview()),
        );
      }
    };

    try {
      const user = await currentUser();

      if (!user.capabilities.manageStorage) {
        render(
          list,
          emptyState(
            'lock',
            'Keine Berechtigung',
            'Die Speicherverwaltung erfordert die Berechtigung „storage.manage“.',
          ),
        );
        filter.disabled = true;
        return;
      }

      canPurge = user.capabilities.purgeReleases;
    } catch (error) {
      render(list, errorState(describeError(error)));
      return;
    }

    reconcile.hidden = false;
    reconcile.addEventListener('click', () => {
      void whileBusy(reconcile, async () => {
        try {
          const report = await operations.reconcileStorage();
          const missing = report.missing.length;
          Toast.show(
            missing === 0 ? 'success' : 'warning',
            'Abgleich abgeschlossen',
            missing === 0
              ? 'Alle Dateien sind vorhanden.'
              : `${number.format(missing)} Datei(en) fehlen oder weichen ab.`,
          );
          await Promise.all([loadOverview(), load()]);
        } catch (error) {
          Toast.show('danger', 'Abgleich fehlgeschlagen', describeError(error));
        }
      });
    });
    filter.addEventListener('change', () => void load());
    await Promise.all([loadOverview(), load()]);
  },
});

function statCard(iconName: string, label: string, value: string, delta: string | null, negative = false): HTMLElement {
  return h(
    'div',
    { class: 'stat-card stat-card-icon' },
    h('span', { class: 'stat-icon', 'aria-hidden': 'true' }, icon(iconName)),
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value),
    delta === null
      ? null
      : h('div', { class: negative ? 'stat-delta negative' : 'stat-delta stat-delta-neutral' }, delta),
  );
}

function artifacts(count: number): string {
  return `${number.format(count)} ${count === 1 ? 'Artefakt' : 'Artefakte'}`;
}

function showOverview(root: HTMLElement, { total, projects, latestReport }: StorageOverviewDto): void {
  const findings = latestReport === null ? 0 : latestReport.missing.length + latestReport.orphaned.length;

  render(required('[data-storage-stats]', root), [
    statCard('storage', 'Belegt gesamt', formatBytes(total.storedBytes + total.quarantinedBytes), null),
    statCard('cloud_done', 'Abrufbar', formatBytes(total.storedBytes), artifacts(total.storedArtifacts)),
    statCard(
      'hourglass_bottom',
      'In Quarantäne',
      formatBytes(total.quarantinedBytes),
      artifacts(total.quarantinedArtifacts),
    ),
    statCard(
      'rule',
      'Abweichungen',
      number.format(findings),
      latestReport === null ? 'noch kein Abgleich' : `${number.format(total.missingArtifacts)} fehlend`,
      findings > 0,
    ),
  ]);
  render(required('[data-storage-projects]', root), projectTable(projects));
  required('[data-storage-report-time]', root).textContent =
    latestReport === null
      ? ''
      : `${formatDateTime(latestReport.finishedAt)} · ${latestReport.trigger === 'manual' ? 'manuell' : 'geplant'}`;
  render(required('[data-storage-report]', root), reportView(latestReport));
}

function projectTable(projects: StorageOverviewDto['projects']): Node {
  if (projects.length === 0) {
    return emptyState('inventory_2', 'Noch keine Dateien', 'Sobald Builds hochgeladen sind, steht hier ihre Belegung.');
  }

  return dataTable(
    [
      { label: 'Projekt' },
      { label: 'Abrufbar', numeric: true },
      { label: 'Artefakte', numeric: true },
      { label: 'In Quarantäne', numeric: true },
      { label: 'Fehlend', numeric: true },
    ],
    projects.map((project) =>
      h(
        'tr',
        {},
        cell(h('a', { href: `/project.html?id=${project.projectId}`, class: 'table-link' }, project.name)),
        cell(formatBytes(project.storedBytes), { numeric: true }),
        cell(number.format(project.storedArtifacts), { numeric: true }),
        cell(
          project.quarantinedArtifacts === 0
            ? '—'
            : `${formatBytes(project.quarantinedBytes)} (${number.format(project.quarantinedArtifacts)})`,
          { numeric: true },
        ),
        cell(project.missingArtifacts === 0 ? '—' : badge(number.format(project.missingArtifacts), 'danger'), {
          numeric: true,
        }),
      ),
    ),
  );
}

function reportView(report: StorageReportDto | null): Node {
  if (report === null) {
    return emptyState(
      'fact_check',
      'Noch kein Abgleich',
      'Der Worker gleicht Datenbank und Dateisystem täglich ab. Mit „Jetzt prüfen“ startest du den Abgleich sofort.',
    );
  }

  const summary = `${number.format(report.filesChecked)} Einträge mit ${formatBytes(report.bytesChecked)} geprüft.`;
  const parts: Node[] = [];

  if (report.missing.length === 0 && report.orphaned.length === 0) {
    parts.push(alertBox('success', 'Alles in Ordnung', `${summary} Keine fehlenden oder verwaisten Dateien.`));
  } else {
    parts.push(
      alertBox(
        report.missing.length > 0 ? 'danger' : 'warning',
        'Abweichungen gefunden',
        `${summary} Fehlende Dateien sind als „fehlend“ markiert und nicht herunterladbar. Verwaiste Einträge werden nur gemeldet, nie automatisch gelöscht.`,
      ),
    );
  }

  if (report.recovered.length > 0) {
    parts.push(
      alertBox(
        'info',
        'Wiedergefunden',
        `${number.format(report.recovered.length)} zuvor fehlende Datei(en) sind wieder vorhanden und abrufbar.`,
      ),
    );
  }

  if (report.missing.length > 0) {
    parts.push(
      h('h4', { class: 'card-title' }, `Fehlende Dateien (${number.format(report.missing.length)})`),
      dataTable(
        [{ label: 'Erwarteter Pfad' }, { label: 'Problem' }, { label: 'Größe', numeric: true }, { label: 'Release' }],
        report.missing.map((entry) =>
          h(
            'tr',
            {},
            cell(h('code', {}, entry.expectedPath)),
            cell(
              h(
                'div',
                { class: 'badge-row' },
                badge(entry.problem === 'missing' ? 'Fehlt' : 'Größe weicht ab', 'danger'),
                entry.quarantined ? badge('Quarantäne', 'neutral') : null,
              ),
            ),
            cell(formatBytes(entry.sizeBytes), { numeric: true }),
            cell(h('a', { href: `/release.html?id=${entry.releaseId}`, class: 'table-link' }, 'Release öffnen')),
          ),
        ),
      ),
    );
  }

  if (report.orphaned.length > 0) {
    parts.push(
      h('h4', { class: 'card-title' }, `Verwaiste Einträge (${number.format(report.orphaned.length)})`),
      dataTable(
        [{ label: 'Pfad' }, { label: 'Art' }, { label: 'Größe', numeric: true }],
        report.orphaned.map((entry) =>
          h(
            'tr',
            {},
            cell(h('code', {}, entry.path)),
            cell(entry.type === 'file' ? 'Datei' : 'Sonstiges, z. B. Verknüpfung'),
            cell(entry.type === 'file' ? formatBytes(entry.sizeBytes) : '—', { numeric: true }),
          ),
        ),
      ),
    );
  }

  return h('div', { class: 'stack' }, parts);
}

function jobTable(jobs: readonly DeletionJobDto[], reload: () => Promise<void>, canPurge: boolean): Node {
  if (jobs.length === 0) {
    return emptyState('task_alt', 'Keine Löschaufträge', 'Für diesen Filter gibt es keine Löschaufträge.');
  }

  return dataTable(
    [
      { label: 'Release' },
      { label: 'Zustand' },
      { label: 'Beantragt' },
      { label: 'Begründung' },
      { label: 'Endgültige Löschung' },
      { label: 'Versuche', numeric: true },
      { label: 'Letzter Fehler' },
      { label: 'Aktionen', numeric: true },
    ],
    jobs.map((job) => {
      const state = labelOf(DELETION_STATE_LABELS, job.state);
      const retry =
        job.state === 'failed'
          ? h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, 'Erneut versuchen')
          : null;

      retry?.addEventListener('click', () => {
        void whileBusy(retry, async () => {
          try {
            await operations.retryDeletionJob(job.jobId);
            Toast.show('success', 'Löschauftrag wird erneut ausgeführt');
            await reload();
          } catch (error) {
            Toast.show('danger', 'Wiederholen fehlgeschlagen', describeError(error));
          }
        });
      });

      const purge =
        canPurge && job.state === 'quarantined'
          ? h('button', { type: 'button', class: 'btn btn-danger btn-sm' }, 'Endgültig löschen')
          : null;

      purge?.addEventListener('click', () => {
        openPurgeModal(job, purge, reload);
      });

      return h(
        'tr',
        {},
        cell([
          h('a', { href: `/release.html?id=${job.releaseId}`, class: 'table-link' }, 'Release öffnen'),
          h('div', { class: 'text-muted' }, job.artifactId === null ? 'ganzes Release' : 'einzelnes Artefakt'),
        ]),
        cell(
          h(
            'div',
            { class: 'badge-row' },
            badge(state.text, state.tone),
            job.requiresManualReview ? badge('Manuelle Prüfung', 'danger') : null,
            job.failedPhase === null
              ? null
              : badge(job.failedPhase === 'purge' ? 'beim Löschen' : 'bei Quarantäne', 'neutral'),
          ),
        ),
        cell(formatDateTime(job.requestedAt)),
        cell(job.reason),
        cell(formatDateTime(job.purgeAfter)),
        cell(job.attempts, { numeric: true }),
        cell(job.lastErrorCode === null ? '—' : h('code', {}, job.lastErrorCode)),
        cell(retry ?? purge, { numeric: true }),
      );
    }),
  );
}

let purgeModal: { overlay: HTMLElement; text: HTMLElement; confirm: HTMLButtonElement } | null = null;

/** Ending the quarantine early cannot be undone, so it asks once more; the worker deletes the files shortly after. */
function openPurgeModal(job: DeletionJobDto, trigger: HTMLElement, reload: () => Promise<void>): void {
  purgeModal ??= createPurgeModal();

  const { overlay, text, confirm } = purgeModal;
  const subject = job.artifactId === null ? 'Das Release' : 'Das Artefakt';

  text.textContent = `${subject} wird nicht erst am ${formatDateTime(job.purgeAfter)}, sondern sofort endgültig gelöscht und kann danach nicht mehr wiederhergestellt werden.`;
  confirm.onclick = (): void => {
    void whileBusy(confirm, async () => {
      try {
        await operations.purgeDeletionJobNow(job.jobId);
        Overlays.close(overlay);
        Toast.show('success', 'Endgültige Löschung gestartet', 'Die Dateien werden in Kürze entfernt.');
        await reload();
      } catch (error) {
        Toast.show('danger', 'Löschen fehlgeschlagen', describeError(error));
      }
    });
  };
  Overlays.open(overlay, trigger);
}

function createPurgeModal(): NonNullable<typeof purgeModal> {
  const text = h('p', {});
  const confirm = h('button', { type: 'button', class: 'btn btn-danger' }, 'Endgültig löschen');
  const overlay = h(
    'div',
    { class: 'modal-overlay', id: 'purge-modal', hidden: true },
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'purge-title' },
      h(
        'div',
        { class: 'modal-header' },
        h('h3', { id: 'purge-title' }, 'Vorzeitig endgültig löschen?'),
        h('button', { type: 'button', class: 'close-btn', 'data-modal-close': true, 'aria-label': 'Schließen' }, '×'),
      ),
      h('div', { class: 'modal-body' }, text),
      h(
        'div',
        { class: 'modal-footer' },
        h('button', { type: 'button', class: 'btn btn-outline', 'data-modal-close': true }, 'Abbrechen'),
        confirm,
      ),
    ),
  );

  document.body.append(overlay);
  return { overlay, text, confirm };
}
