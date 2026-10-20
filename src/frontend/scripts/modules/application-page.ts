import type {
  ApplicationDto,
  FlavorDto,
  LifecycleStateDto,
  PlatformDto,
  PublicationStatusDto,
  ReleaseSummaryDto,
} from '../../../shared/types/api.js';
import {
  FLAVOR_KEY_MAX_LENGTH,
  FLAVOR_KEY_PATTERN,
  BUNDLE_IDENTIFIER_PATTERNS,
} from '../../../shared/constants/formats.js';
import { applications, projects } from '../../services/project-service.js';
import { releases } from '../../services/release-service.js';
import { uploads } from '../../services/upload-service.js';
import { App } from '../core/app.js';
import { bindPlatformToggles, platformsOf, validatePlatforms } from '../core/application-form.js';
import {
  badge,
  cell,
  dataTable,
  emptyState,
  errorState,
  h,
  icon,
  loadingState,
  loadPage,
  pager,
  queryParameter,
  render,
  renderBreadcrumb,
  required,
} from '../core/dom.js';
import { formatDateTime, releaseLabel, shortSha } from '../core/format.js';
import { setValue, submit, value, whileBusy } from '../core/forms.js';
import {
  FRAMEWORK_LABELS,
  labelOf,
  LIFECYCLE_LABELS,
  PLATFORM_LABELS,
  PUBLICATION_LABELS,
  STATUS_LABELS,
  VISIBILITY_LABELS,
} from '../core/labels.js';
import { describeError, messageForCode } from '../core/messages.js';
import { ArtifactUpload } from './artifact-upload.js';
import { AuditLog } from './audit-log.js';
import { Overlays } from './overlays.js';
import { bindIconPicker, showIcon } from './icon-picker.js';
import { appIcon } from './published-apps.js';
import { CiBindings } from './ci-bindings.js';
import { RoleAssignments } from './role-assignments.js';
import { ShareLinks } from './share-links.js';
import { TAB_CHANGE, Tabs } from './tabs.js';
import { Toast } from './toast.js';

const PAGE_SIZE = 25;

interface PageState {
  application: ApplicationDto | null;
  page: number;
}

/**
 * Application detail (`application.html?id=…`), concept 7.2/7.3: releases with filters, flavors (only while
 * flavor support is on), settings with platforms, identifiers and visibility, plus access and audit tabs.
 */
export const ApplicationPage = App.register('ApplicationPage', {
  async init(): Promise<void> {
    const root = document.querySelector<HTMLElement>('[data-application-page]');

    if (root === null) {
      return;
    }

    const id = queryParameter('id');

    if (id === null) {
      render(required('[data-page-state]', root), errorState(messageForCode('application_not_found')));
      return;
    }

    const state: PageState = { application: null, page: 0 };
    const loadReleases = (): Promise<void> => showReleases(root, state);
    const show = (application: ApplicationDto): void => {
      state.application = application;
      renderApplication(root, application);
    };

    bindReleaseFilter(root, state, loadReleases);
    bindFlavors(
      root,
      () => state.application,
      async () => show(await applications.get(id)),
    );
    bindSettings(root, () => state.application, show);
    bindPresentation(root, () => state.application, show);
    bindBuildUpload(root, () => state.application);
    bindLazyTabs(root, id);

    await loadPage(
      root,
      async () => {
        const application = await applications.get(id);
        show(application);
        await renderBreadcrumbFor(root, application);
        void loadReleases();
      },
      describeError,
    );
  },
});

async function renderBreadcrumbFor(root: HTMLElement, application: ApplicationDto): Promise<void> {
  // Applications can be visible to the whole organisation while the project is not; the breadcrumb then
  // falls back to a generic label.
  const project = await projects.get(application.projectId).catch(() => null);

  renderBreadcrumb(required('[data-breadcrumb]', root), [
    { label: 'Projekte', href: '/projects.html' },
    { label: project?.name ?? 'Projekt', href: `/project.html?id=${application.projectId}` },
    { label: application.name },
  ]);
}

