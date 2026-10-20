import type { ApplicationDto, ArtifactDto, ReleaseDetailDto } from '../../../shared/types/api.js';
import { REASON_MAX_LENGTH } from '../../../shared/constants/formats.js';
import { applications, projects } from '../../services/project-service.js';
import { releases } from '../../services/release-service.js';
import { uploads } from '../../services/upload-service.js';
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
  loadPage,
  queryParameter,
  render,
  renderBreadcrumb,
  required,
} from '../core/dom.js';
import { isAppleMobileDevice } from '../core/device.js';
import { formatBytes, formatDateTime, releaseLabel, shortSha } from '../core/format.js';
import { setValue, submit, value, whileBusy } from '../core/forms.js';
import {
  ARTIFACT_KIND_LABELS,
  labelOf,
  LIFECYCLE_LABELS,
  PLATFORM_LABELS,
  PUBLICATION_LABELS,
} from '../core/labels.js';
import { describeError, messageForCode } from '../core/messages.js';
import { ArtifactUpload } from './artifact-upload.js';
import { Overlays } from './overlays.js';
import { Tabs } from './tabs.js';
import { Toast } from './toast.js';

interface PageState {
  release: ReleaseDetailDto | null;
  application: ApplicationDto | null;
}

/**
 * Release detail (`release.html?id=…`), concept 7.3/7.4: artifacts with download and iOS installation,
 * publishing and withdrawing, the deletion dialog with typed confirmation, restoring from quarantine and
 * releasing the build number of a purged release.
 */
export const ReleasePage = App.register('ReleasePage', {
  async init(): Promise<void> {
    const root = document.querySelector<HTMLElement>('[data-release-page]');

    if (root === null) {
      return;
    }

    const id = queryParameter('id');

    if (id === null) {
      render(required('[data-page-state]', root), errorState(messageForCode('release_not_found')));
      return;
    }

    const state: PageState = { release: null, application: null };
    const show = (release: ReleaseDetailDto): void => {
      state.release = release;
      renderRelease(root, release, state.application);
    };

    bindActions(root, state, show);
    bindTexts(root, state, show);
    bindDeletion(root, state, show);
    bindBuildNumberRelease(root, state, show);
    bindInstallation(root);
    bindArtifactRemoval(root, state, show);
    bindUpload(root, state, show);

    await loadPage(
      root,
      async () => {
        const release = await releases.get(id);
        state.application = await applications.get(release.applicationId);
        show(release);
        await renderBreadcrumbFor(root, release, state.application);
        confirmUpload();
      },
      describeError,
    );
  },
});

/** After a build upload on the application page, which sends the user here with `uploaded=release|build`. */
function confirmUpload(): void {
  const uploaded = queryParameter('uploaded');

  if (uploaded === null) {
    return;
  }

  Toast.show(
    'success',
    uploaded === 'release' ? 'Release angelegt' : 'Build hinzugefügt',
    uploaded === 'release'
      ? 'Der Build hat ein neues Release als Entwurf gestartet.'
      : 'Der Build wurde dem bestehenden Release mit seiner Build-Nummer zugeordnet.',
  );

  const url = new URL(window.location.href);
  url.searchParams.delete('uploaded');
  window.history.replaceState(null, '', url);
}

function bindUpload(root: HTMLElement, state: PageState, show: (release: ReleaseDetailDto) => void): void {
  const button = required<HTMLButtonElement>('[data-action="upload-file"]', root);

  button.addEventListener('click', () => {
    const release = state.release;

    if (release === null) {
      return;
    }

    ArtifactUpload.open(
      {
        title: 'Datei hochladen',
        intro: `Die Datei gehört zu ${releaseLabel(release)}. Builds müssen dieselbe Version und Build-Nummer tragen.`,
        mode: 'release',
        send: (request, onProgress) => uploads.releaseFile(release.id, request.kind, request.file, onProgress),
        done: async () => {
          show(await releases.get(release.id));
          Toast.show('success', 'Datei hochgeladen');
        },
      },
      button,
    );
  });
}

