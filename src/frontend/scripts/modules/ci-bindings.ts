import type { CiBindingDto, CiSettingsDto } from '../../../shared/types/api.js';
import { ci } from '../../services/ci-service.js';
import { App } from '../core/app.js';
import { badge, cell, dataTable, emptyState, errorState, h, icon, loadingState, render } from '../core/dom.js';
import { formatDate } from '../core/format.js';
import { submit, value, whileBusy } from '../core/forms.js';
import { describeError } from '../core/messages.js';
import { Overlays } from './overlays.js';
import { Toast } from './toast.js';

/** Where workflows find the upload action; see `src/action/README.md`. */
export const ACTION_REFERENCE = 'lukas-kuntze/md-tool-distribution-portal/src/action@v1';

const REF_PATTERN = /^refs\/(heads|tags)\/[A-Za-z0-9_.\-/*]+$/;
const REPOSITORY_NAME = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/**
 * CI connection of an application (concept 4.7): which repositories may upload builds through the GitHub
 * Action, authenticated by the OIDC token of their jobs, and the values the workflow needs. Mounted in the
 * "CI" tab of the application page; needs `applications.manage`.
 */
export const CiBindings = App.register('CiBindings', {
  init(): void {
    // Mounted by the application page.
  },

  mount(container: HTMLElement, applicationId: string): void {
    const load = async (): Promise<void> => {
      render(container, loadingState());

      try {
        render(container, view(applicationId, await ci.settings(applicationId), load));
      } catch (error) {
        render(
          container,
          errorState(describeError(error), () => void load()),
        );
      }
    };

    void load();
  },
});

function view(applicationId: string, settings: CiSettingsDto, reload: () => Promise<void>): Node {
  const connect = h('button', { type: 'button', class: 'btn btn-secondary' }, icon('add_link'), 'Repository verbinden');
  connect.addEventListener('click', () => openBindModal(applicationId, connect, reload));

  const active = settings.bindings.filter((binding) => binding.revokedAt === null);

  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'toolbar toolbar-split' },
      h(
        'p',
        { class: 'text-muted toolbar-text' },
        'Workflows verbundener Repositories laden Builds über die GitHub Action hoch. Sie melden sich mit dem OIDC-Token ihres Jobs an – es gibt kein Secret zu verwalten.',
      ),
      connect,
    ),
    bindingTable(settings.bindings, reload),
    workflowCard(applicationId, settings, active[0] ?? null),
  );
}

function bindingTable(bindings: readonly CiBindingDto[], reload: () => Promise<void>): Node {
  if (bindings.length === 0) {
    return emptyState(
      'hub',
      'Kein Repository verbunden',
      'Verbinde ein Repository, damit dessen Workflows Builds dieser Anwendung hochladen dürfen.',
    );
  }

  return dataTable(
    [
      { label: 'Repository' },
      { label: 'Branch oder Tag' },
      { label: 'Environment' },
      { label: 'Erstellt' },
      { label: 'Status' },
      { label: 'Aktionen', numeric: true },
    ],
    bindings.map((binding) => {
      const revoke =
        binding.revokedAt === null
          ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, icon('link_off'), 'Trennen')
          : null;

      revoke?.addEventListener('click', () => openRevokeModal(binding, revoke, reload));

      return h(
        'tr',
        { class: binding.revokedAt === null ? null : 'row-muted' },
        cell([
          h('strong', {}, binding.repositoryName),
          h('div', { class: 'text-muted' }, `ID ${binding.repositoryId}`),
        ]),
        cell(h('code', {}, binding.refPattern)),
        cell(binding.environment === null ? '—' : h('code', {}, binding.environment)),
        cell([
          formatDate(binding.createdAt),
          binding.createdBy === null ? null : h('div', { class: 'text-muted' }, binding.createdBy),
        ]),
        cell(
          binding.revokedAt === null
            ? badge('Aktiv', 'success')
            : badge(`Getrennt ${formatDate(binding.revokedAt)}`, 'neutral'),
        ),
        cell(revoke, { numeric: true }),
      );
    }),
  );
}