function renderApplication(root: HTMLElement, application: ApplicationDto): void {
  const { capabilities } = application;

  document.title = `${application.name} · App-Distribution`;
  render(
    required('[data-application-name]', root),
    h(
      'span',
      { class: 'app-heading' },
      application.iconUrl === null ? null : appIcon(application.iconUrl, 'sm'),
      application.name,
      application.status === 'archived' ? [' ', badge('Archiviert', 'neutral')] : null,
    ),
  );
  render(
    required('[data-application-meta]', root),
    h(
      'span',
      { class: 'badge-row' },
      badge(FRAMEWORK_LABELS[application.framework], 'info'),
      application.platforms.map((platform) => badge(PLATFORM_LABELS[platform], 'neutral')),
      badge(
        VISIBILITY_LABELS[application.visibility],
        application.visibility === 'organization' ? 'primary' : 'neutral',
      ),
    ),
    application.description === '' ? null : h('span', { class: 'text-muted' }, ` ${application.description}`),
  );

  required('[data-action="upload-build"]', root).hidden = !(
    capabilities.uploadArtifacts && application.status === 'active'
  );
  required('#tab-flavors', root).hidden = !application.flavorsEnabled;
  required('#tab-settings', root).hidden = !capabilities.manage;
  required('#tab-ci', root).hidden = !capabilities.manage;
  required('#tab-access', root).hidden = !capabilities.managePermissions;
  required('#tab-shares', root).hidden = !capabilities.manageShares;
  required('#tab-audit', root).hidden = !capabilities.readAudit;
  Tabs.sync(required('.tablist', root));

  const flavorFilter = required<HTMLSelectElement>('[name="flavorId"]', root);
  const selected = flavorFilter.value;
  flavorFilter.closest<HTMLElement>('.form-group')!.hidden = !application.flavorsEnabled;
  flavorFilter.replaceChildren(
    h('option', { value: '' }, 'Alle Flavors'),
    ...application.flavors.map((flavor) =>
      h('option', { value: flavor.id, selected: flavor.id === selected }, flavor.name),
    ),
  );

  renderFlavors(root, application);
  fillSettings(root, application);
  fillPresentation(root, application);
}

/* -- Releases --------------------------------------------------------------------------------------------- */

/** Manual build upload (concept 5.5): the release follows from the build number in the file. */
function bindBuildUpload(root: HTMLElement, current: () => ApplicationDto | null): void {
  const button = required<HTMLButtonElement>('[data-action="upload-build"]', root);

  button.addEventListener('click', () => {
    const application = current();

    if (application === null) {
      return;
    }

    ArtifactUpload.open(
      {
        title: 'Build hochladen',
        intro: application.flavorsEnabled
          ? 'Der Flavor ergibt sich aus dem Package-Name bzw. der Bundle-ID der Datei, das Release aus ihrer Build-Nummer. Gibt es dazu noch kein Release, entsteht ein Entwurf.'
          : 'Das Release ergibt sich aus der Build-Nummer der Datei. Gibt es dazu noch kein Release, entsteht ein Entwurf.',
        mode: 'build',
        send: (request, onProgress) => uploads.build(application.id, request.file, request.commitSha, onProgress),
        // The release page confirms the upload, a toast here would vanish with the navigation.
        done: (result) =>
          window.location.assign(
            `/release.html?id=${result.releaseId}&uploaded=${result.releaseCreated ? 'release' : 'build'}`,
          ),
      },
      button,
    );
  });
}

function bindReleaseFilter(root: HTMLElement, state: PageState, load: () => Promise<void>): void {
  const form = required<HTMLFormElement>('[data-release-filter]', root);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    state.page = 0;
    void load();
  });
  form.addEventListener('change', () => {
    state.page = 0;
    void load();
  });
}

async function showReleases(root: HTMLElement, state: PageState): Promise<void> {
  const list = required('[data-release-list]', root);
  const form = required<HTMLFormElement>('[data-release-filter]', root);
  const application = state.application;

  if (application === null) {
    return;
  }

  render(list, loadingState());

  try {
    const status = value(form, 'status');
    const lifecycle = value(form, 'lifecycle');
    const search = value(form, 'search');
    const { entries: found, total } = await releases.list(application.id, {
      ...(value(form, 'flavorId') === '' ? {} : { flavorId: value(form, 'flavorId') }),
      ...(status === '' ? {} : { status: [status as PublicationStatusDto] }),
      ...(lifecycle === '' ? {} : { lifecycle: lifecycle.split(',') as LifecycleStateDto[] }),
      ...(search === '' ? {} : { search }),
      limit: PAGE_SIZE,
      offset: state.page * PAGE_SIZE,
    });

    if (found.length === 0 && state.page === 0) {
      render(
        list,
        emptyState(
          'rocket_launch',
          'Keine Releases',
          'Für diese Filter gibt es keine Releases. Neue Releases entstehen beim Hochladen eines Builds, über die Oberfläche oder den GitHub-Actions-Workflow.',
        ),
      );
      return;
    }

    render(
      list,
      releaseTable(found, application),
      pager(state.page, total, PAGE_SIZE, (page) => {
        state.page = page;
        void showReleases(root, state);
      }),
    );
  } catch (error) {
    render(
      list,
      errorState(describeError(error), () => void showReleases(root, state)),
    );
  }
}