async function renderBreadcrumbFor(
  root: HTMLElement,
  release: ReleaseDetailDto,
  application: ApplicationDto,
): Promise<void> {
  const project = await projects.get(application.projectId).catch(() => null);

  renderBreadcrumb(required('[data-breadcrumb]', root), [
    { label: 'Projekte', href: '/projects.html' },
    { label: project?.name ?? 'Projekt', href: `/project.html?id=${application.projectId}` },
    { label: application.name, href: `/application.html?id=${application.id}` },
    { label: releaseLabel(release) },
  ]);
}

function renderRelease(root: HTMLElement, release: ReleaseDetailDto, application: ApplicationDto | null): void {
  const { capabilities } = release;
  const active = release.lifecycleState === 'active';
  const publication = labelOf(PUBLICATION_LABELS, release.publicationStatus);
  const lifecycle = labelOf(LIFECYCLE_LABELS, release.lifecycleState);
  const flavor = application?.flavors.find((entry) => entry.id === release.flavorId);

  document.title = `${application?.name ?? 'Release'} ${releaseLabel(release)} · App-Distribution`;
  render(
    required('[data-release-title]', root),
    `${release.version} `,
    h('span', { class: 'text-muted' }, `Build ${release.buildNumber}`),
  );
  render(
    required('[data-release-meta]', root),
    h(
      'span',
      { class: 'badge-row' },
      badge(publication.text, publication.tone),
      active ? null : badge(lifecycle.text, lifecycle.tone),
      release.missingPlatforms.length > 0 && active ? badge('Unvollständig', 'warning') : null,
      application?.flavorsEnabled === true && flavor !== undefined ? badge(`Flavor ${flavor.name}`, 'neutral') : null,
    ),
  );

  required('[data-action="publish"]', root).hidden = !(
    capabilities.publishReleases &&
    active &&
    release.publicationStatus !== 'published'
  );
  required('[data-action="withdraw"]', root).hidden = !(
    capabilities.publishReleases &&
    active &&
    release.publicationStatus === 'published'
  );
  required('[data-action="delete"]', root).hidden = !(
    capabilities.deleteReleases &&
    active &&
    release.deletionConfirmation !== null
  );
  required('[data-action="restore"]', root).hidden = !(
    capabilities.restoreReleases && release.lifecycleState === 'quarantined'
  );
  required('[data-action="release-build-number"]', root).hidden = !(
    capabilities.releaseBuildNumbers &&
    release.lifecycleState === 'purged' &&
    release.buildNumberReserved
  );

  const more = required('[data-more-actions]', root);
  more.hidden = Array.from(more.querySelectorAll<HTMLElement>('.dropdown-item')).every((item) => item.hidden);

  required('[data-upload-toolbar]', root).hidden = !(capabilities.uploadArtifacts && active);
  render(required('[data-release-alert]', root), stateAlert(release));
  render(required('[data-artifact-list]', root), artifactTables(release));
  render(
    required('[data-release-details]', root),
    details(release, flavor?.name ?? null, application?.flavorsEnabled ?? false),
  );
  fillTexts(root, release);
  Tabs.sync(required('.tablist', root));
}

function stateAlert(release: ReleaseDetailDto): Node | null {
  const deletion = release.deletion;

  if (deletion?.state === 'failed') {
    return alertBox(
      'danger',
      'Löschung fehlgeschlagen',
      `Fehler: ${deletion.lastErrorCode ?? 'unbekannt'} nach ${deletion.attempts} Versuchen. ${
        deletion.requiresManualReview ? 'Ein Sicherheitsabbruch erfordert eine manuelle Prüfung des Speichers. ' : ''
      }Das Release gilt nicht als gelöscht. `,
      h('a', { href: '/storage.html' }, 'Zu den Löschaufträgen'),
    );
  }

  switch (release.lifecycleState) {
    case 'pending_deletion':
      return alertBox(
        'warning',
        'Löschung ausstehend',
        `Beantragt am ${formatDateTime(deletion?.requestedAt ?? null)}. Das Release ist nicht mehr sichtbar; die Dateien werden in die Quarantäne verschoben.`,
      );
    case 'quarantined':
      return alertBox(
        'warning',
        `In Quarantäne bis ${formatDateTime(deletion?.purgeAfter ?? null)}`,
        'Bis dahin lässt sich das Release wiederherstellen; es kommt dann als „zurückgezogen“ zurück. Danach werden alle Dateien endgültig gelöscht.',
      );
    case 'purged':
      return alertBox(
        'info',
        `Endgültig gelöscht am ${formatDateTime(release.purgedAt)}`,
        release.buildNumberReserved
          ? 'Die Metadaten bleiben erhalten. Die Build-Nummer ist weiterhin gesperrt.'
          : 'Die Metadaten bleiben erhalten. Die Build-Nummer wurde zur Wiederverwendung freigegeben.',
      );
    case 'active':
      return release.missingPlatforms.length > 0
        ? alertBox(
            'warning',
            'Unvollständig',
            `Es fehlt ein installierbares Artefakt für: ${release.missingPlatforms.map((platform) => PLATFORM_LABELS[platform]).join(', ')}. Veröffentlichen ist erst danach möglich.`,
          )
        : null;
  }
}

