import type { ApplicationDto, ProjectDto } from '../../../shared/types/api.js';
import { NAME_MAX_LENGTH } from '../../../shared/constants/formats.js';
import { applications, projects } from '../../services/project-service.js';
import { settingsService } from '../../services/settings-service.js';
import { App } from '../core/app.js';
import { bindPlatformToggles, bundleIdentifiersOf, platformsOf, validatePlatforms } from '../core/application-form.js';
import {
  alertBox,
  badge,
  emptyState,
  errorState,
  h,
  loadingState,
  loadPage,
  queryParameter,
  render,
  renderBreadcrumb,
  required,
} from '../core/dom.js';
import { setValue, submit, value, whileBusy } from '../core/forms.js';
import { FRAMEWORK_LABELS, labelOf, PLATFORM_LABELS, STATUS_LABELS, VISIBILITY_LABELS } from '../core/labels.js';
import { describeError, messageForCode } from '../core/messages.js';
import { AuditLog } from './audit-log.js';
import { bindIconPicker, showIcon } from './icon-picker.js';
import { Overlays } from './overlays.js';
import { appIcon } from './published-apps.js';
import { bindSlugSuggestion, validateNameAndSlug } from './projects-page.js';
import { RoleAssignments } from './role-assignments.js';
import { ShareLinks } from './share-links.js';
import { TAB_CHANGE, Tabs } from './tabs.js';
import { Toast } from './toast.js';

/**
 * Project detail (`project.html?id=…`), concept 7.2: applications as cards, editing, archiving and restoring,
 * and the tabs "Zugriff" and "Audit" for users allowed to see them.
 */
export const ProjectPage = App.register('ProjectPage', {
  async init(): Promise<void> {
    const root = document.querySelector<HTMLElement>('[data-project-page]');

    if (root === null) {
      return;
    }

    const id = queryParameter('id');
    let project: ProjectDto | null = null;

    if (id === null) {
      render(required('[data-page-state]', root), errorState(messageForCode('project_not_found')));
      return;
    }

    const show = (loaded: ProjectDto): void => {
      project = loaded;
      renderProject(root, loaded);
    };

    const loadApplications = async (): Promise<void> => {
      const list = required('[data-application-list]', root);
      render(list, loadingState());

      try {
        render(list, applicationCards(await applications.list(id), project?.capabilities.createApplications ?? false));
      } catch (error) {
        render(
          list,
          errorState(describeError(error), () => void loadApplications()),
        );
      }
    };

    bindEditing(root, () => project, show);
    bindApplicationCreation(id);
    bindLazyTabs(root, id);

    await loadPage(
      root,
      async () => {
        show(await projects.get(id));
        void loadApplications();
      },
      describeError,
    );
  },
});

function renderProject(root: HTMLElement, project: ProjectDto): void {
  const status = labelOf(STATUS_LABELS, project.status);
  const active = project.status === 'active';
  const { capabilities } = project;

  document.title = `${project.name} · App-Distribution`;
  renderBreadcrumb(required('[data-breadcrumb]', root), [
    { label: 'Projekte', href: '/projects.html' },
    { label: project.name },
  ]);
  render(
    required('[data-project-name]', root),
    h(
      'span',
      { class: 'app-heading' },
      project.iconUrl === null ? null : appIcon(project.iconUrl, 'sm'),
      project.name,
      ' ',
      badge(status.text, status.tone),
    ),
  );
  render(
    required('[data-project-meta]', root),
    h('code', {}, project.slug),
    project.description === '' ? null : ` · ${project.description}`,
  );
  render(
    required('[data-project-alert]', root),
    active
      ? null
      : alertBox(
          'info',
          'Archiviert',
          'Das Projekt ist schreibgeschützt und in Download-Ansichten ausgeblendet. Es lässt sich wiederherstellen.',
        ),
  );

  const install = required<HTMLAnchorElement>('[data-action="install-apps"]', root);
  install.href = `/apps.html?project=${encodeURIComponent(project.id)}`;
  install.hidden = !active;
  required('[data-action="edit-project"]', root).hidden = !(capabilities.update && active);
  required('[data-action="archive-project"]', root).hidden = !(capabilities.update && active);
  required('[data-action="restore-project"]', root).hidden = !(capabilities.update && !active);
  required('[data-action="create-application"]', root).hidden = !(capabilities.createApplications && active);
  required('#tab-access', root).hidden = !capabilities.managePermissions;
  required('#tab-shares', root).hidden = !capabilities.manageShares;
  required('#tab-audit', root).hidden = !capabilities.readAudit;
  Tabs.sync(required('.tablist', root));
}

function applicationCards(found: readonly ApplicationDto[], canCreate: boolean): Node {
  if (found.length === 0) {
    return emptyState(
      'apps',
      'Noch keine Anwendungen',
      canCreate
        ? 'Lege die erste Anwendung an; Releases lädt danach GitHub Actions hoch.'
        : 'In diesem Projekt gibt es noch keine Anwendungen.',
    );
  }

  return h(
    'div',
    { class: 'card-grid' },
    found.map((application) =>
      h(
        'a',
        { class: 'card card-link', href: `/application.html?id=${application.id}` },
        h(
          'div',
          { class: 'card-header' },
          h(
            'div',
            { class: 'app-heading' },
            appIcon(application.iconUrl, 'sm'),
            h('h3', { class: 'card-title' }, application.name),
          ),
          application.status === 'archived' ? badge('Archiviert', 'neutral') : null,
        ),
        h(
          'div',
          { class: 'card-body' },
          application.description === '' ? null : h('p', { class: 'text-muted card-text' }, application.description),
          h(
            'div',
            { class: 'badge-row' },
            badge(FRAMEWORK_LABELS[application.framework], 'info'),
            application.platforms.map((platform) => badge(PLATFORM_LABELS[platform], 'neutral')),
            badge(
              VISIBILITY_LABELS[application.visibility],
              application.visibility === 'organization' ? 'primary' : 'neutral',
            ),
            application.flavorsEnabled ? badge(`${application.flavors.length} Flavors`, 'neutral') : null,
          ),
        ),
      ),
    ),
  );
}

