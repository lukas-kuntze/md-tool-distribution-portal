import type { AuditEntryDto, ScopeDto } from '../../../shared/types/api.js';
import { operations, type AuditFilter } from '../../services/operations-service.js';
import { currentUser } from '../../services/session-service.js';
import { App } from '../core/app.js';
import { badge, cell, dataTable, emptyState, errorState, h, loadingState, pager, render } from '../core/dom.js';
import { formatDateTime } from '../core/format.js';
import { value } from '../core/forms.js';
import { labelOf, OUTCOME_LABELS } from '../core/labels.js';
import { describeError } from '../core/messages.js';
import { Overlays } from './overlays.js';

const PAGE_SIZE = 50;

const ACTOR_TYPES: Readonly<Record<AuditEntryDto['actor']['type'], string>> = {
  user: 'Benutzer',
  ci: 'CI',
  system: 'System',
  share: 'Freigabe',
};

/**
 * Audit log of a scope (concept 7.3): filter by action, outcome and period, page through the entries and show
 * the details of one entry in a modal. On `audit.html` it shows the whole platform; the "Audit" tabs of
 * projects and applications mount it for their scope.
 */
export const AuditLog = App.register('AuditLog', {
  async init(): Promise<void> {
    const container = document.querySelector<HTMLElement>('[data-audit-page]');

    if (container === null) {
      return;
    }

    try {
      const user = await currentUser();

      if (user.capabilities.readAudit) {
        AuditLog.mount(container, { type: 'global' });
      } else {
        render(
          container,
          emptyState(
            'lock',
            'Keine Berechtigung',
            'Das plattformweite Audit-Log ist Inhabern von „audit.read“ auf Plattformebene vorbehalten. Projekt- und Anwendungsprotokolle findest du im jeweiligen Audit-Tab.',
          ),
        );
      }
    } catch (error) {
      render(container, errorState(describeError(error)));
    }
  },

  mount(container: HTMLElement, scope: ScopeDto): void {
    const prefix = container.id || 'audit';
    const form = h(
      'form',
      { class: 'toolbar', role: 'search', 'aria-label': 'Audit-Log filtern' },
      field(
        `${prefix}-action`,
        'Aktion beginnt mit',
        h('input', {
          id: `${prefix}-action`,
          name: 'action',
          class: 'form-control',
          type: 'search',
          placeholder: 'z. B. release.delete',
        }),
      ),
      field(
        `${prefix}-outcome`,
        'Ergebnis',
        h(
          'select',
          { id: `${prefix}-outcome`, name: 'outcome', class: 'form-control' },
          h('option', { value: '' }, 'Alle'),
          ...Object.entries(OUTCOME_LABELS).map(([key, label]) => h('option', { value: key }, label.text)),
        ),
      ),
      field(
        `${prefix}-from`,
        'Von',
        h('input', { id: `${prefix}-from`, name: 'from', class: 'form-control', type: 'date' }),
      ),
      field(`${prefix}-to`, 'Bis', h('input', { id: `${prefix}-to`, name: 'to', class: 'form-control', type: 'date' })),
      h('button', { type: 'submit', class: 'btn btn-outline' }, 'Filtern'),
    );
    const list = h('div', {});
    let page = 0;

    const load = async (): Promise<void> => {
      render(list, loadingState());

      try {
        const { entries, total } = await operations.auditLog(scope, filterOf(form, page));
        render(
          list,
          entries.length === 0 && page === 0
            ? emptyState('history', 'Keine Einträge', 'Für diese Filter gibt es keine Einträge im Audit-Log.')
            : [
                entryTable(entries),
                pager(page, total, PAGE_SIZE, (next) => {
                  page = next;
                  void load();
                }),
              ],
        );
      } catch (error) {
        render(
          list,
          errorState(describeError(error), () => void load()),
        );
      }
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      page = 0;
      void load();
    });

    render(container, form, list);
    void load();
  },
});

function field(id: string, label: string, control: HTMLElement): HTMLElement {
  return h('div', { class: 'form-group' }, h('label', { class: 'form-label', for: id }, label), control);
}