/** The values for the action and a workflow to start from, filled in as far as the portal knows them. */
function workflowCard(applicationId: string, settings: CiSettingsDto, binding: CiBindingDto | null): Node {
  const snippet = workflowSnippet(applicationId, settings, binding);

  return h(
    'article',
    { class: 'card' },
    h('div', { class: 'card-header' }, h('h3', { class: 'card-title' }, 'Workflow einrichten')),
    h(
      'div',
      { class: 'card-body' },
      copyField('ci-portal-url', 'portal-url', settings.portalUrl),
      copyField('ci-application-id', 'application-id', applicationId),
      settings.audience === settings.portalUrl ? null : copyField('ci-audience', 'audience', settings.audience),
      h(
        'div',
        { class: 'form-group' },
        h('div', { class: 'form-label' }, 'Beispiel-Workflow'),
        h(
          'div',
          { class: 'snippet' },
          h(
            'div',
            { class: 'snippet-head' },
            h('span', { class: 'snippet-lang' }, 'YAML'),
            h(
              'button',
              { type: 'button', class: 'snippet-copy', 'data-copy': snippet },
              h('span', { 'data-copy-label': true }, 'Kopieren'),
            ),
          ),
          h('pre', { class: 'code' }, snippet),
        ),
        h(
          'div',
          { class: 'form-helper' },
          'Der Job braucht „permissions: id-token: write“. Version, Build-Nummer und Flavor liest das Portal aus den Dateien; Commit, Branch und Workflow-Lauf aus dem Token.',
        ),
      ),
    ),
  );
}

export function workflowSnippet(applicationId: string, settings: CiSettingsDto, binding: CiBindingDto | null): string {
  const branch = binding?.refPattern.startsWith('refs/heads/') === true ? binding.refPattern.slice(11) : 'main';
  const trigger =
    binding?.refPattern.startsWith('refs/tags/') === true
      ? `on:\n  push:\n    tags: ['${binding.refPattern.slice(10)}']`
      : `on:\n  push:\n    branches: ['${branch}']`;

  return [
    'name: Release',
    trigger,
    '',
    'jobs:',
    '  upload:',
    '    runs-on: macos-latest',
    ...(binding?.environment === null || binding === null ? [] : [`    environment: ${binding.environment}`]),
    '    permissions:',
    '      id-token: write',
    '      contents: read',
    '    steps:',
    '      - uses: actions/checkout@v5',
    '      # … Builds erstellen, z. B. flutter build apk / flutter build ipa …',
    `      - uses: ${ACTION_REFERENCE}`,
    '        with:',
    `          portal-url: ${settings.portalUrl}`,
    `          application-id: ${applicationId}`,
    ...(settings.audience === settings.portalUrl ? [] : [`          audience: ${settings.audience}`]),
    '          files: |',
    '            build/app/outputs/flutter-apk/app-release.apk',
    '            build/ios/ipa/*.ipa',
  ].join('\n');
}

function copyField(id: string, label: string, text: string): Node {
  return h(
    'div',
    { class: 'form-group' },
    h('label', { class: 'form-label', for: id }, h('code', {}, label)),
    h(
      'div',
      { class: 'input-group' },
      h('input', { id, class: 'form-control text-mono', type: 'text', readonly: true, value: text }),
      h(
        'button',
        { type: 'button', class: 'password-toggle', 'data-copy': text, 'aria-label': `${label} kopieren` },
        icon('content_copy'),
      ),
    ),
  );
}

function modal(id: string, title: string, body: Node, footer: readonly Node[], form = false): HTMLElement {
  const dialog = h(
    form ? 'form' : 'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-title`, novalidate: form },
    h(
      'div',
      { class: 'modal-header' },
      h('h3', { id: `${id}-title` }, title),
      h('button', { type: 'button', class: 'close-btn', 'data-modal-close': true, 'aria-label': 'Schließen' }, '×'),
    ),
    h('div', { class: 'modal-body' }, body),
    h('div', { class: 'modal-footer' }, footer),
  );
  const overlay = h('div', { class: 'modal-overlay', id, hidden: true }, dialog);

  document.getElementById(id)?.remove();
  document.body.append(overlay);
  return overlay;
}

function field(id: string, name: string, label: string, helper: string, attributes: Record<string, unknown>): Node {
  return h(
    'div',
    { class: 'form-group' },
    h('label', { class: 'form-label', for: id }, label),
    h('input', { id, name, class: 'form-control', type: 'text', ...attributes }),
    h('div', { class: 'form-helper' }, helper),
  );
}