/* -- Artifacts -------------------------------------------------------------------------------------------- */

function artifactTables(release: ReleaseDetailDto): Node {
  if (release.artifacts.length === 0) {
    return emptyState(
      'inventory_2',
      'Keine Artefakte',
      'Die Artefakte kommen aus dem GitHub-Actions-Workflow oder werden hier hochgeladen.',
    );
  }

  const order = { android: 0, ios: 1 } as const;
  const sorted = [...release.artifacts].sort(
    (a, b) => (a.platform === null ? 2 : order[a.platform]) - (b.platform === null ? 2 : order[b.platform]),
  );
  const available = release.lifecycleState === 'active' && release.capabilities.downloadArtifacts;

  return dataTable(
    [
      { label: 'Plattform' },
      { label: 'Art' },
      { label: 'Datei' },
      { label: 'Größe', numeric: true },
      { label: 'SHA-256' },
      { label: 'Hochgeladen' },
      { label: 'Aktionen', numeric: true },
    ],
    sorted.map((artifact) => artifactRow(artifact, available, release)),
  );
}

function artifactRow(artifact: ArtifactDto, available: boolean, release: ReleaseDetailDto): HTMLTableRowElement {
  const stored = available && artifact.storageState === 'stored' && artifact.removal === null;
  const kind = [
    ARTIFACT_KIND_LABELS[artifact.kind],
    artifact.abi,
    artifact.buildMode === 'release' ? null : artifact.buildMode,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return h(
    'tr',
    {},
    cell(artifact.platform === null ? '—' : PLATFORM_LABELS[artifact.platform]),
    cell(kind),
    cell(artifact.originalFileName),
    cell(formatBytes(artifact.sizeBytes), { numeric: true }),
    cell(
      h(
        'span',
        { class: 'hash' },
        h('code', { title: artifact.sha256 }, shortSha(artifact.sha256)),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-ghost btn-sm',
            'data-copy': artifact.sha256,
            'aria-label': 'SHA-256 kopieren',
            title: 'SHA-256 kopieren',
          },
          icon('content_copy'),
        ),
      ),
    ),
    cell(formatDateTime(artifact.uploadedAt)),
    cell(
      h(
        'div',
        { class: 'table-actions' },
        stored && artifact.kind === 'ipa' && artifact.installable
          ? h(
              'button',
              { type: 'button', class: 'btn btn-secondary btn-sm', 'data-install': artifact.id },
              icon('install_mobile'),
              'Installieren',
            )
          : null,
        stored
          ? h(
              'a',
              { class: 'btn btn-outline btn-sm', href: releases.downloadUrl(artifact.id), download: '' },
              icon('download'),
              'Download',
            )
          : artifactState(artifact),
        removalAction(artifact, release),
      ),
      { numeric: true },
    ),
  );
}

/**
 * iOS installation (concept 11): a short-lived link from the API, opened as `itms-services://` URL. iOS only
 * follows it on the device itself, so other devices get a hint instead.
 */
function bindInstallation(root: HTMLElement): void {
  required('[data-artifact-list]', root).addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-install]') : null;

    if (button === null) {
      return;
    }

    if (!isAppleMobileDevice()) {
      required('[data-install-page-url]').textContent = window.location.href;
      required<HTMLButtonElement>('[data-install-copy]').setAttribute('data-copy', window.location.href);
      Overlays.open(required('#install-hint'), button);
      return;
    }

    void whileBusy(button, async () => {
      try {
        const link = await releases.installLink(button.dataset['install'] ?? '');
        window.location.assign(link.installUrl);
      } catch (error) {
        Toast.show('danger', 'Installation nicht möglich', describeError(error));
      }
    });
  });
}

