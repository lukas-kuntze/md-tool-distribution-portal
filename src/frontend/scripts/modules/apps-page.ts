import type { CatalogDto } from '../../../shared/types/api.js';
import { api } from '../../services/api-client.js';
import { releases } from '../../services/release-service.js';
import { currentUser, signOut } from '../../services/session-service.js';
import { App } from '../core/app.js';
import { isAppleMobileDevice } from '../core/device.js';
import { alertBox, emptyState, h, loadPage, queryParameter, render, required } from '../core/dom.js';
import { describeError } from '../core/messages.js';
import { applicationCard } from './published-apps.js';
import { Theme } from './theme.js';
import { Toast } from './toast.js';

/**
 * Download page for signed-in employees (`apps.html`): the current release of every application they may
 * install, presented like a share link and without the administration. Users without administrative roles
 * land here after signing in.
 */
export const AppsPage = App.register('AppsPage', {
  async init(): Promise<void> {
    const root = document.querySelector<HTMLElement>('[data-apps-page]');

    if (root === null) {
      return;
    }

    document.querySelector('[data-sign-out]')?.addEventListener('click', () => {
      signOut().catch((error: unknown) => Toast.show('danger', 'Abmelden fehlgeschlagen', describeError(error)));
    });

    await loadPage(
      root,
      async () => {
        const [user, catalog] = await Promise.all([currentUser(), api.get<CatalogDto>('/api/catalog')]);
        Theme.fromAccount(user.preferences.theme);

        for (const name of document.querySelectorAll('[data-user-name]')) {
          name.textContent = user.displayName;
        }

        const adminLink = document.querySelector<HTMLElement>('[data-admin-link]');

        if (adminLink !== null) {
          adminLink.hidden = !user.capabilities.administers;
        }

        render(
          required('[data-apps-notice]', root),
          isAppleMobileDevice()
            ? null
            : alertBox(
                'info',
                'iPhone und iPad',
                'iOS-Apps lassen sich nur direkt auf dem Gerät installieren: Öffne diese Seite dort in Safari.',
              ),
        );
        const list = required('[data-apps-projects]', root);
        const title = required('[data-apps-title]', root);
        const show = (filter: AppsFilter): void => {
          const project = catalog.projects.find((candidate) => candidate.id === filter.project);
          title.textContent = project === undefined ? 'Apps installieren' : `Apps installieren · ${project.name}`;
          render(list, projectSections(byFlavor(byProject(catalog, filter.project), filter.flavor)));
        };
        // `?project=<id>` also comes from "Apps installieren" on a project page.
        const initial = selectedFilter(catalog, queryParameter('project'), queryParameter('flavor'));

        render(required('[data-apps-filter]', root), filterBar(catalog, initial, show));
        show(initial);
      },
      describeError,
    );
  },
});

/** Flavor names of all releases on the page, e.g. Production and Staging, in German order. */
export function flavorsOf(catalog: CatalogDto): string[] {
  const names = new Set<string>();

  for (const project of catalog.projects) {
    for (const application of project.applications) {
      for (const release of application.releases) {
        if (release.flavorName !== null) {
          names.add(release.flavorName);
        }
      }
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b, 'de'));
}

/** Only releases of the flavor; applications and projects without any are left out. `null` keeps everything. */
export function byFlavor(catalog: CatalogDto, flavor: string | null): CatalogDto {
  if (flavor === null) {
    return catalog;
  }

  return {
    projects: catalog.projects
      .map((project) => ({
        ...project,
        applications: project.applications
          .map((application) => ({
            ...application,
            releases: application.releases.filter((release) => release.flavorName === flavor),
          }))
          .filter((application) => application.releases.length > 0),
      }))
      .filter((project) => project.applications.length > 0),
  };
}

/** `null` shows everything. */
export interface AppsFilter {
  readonly project: string | null;
  readonly flavor: string | null;
}

/** Only the chosen project; `null` keeps all. */
export function byProject(catalog: CatalogDto, project: string | null): CatalogDto {
  return project === null ? catalog : { projects: catalog.projects.filter((entry) => entry.id === project) };
}