export function filterOf(form: HTMLFormElement, page: number): AuditFilter {
  const outcome = value(form, 'outcome');
  const from = value(form, 'from');
  const to = value(form, 'to');

  return {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(value(form, 'action') === '' ? {} : { action: value(form, 'action') }),
    ...(outcome === '' ? {} : { outcome: outcome as AuditEntryDto['outcome'] }),
    // Date inputs are local days; the whole "to" day is included.
    ...(from === '' ? {} : { from: new Date(`${from}T00:00:00`).toISOString() }),
    ...(to === '' ? {} : { to: new Date(`${to}T23:59:59.999`).toISOString() }),
  };
}

function entryTable(entries: readonly AuditEntryDto[]): HTMLElement {
  return dataTable(
    [
      { label: 'Zeitpunkt' },
      { label: 'Akteur' },
      { label: 'Aktion' },
      { label: 'Ziel' },
      { label: 'Ergebnis' },
      { label: 'Details', numeric: true },
    ],
    entries.map((entry) => {
      const outcome = labelOf(OUTCOME_LABELS, entry.outcome);
      const details = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Anzeigen');

      details.addEventListener('click', () => openDetails(entry, details));

      return h(
        'tr',
        {},
        cell(formatDateTime(entry.occurredAt)),
        cell(
          [
            entry.actor.label,
            entry.actor.type === 'user' ? null : [' ', badge(ACTOR_TYPES[entry.actor.type], 'info')],
          ].flat(),
        ),
        cell(h('code', {}, entry.action)),
        cell(entry.target.type),
        cell(badge(outcome.text, outcome.tone)),
        cell(details, { numeric: true }),
      );
    }),
  );
}

let dialog: { overlay: HTMLElement; body: HTMLElement } | null = null;

function openDetails(entry: AuditEntryDto, trigger: HTMLElement): void {
  dialog ??= createDialog();

  const outcome = labelOf(OUTCOME_LABELS, entry.outcome);
  const row = (term: string, description: Node | string): Node[] => [h('dt', {}, term), h('dd', {}, description)];

  render(
    dialog.body,
    h(
      'dl',
      { class: 'meta-list' },
      row('Zeitpunkt', formatDateTime(entry.occurredAt)),
      row('Akteur', entry.actor.label),
      row('Aktion', h('code', {}, entry.action)),
      row('Ziel', `${entry.target.type}${entry.target.id === null ? '' : ` · ${entry.target.id}`}`),
      row('Ergebnis', badge(outcome.text, outcome.tone)),
      row('Eintrag', `#${entry.id}`),
    ),
    h('h4', { class: 'sub-title' }, 'Details'),
    detailsSnippet(JSON.stringify(entry.details, null, 2)),
  );
  Overlays.open(dialog.overlay, trigger);
}

function createDialog(): NonNullable<typeof dialog> {
  const body = h('div', { class: 'modal-body' });
  const overlay = h(
    'div',
    { class: 'modal-overlay', id: 'audit-details', hidden: true },
    h(
      'div',
      { class: 'modal modal-wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'audit-details-title' },
      h(
        'div',
        { class: 'modal-header' },
        h('h3', { id: 'audit-details-title' }, 'Audit-Eintrag'),
        h('button', { type: 'button', class: 'close-btn', 'data-modal-close': true, 'aria-label': 'Schließen' }, '×'),
      ),
      body,
    ),
  );

  document.body.append(overlay);
  return { overlay, body };
}

/** The styleguide's code snippet: dark block with language label and copy button. */
function detailsSnippet(json: string): HTMLElement {
  return h(
    'div',
    { class: 'snippet' },
    h(
      'div',
      { class: 'snippet-head' },
      h('span', { class: 'snippet-lang' }, 'JSON'),
      h(
        'button',
        { type: 'button', class: 'snippet-copy', 'data-copy': json },
        h('span', { 'data-copy-label': true }, 'Kopieren'),
      ),
    ),
    h('pre', { class: 'code' }, json),
  );
}
