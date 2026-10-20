import type { SettingPresetsDto, ShareLinkDto, ShareScopeDto } from '../../../shared/types/api.js';
import { NAME_MAX_LENGTH } from '../../../shared/constants/formats.js';
import { settingsService } from '../../services/settings-service.js';
import { shares } from '../../services/share-service.js';
import { App } from '../core/app.js';
import { badge, cell, dataTable, emptyState, errorState, h, icon, loadingState, render } from '../core/dom.js';
import { formatDate } from '../core/format.js';
import { submit, value, whileBusy } from '../core/forms.js';
import { describeError } from '../core/messages.js';
import { Overlays } from './overlays.js';
import { Toast } from './toast.js';

export interface ShareChoice {
  readonly scope: ShareScopeDto;
  readonly label: string;
}

/**
 * Share links of a project or application (decision E7): customers get a secret link that shows the published
 * releases and lets them download and install them, without an account. The link is shown once after
 * creating it; afterwards only its hash exists. Mounted in the "Freigaben" tabs.
 */
export const ShareLinks = App.register('ShareLinks', {
  init(): void {
    // Mounted by the project and application pages.
  },

  /** `choices` offers what a new link may cover, the first entry being the default. */
  mount(container: HTMLElement, listScope: ShareScopeDto, choices: () => Promise<readonly ShareChoice[]>): void {
    const list = h('div', {});
    const create = h('button', { type: 'button', class: 'btn btn-secondary' }, icon('add_link'), 'Freigabe erstellen');

    const load = async (): Promise<void> => {
      render(list, loadingState());

      try {
        render(list, linkTable(await shares.list(listScope), load));
      } catch (error) {
        render(
          list,
          errorState(describeError(error), () => void load()),
        );
      }
    };

    create.addEventListener('click', () => {
      // Without presets (e.g. an older server) the dialog falls back to "all releases, no expiry".
      void Promise.all([choices(), settingsService.presets().catch(() => null)])
        .then(([available, presets]) => openCreateModal(available, presets, create, load))
        .catch((error: unknown) => Toast.show('danger', 'Freigabe nicht möglich', describeError(error)));
    });

    render(
      container,
      h(
        'div',
        { class: 'toolbar toolbar-split' },
        h(
          'p',
          { class: 'text-muted toolbar-text' },
          'Freigabelinks zeigen Kunden ohne Konto die veröffentlichten Releases zum Herunterladen und Installieren.',
        ),
        create,
      ),
      list,
    );
    void load();
  },
});

export function linkStatus(link: ShareLinkDto): { readonly text: string; readonly tone: 'success' | 'neutral' } {
  if (link.revokedAt !== null) {
    return { text: `Widerrufen ${formatDate(link.revokedAt)}`, tone: 'neutral' };
  }

  return link.active ? { text: 'Aktiv', tone: 'success' } : { text: 'Abgelaufen', tone: 'neutral' };
}