function releaseTable(found: readonly ReleaseSummaryDto[], application: ApplicationDto): HTMLElement {
  const flavorName = (id: string): string => application.flavors.find((flavor) => flavor.id === id)?.name ?? '—';

  return dataTable(
    [
      { label: 'Release' },
      { label: 'Flavor', hidden: !application.flavorsEnabled },
      { label: 'Plattformen' },
      { label: 'Status' },
      { label: 'Commit' },
      { label: 'Veröffentlicht' },
    ],
    found.map((release) => {
      const publication = labelOf(PUBLICATION_LABELS, release.publicationStatus);
      const lifecycle = labelOf(LIFECYCLE_LABELS, release.lifecycleState);
      const incomplete = release.missingPlatforms.length > 0 && release.lifecycleState === 'active';

      return h(
        'tr',
        {},
        cell(h('a', { href: `/release.html?id=${release.id}`, class: 'table-link' }, releaseLabel(release))),
        application.flavorsEnabled ? cell(flavorName(release.flavorId)) : null,
        cell(
          h(
            'div',
            { class: 'badge-row' },
            release.requiredPlatforms.map((platform) =>
              badge(PLATFORM_LABELS[platform], release.missingPlatforms.includes(platform) ? 'neutral' : 'success'),
            ),
          ),
        ),
        cell(
          h(
            'div',
            { class: 'badge-row' },
            badge(publication.text, publication.tone),
            release.lifecycleState === 'active' ? null : badge(lifecycle.text, lifecycle.tone),
            incomplete ? badge('Unvollständig', 'warning') : null,
          ),
        ),
        cell(h('code', { title: release.gitCommitSha }, shortSha(release.gitCommitSha))),
        cell(formatDateTime(release.publishedAt)),
      );
    }),
  );
}

/* -- Flavors ---------------------------------------------------------------------------------------------- */

let editedFlavor: FlavorDto | null = null;

function renderFlavors(root: HTMLElement, application: ApplicationDto): void {
  const list = required('[data-flavor-list]', root);
  required('[data-action="create-flavor"]', root).hidden = !application.capabilities.manageFlavors;

  render(
    list,
    dataTable(
      [
        { label: 'Name' },
        { label: 'Schlüssel' },
        { label: 'Android' },
        { label: 'iOS' },
        { label: 'Status' },
        { label: 'Aktionen', numeric: true, hidden: !application.capabilities.manageFlavors },
      ],
      application.flavors.map((flavor, index) => {
        const status = labelOf(STATUS_LABELS, flavor.status);
        // The order is the one on download pages and share links (concept 7.3 "Darstellung").
        const move = (direction: -1 | 1, iconName: string, label: string): HTMLButtonElement =>
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-ghost btn-sm',
              'data-move-flavor': `${flavor.id}:${direction}`,
              'aria-label': `${flavor.name} ${label}`,
              title: label,
              disabled: application.flavors[index + direction] === undefined,
            },
            icon(iconName),
          );
        const edit = h(
          'span',
          { class: 'flavor-order-actions' },
          move(-1, 'arrow_upward', 'nach oben'),
          move(1, 'arrow_downward', 'nach unten'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-edit-flavor': flavor.id }, 'Bearbeiten'),
        );

        return h(
          'tr',
          {},
          cell([flavor.name, flavor.isDefault ? [' ', badge('Standard', 'neutral')] : null].flat()),
          cell(h('code', {}, flavor.key)),
          cell(identifierCell(flavor, 'android')),
          cell(identifierCell(flavor, 'ios')),
          cell(badge(status.text, status.tone)),
          application.capabilities.manageFlavors ? cell(edit, { numeric: true }) : null,
        );
      }),
    ),
  );
}