/* -- Details and texts ------------------------------------------------------------------------------------ */

function details(release: ReleaseDetailDto, flavorName: string | null, flavorsEnabled: boolean): Node {
  const row = (term: string, description: Node | string | null): Node[] =>
    description === null ? [] : [h('dt', {}, term), h('dd', {}, description)];

  return h(
    'dl',
    { class: 'meta-list' },
    row('Version', release.version),
    row('Build-Nummer', String(release.buildNumber)),
    flavorsEnabled ? row('Flavor', flavorName ?? release.flavorKey) : [],
    row('Plattformen', release.requiredPlatforms.map((platform) => PLATFORM_LABELS[platform]).join(', ')),
    row(
      'Commit',
      h(
        'span',
        { class: 'hash' },
        h('code', {}, release.gitCommitSha),
        h(
          'button',
          { type: 'button', class: 'btn btn-ghost btn-sm', 'data-copy': release.gitCommitSha },
          icon('content_copy'),
          h('span', { 'data-copy-label': true }, 'Kopieren'),
        ),
      ),
    ),
    row('Repository', release.gitRepository),
    row('Branch', release.gitBranch),
    row('Tag', release.gitTag),
    row(
      'Workflow-Lauf',
      release.workflowRun === null
        ? null
        : h(
            'a',
            { href: release.workflowRun.url, target: '_blank', rel: 'noopener noreferrer' },
            `#${release.workflowRun.id} (Versuch ${release.workflowRun.attempt})`,
          ),
    ),
    row('Veröffentlicht', formatDateTime(release.publishedAt)),
    row('Build-Nummer gesperrt', release.buildNumberReserved ? 'Ja' : 'Nein, zur Wiederverwendung freigegeben'),
  );
}

function fillTexts(root: HTMLElement, release: ReleaseDetailDto): void {
  const form = required<HTMLFormElement>('#release-texts-form', root);
  const editable = release.capabilities.updateReleases && release.lifecycleState === 'active';

  setValue(form, 'releaseNotes', release.releaseNotes);
  setValue(form, 'changelog', release.changelog);

  for (const field of form.querySelectorAll<HTMLTextAreaElement>('textarea')) {
    field.readOnly = !editable;
  }

  required('.form-actions', form).hidden = !editable;
}

function bindTexts(root: HTMLElement, state: PageState, show: (release: ReleaseDetailDto) => void): void {
  const form = required<HTMLFormElement>('#release-texts-form', root);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const release = state.release;

    if (release !== null) {
      void submit(form, async () => {
        show(
          await releases.updateTexts(release, {
            releaseNotes: value(form, 'releaseNotes'),
            changelog: value(form, 'changelog'),
          }),
        );
        Toast.show('success', 'Texte gespeichert');
      });
    }
  });
}

/* -- Lifecycle actions ------------------------------------------------------------------------------------ */

function bindActions(root: HTMLElement, state: PageState, show: (release: ReleaseDetailDto) => void): void {
  const run = (
    selector: string,
    action: (release: ReleaseDetailDto) => Promise<ReleaseDetailDto>,
    success: string,
  ): void => {
    const button = required<HTMLButtonElement>(selector, root);

    button.addEventListener('click', () => {
      const release = state.release;

      if (release !== null) {
        void whileBusy(button, async () => {
          try {
            show(await action(release));
            Toast.show('success', success);
          } catch (error) {
            Toast.show('danger', 'Aktion fehlgeschlagen', describeError(error));
          }
        });
      }
    });
  };

  run('[data-action="publish"]', releases.publish, 'Release veröffentlicht');
  run('[data-action="withdraw"]', releases.withdraw, 'Release zurückgezogen');
  run('[data-action="restore"]', releases.restore, 'Release wiederhergestellt');
}