function linkTable(links: readonly ShareLinkDto[], reload: () => Promise<void>): Node {
  if (links.length === 0) {
    return emptyState('link', 'Keine Freigaben', 'Erstelle einen Freigabelink, um Releases an Kunden weiterzugeben.');
  }

  return dataTable(
    [
      { label: 'Empfänger' },
      { label: 'Umfang' },
      { label: 'Erstellt' },
      { label: 'Gültig bis' },
      { label: 'Status' },
      { label: 'Aktionen', numeric: true },
    ],
    links.map((link) => {
      const status = linkStatus(link);
      const revoke =
        link.active && link.revokedAt === null
          ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Widerrufen')
          : null;

      revoke?.addEventListener('click', () => openRevokeModal(link, revoke, reload));

      return h(
        'tr',
        { class: link.active ? null : 'row-muted' },
        cell(link.label),
        cell([
          link.scope.type === 'project' ? 'Projekt ' : 'Anwendung ',
          h('strong', {}, link.scopeName),
          h('div', { class: 'text-muted' }, link.releases === 'latest' ? 'Nur neueste Version' : 'Alle Releases'),
        ]),
        cell([
          formatDate(link.createdAt),
          link.createdBy === null ? null : h('div', { class: 'text-muted' }, link.createdBy),
        ]),
        cell(link.expiresAt === null ? 'unbefristet' : formatDate(link.expiresAt)),
        cell(badge(status.text, status.tone)),
        cell(revoke, { numeric: true }),
      );
    }),
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

function openCreateModal(
  choices: readonly ShareChoice[],
  presets: SettingPresetsDto | null,
  trigger: HTMLElement,
  reload: () => Promise<void>,
): void {
  const releasesPreset = presets?.shareLinkDefaultReleases ?? 'all';
  const maxDays = presets?.shareLinkMaxDays ?? null;
  const defaultDays = presets?.shareLinkDefaultDays ?? null;
  const scope = h(
    'select',
    { id: 'share-scope', name: 'scope', class: 'form-control' },
    choices.map((choice, index) => h('option', { value: String(index) }, choice.label)),
  );
  const fields = h(
    'div',
    {},
    h(
      'div',
      { class: 'form-group' },
      h('label', { class: 'form-label', for: 'share-label' }, 'Empfänger'),
      h('input', {
        id: 'share-label',
        name: 'label',
        class: 'form-control',
        type: 'text',
        maxlength: NAME_MAX_LENGTH,
        placeholder: 'z. B. Pflegedienst Meyer',
        'data-autofocus': true,
      }),
      h('div', { class: 'form-helper' }, 'Erscheint auf der Freigabeseite und im Audit-Log.'),
    ),
    h(
      'div',
      { class: 'form-group', hidden: choices.length < 2 },
      h('label', { class: 'form-label', for: 'share-scope' }, 'Umfang'),
      scope,
      h('div', { class: 'form-helper' }, 'Ein Projektlink umfasst auch Anwendungen, die später hinzukommen.'),
    ),
    h(
      'fieldset',
      { class: 'form-group form-fieldset' },
      h('legend', { class: 'form-label' }, 'Releases'),
      releaseOption(
        'all',
        'Alle veröffentlichten Releases',
        'Der Kunde kann auch ältere Versionen herunterladen.',
        releasesPreset === 'all',
      ),
      releaseOption(
        'latest',
        'Nur die neueste Version',
        'Jede neue Veröffentlichung ersetzt die vorige; ältere Versionen sind nicht mehr erreichbar.',
        releasesPreset === 'latest',
      ),
    ),
    h(
      'div',
      { class: 'form-group' },
      h(
        'label',
        { class: 'form-label', for: 'share-expires' },
        maxDays === null ? 'Gültig bis (optional)' : 'Gültig bis',
      ),
      h('input', {
        id: 'share-expires',
        name: 'expiresOn',
        class: 'form-control',
        type: 'date',
        value: defaultDays === null ? '' : dateInDays(defaultDays),
        max: maxDays === null ? null : dateInDays(maxDays),
        required: maxDays !== null,
      }),
      h(
        'div',
        { class: 'form-helper' },
        maxDays === null
          ? 'Ohne Datum gilt der Link, bis er widerrufen wird.'
          : `Freigaben gelten höchstens ${maxDays} Tage, bis ${formatDate(dateInDays(maxDays))}.`,
      ),
    ),
  );
  const overlay = modal(
    'share-create',
    'Freigabe erstellen',
    fields,
    [
      h('button', { type: 'button', class: 'btn btn-outline', 'data-modal-close': true }, 'Abbrechen'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Link erstellen'),
    ],
    true,
  );
  const form = overlay.querySelector('form') as HTMLFormElement;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(
      form,
      async () => {
        const expiresOn = value(form, 'expiresOn');
        const chosen = choices[Number(value(form, 'scope'))] ?? choices[0];

        if (chosen === undefined) {
          return;
        }

        const created = await shares.create({
          scope: chosen.scope,
          label: value(form, 'label'),
          releases: value(form, 'releases') === 'latest' ? 'latest' : 'all',
          expiresAt: expiresOn === '' ? null : new Date(`${expiresOn}T23:59:59`).toISOString(),
        });

        Overlays.close(overlay);
        openCreatedModal(created.url, trigger);
        await reload();
      },
      () => {
        const expiresOn = value(form, 'expiresOn');
        return {
          label: value(form, 'label') === '' ? 'Bitte gib an, für wen die Freigabe ist.' : null,
          expiresOn:
            maxDays === null
              ? null
              : expiresOn === ''
                ? 'Bitte gib an, bis wann die Freigabe gilt.'
                : expiresOn > dateInDays(maxDays)
                  ? `Höchstens bis ${formatDate(dateInDays(maxDays))}.`
                  : null,
        };
      },
    );
  });

  Overlays.open(overlay, trigger);
}

function releaseOption(option: 'all' | 'latest', label: string, helper: string, checked: boolean): HTMLElement {
  const id = `share-releases-${option}`;

  return h(
    'div',
    { class: 'form-check form-check-described' },
    h('input', { type: 'radio', id, name: 'releases', value: option, checked }),
    h('label', { for: id }, label, h('span', { class: 'form-helper' }, helper)),
  );
}

function openCreatedModal(url: string, trigger: HTMLElement): void {
  const overlay = modal(
    'share-created',
    'Freigabelink erstellt',
    h(
      'div',
      {},
      h(
        'div',
        { class: 'alert alert-warning' },
        h('strong', {}, 'Nur jetzt sichtbar'),
        'Der Link wird nicht gespeichert und lässt sich später nicht erneut anzeigen. Kopiere ihn jetzt und sende ihn an den Empfänger.',
      ),
      h(
        'div',
        { class: 'form-group' },
        h('label', { class: 'form-label', for: 'share-url' }, 'Link'),
        h(
          'div',
          { class: 'input-group' },
          h('input', { id: 'share-url', class: 'form-control text-mono', type: 'text', readonly: true, value: url }),
          h(
            'button',
            {
              type: 'button',
              class: 'password-toggle',
              'data-copy': url,
              'aria-label': 'Link kopieren',
              'data-autofocus': true,
            },
            icon('content_copy'),
          ),
        ),
      ),
    ),
    [h('button', { type: 'button', class: 'btn btn-primary', 'data-modal-close': true }, 'Fertig')],
  );

  Overlays.open(overlay, trigger);
}

function openRevokeModal(link: ShareLinkDto, trigger: HTMLElement, reload: () => Promise<void>): void {
  const confirm = h('button', { type: 'button', class: 'btn btn-danger' }, 'Widerrufen');
  const overlay = modal(
    'share-revoke',
    'Freigabe widerrufen?',
    h(
      'p',
      {},
      `Der Link für „${link.label}“ funktioniert sofort nicht mehr. Das lässt sich nicht rückgängig machen; bei Bedarf erstellst du einen neuen Link.`,
    ),
    [h('button', { type: 'button', class: 'btn btn-outline', 'data-modal-close': true }, 'Abbrechen'), confirm],
  );

  confirm.addEventListener('click', () => {
    void whileBusy(confirm, async () => {
      try {
        await shares.revoke(link.id);
        Overlays.close(overlay);
        Toast.show('success', 'Freigabe widerrufen');
        await reload();
      } catch (error) {
        Toast.show('danger', 'Widerruf fehlgeschlagen', describeError(error));
      }
    });
  });

  Overlays.open(overlay, trigger);
}

/** Local calendar date in `count` days, as a date input expects it (`YYYY-MM-DD`). */
function dateInDays(count: number): string {
  const date = new Date();
  date.setDate(date.getDate() + count);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