/** The requested filter, as far as the catalog offers it; unknown projects or flavors fall back to "all". */
export function selectedFilter(catalog: CatalogDto, project: string | null, flavor: string | null): AppsFilter {
  const knownProject = project !== null && catalog.projects.some((entry) => entry.id === project) ? project : null;
  const flavors = flavorsOf(byProject(catalog, knownProject));
  return { project: knownProject, flavor: flavor !== null && flavors.includes(flavor) ? flavor : null };
}

/**
 * Project and flavor filter. Each select appears only when there is a choice: more than one project, or
 * applications with flavors. The filter is kept in `?project=` and `?flavor=` for links and reloads.
 */
function filterBar(catalog: CatalogDto, initial: AppsFilter, show: (filter: AppsFilter) => void): Node | null {
  let filter = initial;
  const projectSelect = h(
    'select',
    { id: 'apps-project', class: 'form-control', name: 'project' },
    h('option', { value: '' }, 'Alle Projekte'),
    catalog.projects.map((project) =>
      h('option', { value: project.id, selected: project.id === filter.project }, project.name),
    ),
  );
  const flavorSelect = h('select', { id: 'apps-flavor', class: 'form-control', name: 'flavor' });
  const projectGroup = field('apps-project', 'Projekt', projectSelect);
  const flavorGroup = field('apps-flavor', 'Flavor', flavorSelect);

  // The flavors on offer depend on the project, so their list follows the project choice.
  const fillFlavors = (): void => {
    const flavors = flavorsOf(byProject(catalog, filter.project));
    flavorSelect.replaceChildren(
      h('option', { value: '' }, 'Alle Flavors'),
      ...flavors.map((name) => h('option', { value: name, selected: name === filter.flavor }, name)),
    );
    flavorGroup.hidden = flavors.length === 0;
  };

  const apply = (next: AppsFilter): void => {
    filter = selectedFilter(catalog, next.project, next.flavor);
    const url = new URL(window.location.href);

    for (const [name, value] of Object.entries(filter) as [keyof AppsFilter, string | null][]) {
      if (value === null) {
        url.searchParams.delete(name);
      } else {
        url.searchParams.set(name, value);
      }
    }

    window.history.replaceState(null, '', url);
    fillFlavors();
    show(filter);
  };

  projectSelect.addEventListener('change', () => apply({ ...filter, project: projectSelect.value || null }));
  flavorSelect.addEventListener('change', () => apply({ ...filter, flavor: flavorSelect.value || null }));
  projectGroup.hidden = catalog.projects.length < 2;
  fillFlavors();

  return projectGroup.hidden && flavorGroup.hidden
    ? null
    : h('div', { class: 'toolbar', role: 'search', 'aria-label': 'Apps filtern' }, projectGroup, flavorGroup);
}

function field(id: string, label: string, control: HTMLElement): HTMLElement {
  return h('div', { class: 'form-group' }, h('label', { class: 'form-label', for: id }, label), control);
}

function projectSections(catalog: CatalogDto): Node | Node[] {
  if (catalog.projects.length === 0) {
    return emptyState(
      'apps',
      'Keine Apps verfügbar',
      'Für dich ist noch keine App freigegeben. Wende dich an das zuständige Projektteam.',
    );
  }

  const requestInstall = async (artifactId: string): Promise<string> =>
    (await releases.installLink(artifactId)).installUrl;

  return catalog.projects.map((project) =>
    h(
      'div',
      { class: 'stack apps-project', role: 'group', 'aria-labelledby': `project-${project.id}` },
      h(
        'div',
        {},
        h('h2', { class: 'section-title', id: `project-${project.id}` }, project.name),
        project.description === '' ? null : h('p', { class: 'text-muted' }, project.description),
      ),
      h(
        'div',
        { class: 'apps-grid' },
        project.applications.map((application) => applicationCard(application, { requestInstall })),
      ),
    ),
  );
}