function openBindModal(applicationId: string, trigger: HTMLElement, reload: () => Promise<void>): void {
  const fields = h(
    'div',
    {},
    field('ci-repository', 'repositoryName', 'Repository', 'Als owner/name, z. B. medifox/pflege-mobil.', {
      maxlength: 201,
      placeholder: 'owner/name',
      'data-autofocus': true,
    }),
    field(
      'ci-repository-id',
      'repositoryId',
      'Repository-ID',
      'Die numerische ID bleibt bei Umbenennungen gleich und kann nicht von einem neuen Repository übernommen werden. Abrufbar mit „gh api repos/owner/name --jq .id“.',
      { inputmode: 'numeric', placeholder: 'z. B. 812345678' },
    ),
    field(
      'ci-ref',
      'refPattern',
      'Branch oder Tag',
      'refs/heads/… für Branches, refs/tags/… für Tags; * steht für beliebige Zeichen außer /, ** auch für /.',
      { maxlength: 255, value: 'refs/heads/main', class: 'form-control text-mono' },
    ),
    field(
      'ci-environment',
      'environment',
      'Environment (optional)',
      'Wenn gesetzt, werden nur Jobs dieses Deployment-Environments akzeptiert, z. B. eines mit Freigabe durch Reviewer.',
      { maxlength: 255, placeholder: 'z. B. production' },
    ),
  );
  const overlay = modal(
    'ci-bind',
    'Repository verbinden',
    fields,
    [
      h('button', { type: 'button', class: 'btn btn-outline', 'data-modal-close': true }, 'Abbrechen'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, icon('add_link'), 'Verbinden'),
    ],
    true,
  );
  const form = overlay.querySelector('form') as HTMLFormElement;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(
      form,
      async () => {
        const environment = value(form, 'environment');

        await ci.bind(applicationId, {
          repositoryId: Number(value(form, 'repositoryId')),
          repositoryName: value(form, 'repositoryName'),
          refPattern: value(form, 'refPattern'),
          environment: environment === '' ? null : environment,
        });
        Overlays.close(overlay);
        Toast.show('success', 'Repository verbunden');
        await reload();
      },
      () => bindingErrors(value(form, 'repositoryName'), value(form, 'repositoryId'), value(form, 'refPattern')),
    );
  });

  Overlays.open(overlay, trigger);
}

/** Client-side check of the binding form; the server validates authoritatively. */
export function bindingErrors(
  repositoryName: string,
  repositoryId: string,
  refPattern: string,
): Record<string, string | null> {
  return {
    repositoryName: REPOSITORY_NAME.test(repositoryName) ? null : 'Bitte als owner/name angeben.',
    repositoryId: /^[1-9]\d{0,15}$/.test(repositoryId) ? null : 'Bitte die numerische Repository-ID angeben.',
    refPattern:
      REF_PATTERN.test(refPattern) && !refPattern.includes('***')
        ? null
        : 'Muss mit refs/heads/ oder refs/tags/ beginnen; nur * und ** als Platzhalter.',
  };
}

function openRevokeModal(binding: CiBindingDto, trigger: HTMLElement, reload: () => Promise<void>): void {
  const confirm = h('button', { type: 'button', class: 'btn btn-danger' }, icon('link_off'), 'Trennen');
  const overlay = modal(
    'ci-revoke',
    'Repository trennen?',
    h(
      'p',
      {},
      `Workflows aus „${binding.repositoryName}“ (${binding.refPattern}) können danach keine Builds mehr hochladen. Bereits hochgeladene Releases bleiben erhalten.`,
    ),
    [h('button', { type: 'button', class: 'btn btn-outline', 'data-modal-close': true }, 'Abbrechen'), confirm],
  );

  confirm.addEventListener('click', () => {
    void whileBusy(confirm, async () => {
      try {
        await ci.revoke(binding.id);
        Overlays.close(overlay);
        Toast.show('success', 'Repository getrennt');
        await reload();
      } catch (error) {
        Toast.show('danger', 'Trennen fehlgeschlagen', describeError(error));
      }
    });
  });

  Overlays.open(overlay, trigger);
}