function identifierCell(flavor: FlavorDto, platform: PlatformDto): Node | string {
  const identifier = flavor.bundleIdentifiers[platform];
  return identifier === undefined ? '—' : h('code', {}, identifier);
}

function bindFlavors(root: HTMLElement, current: () => ApplicationDto | null, reload: () => Promise<void>): void {
  const overlay = required('#flavor-modal');
  const form = required<HTMLFormElement>('#flavor-form');

  const open = (flavor: FlavorDto | null, trigger: HTMLElement): void => {
    editedFlavor = flavor;
    form.reset();
    required('#flavor-modal-title').textContent = flavor === null ? 'Flavor anlegen' : 'Flavor bearbeiten';
    setValue(form, 'name', flavor?.name ?? '');
    setValue(form, 'key', flavor?.key ?? '');
    setValue(form, 'bundleIdentifier.android', flavor?.bundleIdentifiers.android ?? '');
    setValue(form, 'bundleIdentifier.ios', flavor?.bundleIdentifiers.ios ?? '');
    setValue(form, 'status', flavor?.status ?? 'active');

    // Key and identifiers are what installed apps and CI uploads rely on; they lock with the first release.
    const locked = flavor?.hasReleases ?? false;
    for (const name of ['key', 'bundleIdentifier.android', 'bundleIdentifier.ios']) {
      (form.elements.namedItem(name) as HTMLInputElement).disabled = locked;
    }
    required('[data-flavor-locked]', form).hidden = !locked;
    required('[data-flavor-status]', form).hidden = flavor === null;
    Overlays.open(overlay, trigger);
  };

  required('[data-action="create-flavor"]', root).addEventListener('click', (event) =>
    open(null, event.currentTarget as HTMLElement),
  );
  required('[data-flavor-list]', root).addEventListener('click', (event) => {
    const mover =
      event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-move-flavor]') : null;
    const application = current();

    if (mover !== null && application !== null) {
      const [flavorId, step] = (mover.dataset['moveFlavor'] ?? '').split(':');
      const order = application.flavors.map((flavor) => flavor.id);
      const from = order.indexOf(flavorId ?? '');
      const to = from + Number(step);

      if (from >= 0 && to >= 0 && to < order.length) {
        [order[from], order[to]] = [order[to]!, order[from]!];
        void whileBusy(mover, async () => {
          try {
            await applications.reorderFlavors(application.id, order);
            await reload();
          } catch (error) {
            Toast.show('danger', 'Reihenfolge nicht gespeichert', describeError(error));
          }
        });
      }

      return;
    }

    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-edit-flavor]') : null;
    const flavor = current()?.flavors.find((entry) => entry.id === button?.dataset['editFlavor']);

    if (button !== null && flavor !== undefined) {
      open(flavor, button);
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const application = current();

    if (application === null) {
      return;
    }

    void submit(
      form,
      async () => {
        const identifiers = {
          android: value(form, 'bundleIdentifier.android'),
          ios: value(form, 'bundleIdentifier.ios'),
        };

        if (editedFlavor === null) {
          await applications.createFlavor(application.id, {
            key: value(form, 'key'),
            name: value(form, 'name'),
            bundleIdentifiers: Object.fromEntries(
              Object.entries(identifiers).filter(([, identifier]) => identifier !== ''),
            ),
          });
        } else {
          await applications.updateFlavor(editedFlavor, {
            name: value(form, 'name'),
            status: value(form, 'status') as FlavorDto['status'],
            ...(editedFlavor.hasReleases
              ? {}
              : {
                  key: value(form, 'key'),
                  bundleIdentifiers: { android: identifiers.android || null, ios: identifiers.ios || null },
                }),
          });
        }

        Overlays.close(overlay);
        Toast.show('success', editedFlavor === null ? 'Flavor angelegt' : 'Flavor gespeichert');
        await reload();
      },
      () => validateFlavor(form, editedFlavor?.hasReleases ?? false),
    );
  });
}

