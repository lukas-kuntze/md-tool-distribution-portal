import type { DashboardDto, DashboardProjectDto } from '../../../shared/types/api.js';
import { api } from '../../services/api-client.js';
import { currentUser } from '../../services/session-service.js';
import { App } from '../core/app.js';
import { badge, cell, dataTable, emptyState, h, icon, loadPage, render, required } from '../core/dom.js';
import { formatDate, formatDateTime, releaseLabel } from '../core/format.js';
import { labelOf, LIFECYCLE_LABELS, PUBLICATION_LABELS } from '../core/labels.js';
import { describeError } from '../core/messages.js';

const number = new Intl.NumberFormat('de-DE');

/**
 * Start page: how many projects, applications, versions and downloads the user can see, per project and as
 * totals, plus the newest releases. Drafts only count where the user may read them; the API decides.
 */
export const DashboardPage = App.register('DashboardPage', {
  async init(): Promise<void> {
    const root = document.querySelector<HTMLElement>('[data-dashboard-page]');

    if (root === null) {
      return;
    }

    // Without an administrative role the administration has nothing to offer: start on the download page.
    try {
      if (!(await currentUser()).capabilities.administers) {
        window.location.replace('/apps.html');
        return;
      }
    } catch {
      // The dashboard reports the error itself.
    }

    await loadPage(
      root,
      async () => {
        const dashboard = await api.get<DashboardDto>('/api/dashboard');

        required('[data-dashboard-signin]', root).textContent =
          dashboard.previousSignInAt === null
            ? 'Willkommen! Das ist deine erste Anmeldung.'
            : `Zuletzt angemeldet am ${formatDateTime(dashboard.previousSignInAt)}.`;
        render(required('[data-dashboard-stats]', root), statCards(dashboard));
        showQuarantine(root, dashboard);
        render(required('[data-dashboard-projects]', root), projectTable(dashboard));
        render(required('[data-dashboard-releases]', root), releaseTable(dashboard));
      },
      describeError,
    );
  },
});

function statCard(iconName: string, label: string, value: number, delta: string | null): HTMLElement {
  return h(
    'div',
    { class: 'stat-card stat-card-icon' },
    h('span', { class: 'stat-icon', 'aria-hidden': 'true' }, icon(iconName)),
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, number.format(value)),
    delta === null ? null : h('div', { class: 'stat-delta stat-delta-neutral' }, delta),
  );
}

function statCards({ totals, downloadDays, shareLinks, shareExpiryDays }: DashboardDto): HTMLElement[] {
  const pending = [
    totals.drafts > 0 ? `${number.format(totals.drafts)} Entwürfe` : null,
    totals.inDeletion > 0 ? `${number.format(totals.inDeletion)} in Löschung` : null,
  ].filter((part) => part !== null);

  return [
    statCard('folder', 'Projekte', totals.projects, null),
    statCard('apps', 'Anwendungen', totals.applications, null),
    statCard('rocket_launch', 'Veröffentlicht', totals.published, pending.length === 0 ? null : pending.join(' · ')),
    statCard('download', 'Downloads', totals.downloads, `letzte ${downloadDays} Tage`),
    ...(shareLinks === null
      ? []
      : [
          statCard(
            'link',
            'Aktive Freigaben',
            shareLinks.active,
            shareLinks.expiringSoon === 0
              ? null
              : `${number.format(shareLinks.expiringSoon)} ${shareLinks.expiringSoon === 1 ? 'läuft' : 'laufen'} in ${shareExpiryDays} Tagen ab`,
          ),
        ]),
  ];
}