function bindDeletion(root: HTMLElement, state: PageState, show: (release: ReleaseDetailDto) => void): void {
  const overlay = required('#release-delete');
  const form = required<HTMLFormElement>('#release-delete-form');
  const confirmButton = required<HTMLButtonElement>('button[type="submit"]', form);
  const withdraw = required<HTMLButtonElement>('[data-delete-withdraw]', form);

  const sync = (): void => {
    confirmButton.disabled = !deletionConfirmed(state.release, value(form, 'reason'), value(form, 'confirmation'));
  };

  required('[data-action="delete"]', root).addEventListener('click', (event) => {
    const release = state.release;

    if (release === null || release.deletionConfirmation === null) {
      return;
    }

    form.reset();
    render(required('[data-delete-summary]', form), deletionSummary(release, state.application));
    required('[data-delete-phrase]', form).textContent = release.deletionConfirmation;
    required('[data-delete-withdraw-hint]', form).hidden = !(
      release.publicationStatus === 'published' && release.capabilities.publishReleases
    );
    sync();
    Overlays.open(overlay, event.currentTarget as HTMLElement);
  });

  form.addEventListener('input', sync);

  withdraw.addEventListener('click', () => {
    const release = state.release;

    if (release !== null) {
      void whileBusy(withdraw, async () => {
        try {
          show(await releases.withdraw(release));
          Overlays.close(overlay);
          Toast.show('success', 'Release zurückgezogen', 'Es ist nicht mehr sichtbar, bleibt aber erhalten.');
        } catch (error) {
          Toast.show('danger', 'Zurückziehen fehlgeschlagen', describeError(error));
        }
      });
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const release = state.release;

    if (release !== null) {
      void submit(form, async () => {
        await releases.delete(release, value(form, 'confirmation'), value(form, 'reason'));
        Overlays.close(overlay);
        Toast.show(
          'success',
          'Löschung beantragt',
          'Das Release ist nicht mehr sichtbar und wird in die Quarantäne verschoben.',
        );
        show(await releases.get(release.id));
      });
    }
  });
}

/** The delete button stays disabled until a reason is given and the confirmation text matches exactly. */
export function deletionConfirmed(release: ReleaseDetailDto | null, reason: string, confirmation: string): boolean {
  return (
    release !== null &&
    release.deletionConfirmation !== null &&
    reason !== '' &&
    reason.length <= REASON_MAX_LENGTH &&
    confirmation === release.deletionConfirmation
  );
}

function deletionSummary(release: ReleaseDetailDto, application: ApplicationDto | null): Node[] {
  const kinds = [...new Set(release.artifacts.map((artifact) => ARTIFACT_KIND_LABELS[artifact.kind]))].join(', ');
  const size = release.artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0);

  return [
    h(
      'p',
      { class: 'delete-subject' },
      `${application?.name ?? 'Release'} · ${releaseLabel(release)} · ${release.requiredPlatforms.map((platform) => PLATFORM_LABELS[platform]).join(' + ')}`,
    ),
    h(
      'ul',
      { class: 'delete-impact' },
      h('li', {}, `${release.artifacts.length} Artefakte${kinds === '' ? '' : ` (${kinds})`} · ${formatBytes(size)}`),
      h(
        'li',
        {},
        release.publicationStatus === 'published'
          ? 'Aktuell veröffentlicht'
          : `Status: ${labelOf(PUBLICATION_LABELS, release.publicationStatus).text}`,
      ),
    ),
  ];
}

function bindBuildNumberRelease(root: HTMLElement, state: PageState, show: (release: ReleaseDetailDto) => void): void {
  const overlay = required('#build-number-release');
  const form = required<HTMLFormElement>('#build-number-release-form');

  required('[data-action="release-build-number"]', root).addEventListener('click', (event) => {
    form.reset();
    required('[data-build-number]', form).textContent = String(state.release?.buildNumber ?? '');
    Overlays.open(overlay, event.currentTarget as HTMLElement);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const release = state.release;

    if (release !== null) {
      void submit(
        form,
        async () => {
          show(await releases.releaseBuildNumber(release, value(form, 'reason')));
          Overlays.close(overlay);
          Toast.show('success', 'Build-Nummer freigegeben');
        },
        () => ({ reason: value(form, 'reason') === '' ? 'Bitte begründe die Freigabe.' : null }),
      );
    }
  });
}