export function validateFlavor(form: HTMLFormElement, locked: boolean): Record<string, string | null> {
  const key = value(form, 'key');
  const result: Record<string, string | null> = {
    name: value(form, 'name') === '' ? 'Bitte gib einen Namen an.' : null,
    key:
      locked || (FLAVOR_KEY_PATTERN.test(key) && key.length <= FLAVOR_KEY_MAX_LENGTH)
        ? null
        : 'Wie im Flutter-Projekt (--flavor): Kleinbuchstabe am Anfang, danach Buchstaben und Ziffern.',
  };

  for (const platform of ['android', 'ios'] as const) {
    const identifier = value(form, `bundleIdentifier.${platform}`);
    result[`bundleIdentifier.${platform}`] =
      locked || identifier === '' || BUNDLE_IDENTIFIER_PATTERNS[platform].test(identifier)
        ? null
        : 'Ungültiges Format, z. B. de.firma.app.';
  }

  return result;
}

/* -- Settings --------------------------------------------------------------------------------------------- */

function defaultFlavor(application: ApplicationDto): FlavorDto | undefined {
  return application.flavors.find((flavor) => flavor.isDefault);
}

function fillSettings(root: HTMLElement, application: ApplicationDto): void {
  const form = required<HTMLFormElement>('#application-settings-form');
  const identifiers = required<HTMLFormElement>('#identifier-form');
  const flavor = defaultFlavor(application);

  setValue(form, 'name', application.name);
  setValue(form, 'description', application.description);
  setValue(form, 'framework', application.framework);
  setValue(form, 'visibility', application.visibility);

  for (const checkbox of form.querySelectorAll<HTMLInputElement>('input[name="platforms"]')) {
    checkbox.checked = application.platforms.includes(checkbox.value as PlatformDto);
  }

  // Without flavor support the identifiers live on the hidden default flavor (concept 2.3).
  identifiers.hidden = application.flavorsEnabled;
  setValue(identifiers, 'bundleIdentifier.android', flavor?.bundleIdentifiers.android ?? '');
  setValue(identifiers, 'bundleIdentifier.ios', flavor?.bundleIdentifiers.ios ?? '');

  for (const input of identifiers.querySelectorAll<HTMLInputElement>('input')) {
    input.disabled = flavor?.hasReleases ?? false;
  }

  required('[data-identifiers-locked]', identifiers).hidden = !(flavor?.hasReleases ?? false);
  required('.form-actions', identifiers).hidden = flavor?.hasReleases ?? false;

  for (const group of identifiers.querySelectorAll<HTMLElement>('[data-identifier-for]')) {
    group.hidden = !application.platforms.includes(group.dataset['identifierFor'] as PlatformDto);
  }

  required<HTMLInputElement>('#flavors-enabled', root).checked = application.flavorsEnabled;
}