function projectTable({ projects, downloadDays }: DashboardDto): Node {
  if (projects.length === 0) {
    return emptyState(
      'folder_open',
      'Noch nichts zu sehen',
      'Sobald du Zugriff auf ein Projekt hast, erscheint es hier.',
    );
  }

  return dataTable(
    [
      { label: 'Projekt' },
      { label: 'Anwendungen', numeric: true },
      { label: 'Veröffentlicht', numeric: true },
      { label: 'Entwürfe', numeric: true },
      { label: `Downloads ${downloadDays} T.`, numeric: true },
      { label: 'Neueste Version' },
    ],
    projects.map((project) => {
      const sum = (field: 'published' | 'drafts' | 'downloads'): string =>
        number.format(project.applications.reduce((total, application) => total + application[field], 0));
      const newest = newestOf(project);

      return h(
        'tr',
        {},
        cell(h('a', { href: `/project.html?id=${project.id}`, class: 'table-link' }, project.name)),
        cell(project.applications.length, { numeric: true }),
        cell(sum('published'), { numeric: true }),
        cell(sum('drafts'), { numeric: true }),
        cell(sum('downloads'), { numeric: true }),
        cell(
          newest === null
            ? h('span', { class: 'text-muted' }, 'noch keine')
            : [
                h(
                  'a',
                  { href: `/release.html?id=${newest.latest.releaseId}` },
                  `${newest.name} ${releaseLabel(newest.latest)}`,
                ),
                h('div', { class: 'text-muted' }, formatDate(newest.latest.publishedAt)),
              ],
        ),
      );
    }),
  );
}

/** The most recently published version across the applications of a project. */
export function newestOf(project: DashboardProjectDto): {
  readonly name: string;
  readonly latest: NonNullable<DashboardProjectDto['applications'][number]['latest']>;
} | null {
  let newest: ReturnType<typeof newestOf> = null;

  for (const application of project.applications) {
    if (
      application.latest !== null &&
      (newest === null || application.latest.publishedAt > newest.latest.publishedAt)
    ) {
      newest = { name: application.name, latest: application.latest };
    }
  }

  return newest;
}

function releaseTable({ recentReleases }: DashboardDto): Node {
  if (recentReleases.length === 0) {
    return emptyState('rocket_launch', 'Noch keine Releases', 'Releases lädt der GitHub-Actions-Workflow hoch.');
  }

  return dataTable(
    [{ label: 'Release' }, { label: 'Anwendung' }, { label: 'Projekt' }, { label: 'Status' }, { label: 'Datum' }],
    recentReleases.map((release) => {
      const publication = labelOf(PUBLICATION_LABELS, release.publicationStatus);
      const lifecycle = labelOf(LIFECYCLE_LABELS, release.lifecycleState);

      return h(
        'tr',
        {},
        cell(h('a', { href: `/release.html?id=${release.id}`, class: 'table-link' }, releaseLabel(release))),
        cell(h('a', { href: `/application.html?id=${release.applicationId}` }, release.applicationName)),
        cell(release.projectName),
        cell(
          h(
            'span',
            { class: 'badge-row' },
            badge(publication.text, publication.tone),
            release.lifecycleState === 'active' ? null : badge(lifecycle.text, lifecycle.tone),
          ),
        ),
        cell(formatDate(release.publishedAt ?? release.createdAt)),
      );
    }),
  );
}

/**
 * Releases in quarantine that are deleted for good within the next days; restoring is only possible until
 * then. The card stays hidden while there are none.
 */
function showQuarantine(root: HTMLElement, { quarantineEnding }: DashboardDto): void {
  required('[data-dashboard-quarantine]', root).hidden = quarantineEnding.length === 0;
  render(
    required('[data-dashboard-quarantine-count]', root),
    badge(quarantineEnding.length === 1 ? '1 Release' : `${quarantineEnding.length} Releases`, 'warning'),
  );
  render(
    required('[data-dashboard-quarantine-list]', root),
    dataTable(
      [
        { label: 'Release' },
        { label: 'Anwendung' },
        { label: 'Projekt' },
        { label: 'Endgültig gelöscht ab' },
        { label: 'Aktion', numeric: true },
      ],
      quarantineEnding.map((release) =>
        h(
          'tr',
          {},
          cell(h('a', { href: `/release.html?id=${release.releaseId}`, class: 'table-link' }, releaseLabel(release))),
          cell(h('a', { href: `/application.html?id=${release.applicationId}` }, release.applicationName)),
          cell(release.projectName),
          cell(formatDateTime(release.purgeAfter)),
          cell(
            h(
              'a',
              { class: 'btn btn-outline btn-sm', href: `/release.html?id=${release.releaseId}` },
              release.canRestore ? 'Wiederherstellen …' : 'Ansehen',
            ),
            { numeric: true },
          ),
        ),
      ),
    ),
  );
}