function bindEditing(root: HTMLElement, current: () => ProjectDto | null, show: (project: ProjectDto) => void): void {
  const editForm = required<HTMLFormElement>('#project-edit-form');
  const iconField = required('[data-project-icon]', editForm);
  const archiveModal = required('#project-archive');

  required('[data-action="edit-project"]', root).addEventListener('click', (event) => {
    const project = current();

    if (project !== null) {
      setValue(editForm, 'name', project.name);
      setValue(editForm, 'description', project.description);
      showIcon(iconField, project.iconUrl);
      Overlays.open(required('#project-edit'), event.currentTarget as HTMLElement);
    }
  });

  // The icon applies at once, independent of saving name and description.
  const showWithIcon = (project: ProjectDto): void => {
    show(project);
    showIcon(iconField, project.iconUrl);
  };
  bindIconPicker(iconField, {
    upload: async (file) => showWithIcon(await projects.uploadIcon(current()?.id ?? '', file)),
    remove: async () => showWithIcon(await projects.removeIcon(current()?.id ?? '')),
  });

  editForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const project = current();

    if (project === null) {
      return;
    }

    void submit(
      editForm,
      async () => {
        show(
          await projects.update(project, {
            name: value(editForm, 'name'),
            description: value(editForm, 'description'),
          }),
        );
        Overlays.close(required('#project-edit'));
        Toast.show('success', 'Projekt gespeichert');
      },
      () => ({
        name:
          value(editForm, 'name') === '' || value(editForm, 'name').length > NAME_MAX_LENGTH
            ? 'Bitte gib einen Namen an.'
            : null,
      }),
    );
  });

  required('[data-action="archive-project"]', root).addEventListener('click', (event) =>
    Overlays.open(archiveModal, event.currentTarget as HTMLElement),
  );

  const confirmArchive = required<HTMLButtonElement>('[data-confirm-archive]', archiveModal);
  confirmArchive.addEventListener('click', () => {
    const project = current();

    if (project !== null) {
      void whileBusy(confirmArchive, async () => {
        try {
          show(await projects.archive(project));
          Overlays.close(archiveModal);
          Toast.show('success', 'Projekt archiviert');
        } catch (error) {
          Toast.show('danger', 'Archivieren fehlgeschlagen', describeError(error));
        }
      });
    }
  });

  const restore = required<HTMLButtonElement>('[data-action="restore-project"]', root);
  restore.addEventListener('click', () => {
    const project = current();

    if (project !== null) {
      void whileBusy(restore, async () => {
        try {
          show(await projects.restore(project));
          Toast.show('success', 'Projekt wiederhergestellt');
        } catch (error) {
          Toast.show('danger', 'Wiederherstellen fehlgeschlagen', describeError(error));
        }
      });
    }
  });
}

function bindApplicationCreation(projectId: string): void {
  const form = required<HTMLFormElement>('#application-create-form');

  bindSlugSuggestion(form);
  bindPlatformToggles(form);
  // The platform setting preselects the visibility; the choice stays with the person creating the application.
  void settingsService
    .presets()
    .then((presets) => setValue(form, 'visibility', presets.defaultVisibility))
    .catch(() => undefined);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(
      form,
      async () => {
        const created = await applications.create(projectId, {
          name: value(form, 'name'),
          slug: value(form, 'slug'),
          description: value(form, 'description'),
          framework: value(form, 'framework') === 'dotnet_maui' ? 'dotnet_maui' : 'flutter',
          platforms: platformsOf(form),
          visibility: value(form, 'visibility') === 'organization' ? 'organization' : 'private',
          bundleIdentifiers: bundleIdentifiersOf(form),
        });
        Overlays.close(form.closest('.modal-overlay'));
        Toast.show('success', 'Anwendung angelegt', created.name);
        window.location.assign(`/application.html?id=${created.id}`);
      },
      () => ({ ...validateNameAndSlug(form), ...validatePlatforms(form, { identifiers: true }) }),
    );
  });
}

function bindLazyTabs(root: HTMLElement, projectId: string): void {
  const group = required('[data-tab-group]', root);
  const mounted = new Set<string>();

  group.addEventListener(TAB_CHANGE, (event) => {
    const panelId = (event as CustomEvent<string>).detail;

    if (mounted.has(panelId)) {
      return;
    }

    if (panelId === 'panel-access') {
      RoleAssignments.mount(required('#panel-access', root), { type: 'project', projectId });
      mounted.add(panelId);
    } else if (panelId === 'panel-shares') {
      ShareLinks.mount(required('#panel-shares', root), { type: 'project', projectId }, async () => [
        { scope: { type: 'project', projectId }, label: 'Ganzes Projekt, auch künftige Anwendungen' },
        ...(await applications.list(projectId))
          .filter((application) => application.status === 'active')
          .map((application) => ({
            scope: { type: 'application' as const, applicationId: application.id },
            label: `Nur ${application.name}`,
          })),
      ]);
      mounted.add(panelId);
    } else if (panelId === 'panel-audit') {
      AuditLog.mount(required('#panel-audit', root), { type: 'project', projectId });
      mounted.add(panelId);
    }
  });
}