const PLATFORM_BUILDS: ReadonlySet<ArtifactDto['kind']> = new Set(['apk', 'aab', 'ipa']);

/** Why an artifact cannot be downloaded: removed (with its quarantine) or not stored. */
function artifactState(artifact: ArtifactDto): HTMLElement {
  const removal = artifact.removal;

  if (removal !== null) {
    return removal.state === 'quarantined' && removal.purgeAfter !== null
      ? badge(`In Quarantäne bis ${formatDateTime(removal.purgeAfter)}`, 'warning')
      : badge('Entfernung beantragt', 'warning');
  }

  return badge(
    artifact.storageState === 'purged'
      ? 'Entfernt'
      : artifact.storageState === 'stored'
        ? 'Nicht verfügbar'
        : 'In Quarantäne',
    'neutral',
  );
}

/**
 * "Entfernen" for stored artifacts, "Wiederherstellen" for removed ones in quarantine. Platform builds of a
 * published release stay locked, as the API demands: withdraw the release first.
 */
function removalAction(artifact: ArtifactDto, release: ReleaseDetailDto): HTMLElement | null {
  const active = release.lifecycleState === 'active';

  if (artifact.removal?.state === 'quarantined' && active && release.capabilities.restoreReleases) {
    return h(
      'button',
      { type: 'button', class: 'btn btn-outline btn-sm', 'data-restore-artifact': artifact.id },
      'Wiederherstellen',
    );
  }

  const locked = release.publicationStatus === 'published' && PLATFORM_BUILDS.has(artifact.kind);

  if (
    artifact.removal !== null ||
    artifact.storageState !== 'stored' ||
    !active ||
    !release.capabilities.deleteArtifacts
  ) {
    return null;
  }

  return h(
    'button',
    {
      type: 'button',
      class: 'btn btn-ghost btn-sm',
      'data-remove-artifact': artifact.id,
      disabled: locked,
      title: locked ? 'Aus einem veröffentlichten Release erst nach dem Zurückziehen' : 'Artefakt entfernen',
    },
    icon('delete_outline'),
    'Entfernen',
  );
}

/** Removal with a mandatory reason in a confirmation modal; restoring moves the file back at once. */
function bindArtifactRemoval(root: HTMLElement, state: PageState, show: (release: ReleaseDetailDto) => void): void {
  const overlay = required('#artifact-remove');
  const form = required<HTMLFormElement>('#artifact-remove-form');
  let artifactId = '';

  const reload = async (): Promise<void> => {
    if (state.release !== null) {
      show(await releases.get(state.release.id));
    }
  };

  required('[data-artifact-list]', root).addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const remove = target?.closest<HTMLButtonElement>('[data-remove-artifact]') ?? null;
    const restore = target?.closest<HTMLButtonElement>('[data-restore-artifact]') ?? null;
    const artifact = state.release?.artifacts.find(
      (entry) => entry.id === (remove?.dataset['removeArtifact'] ?? restore?.dataset['restoreArtifact']),
    );

    if (artifact === undefined) {
      return;
    }

    if (remove !== null) {
      artifactId = artifact.id;
      form.reset();
      required('[data-artifact-remove-name]', form).textContent =
        `${ARTIFACT_KIND_LABELS[artifact.kind]} · ${artifact.originalFileName} · ${formatBytes(artifact.sizeBytes)}`;
      Overlays.open(overlay, remove);
    } else if (restore !== null) {
      void whileBusy(restore, async () => {
        try {
          await releases.restoreArtifact(artifact.id);
          Toast.show('success', 'Artefakt wiederhergestellt');
          await reload();
        } catch (error) {
          Toast.show('danger', 'Wiederherstellen fehlgeschlagen', describeError(error));
        }
      });
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(
      form,
      async () => {
        await releases.removeArtifact(artifactId, value(form, 'reason'));
        Overlays.close(overlay);
        Toast.show(
          'success',
          'Entfernung beantragt',
          'Das Artefakt ist nicht mehr verfügbar und wird in die Quarantäne verschoben.',
        );
        await reload();
      },
      () => ({ reason: value(form, 'reason') === '' ? 'Bitte begründe die Entfernung.' : null }),
    );
  });
}