function bindSettings(
  root: HTMLElement,
  current: () => ApplicationDto | null,
  show: (application: ApplicationDto) => void,
): void {
  const form = required<HTMLFormElement>('#application-settings-form');
  const identifiers = required<HTMLFormElement>('#identifier-form');
  const toggle = required<HTMLInputElement>('#flavors-enabled', root);
  const enableModal = required('#flavors-enable');
  const enableForm = required<HTMLFormElement>('#flavors-enable-form');

  bindPlatformToggles(form);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const application = current();

    if (application !== null) {
      void submit(
        form,
        async () => {
          show(
            await applications.update(application, {
              name: value(form, 'name'),
              description: value(form, 'description'),
              framework: value(form, 'framework') === 'dotnet_maui' ? 'dotnet_maui' : 'flutter',
              platforms: platformsOf(form),
              visibility: value(form, 'visibility') === 'organization' ? 'organization' : 'private',
            }),
          );
          Toast.show('success', 'Einstellungen gespeichert');
        },
        () => ({
          name: value(form, 'name') === '' ? 'Bitte gib einen Namen an.' : null,
          ...validatePlatforms(form, { identifiers: false }),
        }),
      );
    }
  });

  identifiers.addEventListener('submit', (event) => {
    event.preventDefault();
    const application = current();
    const flavor = application === null ? undefined : defaultFlavor(application);

    if (application !== null && flavor !== undefined) {
      void submit(
        identifiers,
        async () => {
          await applications.updateFlavor(flavor, {
            bundleIdentifiers: {
              android: value(identifiers, 'bundleIdentifier.android') || null,
              ios: value(identifiers, 'bundleIdentifier.ios') || null,
            },
          });
          show(await applications.get(application.id));
          Toast.show('success', 'Kennungen gespeichert');
        },
        () =>
          Object.fromEntries(
            (['android', 'ios'] as const).map((platform) => {
              const identifier = value(identifiers, `bundleIdentifier.${platform}`);
              return [
                `bundleIdentifier.${platform}`,
                identifier === '' || BUNDLE_IDENTIFIER_PATTERNS[platform].test(identifier)
                  ? null
                  : 'Ungültiges Format, z. B. de.firma.app.',
              ];
            }),
          ),
      );
    }
  });

  toggle.addEventListener('change', () => {
    const application = current();

    if (application === null) {
      return;
    }

    if (toggle.checked) {
      // Enabling makes the default flavor visible; it needs a proper name first (concept 7.3).
      toggle.checked = false;
      enableForm.reset();
      setValue(enableForm, 'name', 'Production');
      Overlays.open(enableModal, toggle);
      return;
    }

    applications
      .update(application, { flavorsEnabled: false })
      .then((updated) => {
        show(updated);
        Toast.show('success', 'Flavors ausgeblendet');
      })
      .catch((error: unknown) => {
        toggle.checked = true;
        Toast.show('danger', 'Flavors lassen sich nicht abschalten', describeError(error));
      });
  });

  enableForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const application = current();
    const flavor = application === null ? undefined : defaultFlavor(application);

    if (application !== null && flavor !== undefined) {
      void submit(
        enableForm,
        async () => {
          await applications.update(application, { flavorsEnabled: true });
          await applications.updateFlavor(flavor, { name: value(enableForm, 'name') });
          show(await applications.get(application.id));
          Overlays.close(enableModal);
          Toast.show('success', 'Flavors aktiviert');
        },
        () => ({ name: value(enableForm, 'name') === '' ? 'Bitte benenne den bestehenden Flavor.' : null }),
      );
    }
  });
}

/* -- Presentation ----------------------------------------------------------------------------------------- */

function fillPresentation(root: HTMLElement, application: ApplicationDto): void {
  const card = required('[data-presentation]', root);

  showIcon(card, application.iconUrl);
  setValue(required<HTMLFormElement>('#install-notes-form', card), 'installNotes', application.installNotes);
}

/** Icon and installation notes as customers and employees see them on the download pages (concept 7.3). */
function bindPresentation(
  root: HTMLElement,
  current: () => ApplicationDto | null,
  show: (application: ApplicationDto) => void,
): void {
  const card = required('[data-presentation]', root);
  const notes = required<HTMLFormElement>('#install-notes-form', card);
  const applicationId = (): string => current()?.id ?? '';

  bindIconPicker(card, {
    upload: async (file) => show(await applications.uploadIcon(applicationId(), file)),
    remove: async () => show(await applications.removeIcon(applicationId())),
  });

  notes.addEventListener('submit', (event) => {
    event.preventDefault();
    const application = current();

    if (application !== null) {
      void submit(notes, async () => {
        show(await applications.update(application, { installNotes: value(notes, 'installNotes') }));
        Toast.show('success', 'Installationshinweise gespeichert');
      });
    }
  });
}

function bindLazyTabs(root: HTMLElement, applicationId: string): void {
  const group = required('[data-tab-group]', root);
  const mounted = new Set<string>();

  group.addEventListener(TAB_CHANGE, (event) => {
    const panelId = (event as CustomEvent<string>).detail;

    if (mounted.has(panelId)) {
      return;
    }

    if (panelId === 'panel-access') {
      RoleAssignments.mount(required('#panel-access', root), { type: 'application', applicationId });
      mounted.add(panelId);
    } else if (panelId === 'panel-shares') {
      const scope = { type: 'application' as const, applicationId };
      ShareLinks.mount(required('#panel-shares', root), scope, () =>
        Promise.resolve([{ scope, label: 'Diese Anwendung' }]),
      );
      mounted.add(panelId);
    } else if (panelId === 'panel-ci') {
      CiBindings.mount(required('#panel-ci', root), applicationId);
      mounted.add(panelId);
    } else if (panelId === 'panel-audit') {
      AuditLog.mount(required('#panel-audit', root), { type: 'application', applicationId });
      mounted.add(panelId);
    }
  });
}
