import type { AssignmentDto, RoleDto, ScopeDto, UserSummaryDto } from '../../../shared/types/api.js';
import { REASON_MAX_LENGTH } from '../../../shared/constants/formats.js';
import { access } from '../../services/access-service.js';
import { App } from '../core/app.js';
import { badge, cell, dataTable, emptyState, errorState, h, loadingState, render, required } from '../core/dom.js';
import { formatDate } from '../core/format.js';
import { submit, value, whileBusy } from '../core/forms.js';
import { byPermissions, roleName, scopeLabel } from '../core/labels.js';
import { describeError } from '../core/messages.js';
import { Overlays } from './overlays.js';
import { Toast } from './toast.js';

const SEARCH_DELAY_MS = 250;

let roles: Promise<RoleDto[]> | null = null;

/**
 * Role assignments of one scope (concept 7.3, Access Management): direct and inherited assignments, granting
 * with a mandatory reason and optional expiry, and revoking. Used in the "Zugriff" tabs and the access page.
 * The API enforces the escalation rules; a refusal is shown as returned.
 */
export const RoleAssignments = App.register('RoleAssignments', {
  init(): void {
    // Mounted by the pages once the scope is known.
  },

  mount(container: HTMLElement, scope: ScopeDto): void {
    const list = h('div', { class: 'assignment-list' });
    const showRevoked = h('input', { type: 'checkbox', id: `${container.id || 'assignments'}-revoked` });
    const grantButton = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Rolle zuweisen');

    const load = async (): Promise<void> => {
      render(list, loadingState());

      try {
        const assignments = await access.assignments(scope, showRevoked.checked);
        render(list, assignmentTable(assignments, load));
      } catch (error) {
        render(
          list,
          errorState(describeError(error), () => void load()),
        );
      }
    };

    showRevoked.addEventListener('change', () => void load());
    grantButton.addEventListener('click', () => openGrantModal(scope, grantButton, load));

    render(
      container,
      h(
        'div',
        { class: 'toolbar toolbar-split' },
        h('div', { class: 'form-check' }, showRevoked, h('label', { for: showRevoked.id }, 'Widerrufene anzeigen')),
        grantButton,
      ),
      list,
    );
    void load();
  },
});

function assignmentTable(assignments: readonly AssignmentDto[], reload: () => Promise<void>): Node {
  if (assignments.length === 0) {
    return emptyState('group_off', 'Keine Zuweisungen', 'In diesem Bereich hat noch niemand eine Rolle.');
  }

  return dataTable(
    [
      { label: 'Benutzer' },
      { label: 'Rolle' },
      { label: 'Bereich' },
      { label: 'Begründung' },
      { label: 'Gültig bis' },
      { label: 'Aktionen', numeric: true },
    ],
    assignments.map((assignment) => {
      const user = assignment.principal.type === 'user' ? assignment.principal.user : null;
      const revokable = !assignment.inherited && assignment.revokedAt === null && assignment.source === 'manual';
      const revoke = revokable ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Widerrufen') : null;

      revoke?.addEventListener('click', () => openRevokeModal(assignment, revoke, reload));

      return h(
        'tr',
        { class: assignment.inherited || assignment.revokedAt !== null ? 'row-muted' : null },
        cell([
          user?.displayName ?? (assignment.principal.type === 'team' ? 'Team' : 'Unbekannter Benutzer'),
          user?.login === null || user?.login === undefined
            ? null
            : h('div', { class: 'text-muted' }, `@${user.login}`),
        ]),
        cell(
          assignment.role === null
            ? '—'
            : [roleName(assignment.role.key), h('div', { class: 'text-muted' }, h('code', {}, assignment.role.key))],
        ),
        cell(
          h(
            'div',
            { class: 'badge-row' },
            scopeLabel(assignment.scope),
            assignment.inherited ? badge('geerbt', 'neutral') : null,
            assignment.source === 'configuration' ? badge('durch Konfiguration', 'info') : null,
            assignment.revokedAt === null ? null : badge(`widerrufen ${formatDate(assignment.revokedAt)}`, 'neutral'),
          ),
        ),
        cell(assignment.reason === '' ? '—' : assignment.reason),
        cell(assignment.expiresAt === null ? 'unbefristet' : formatDate(assignment.expiresAt)),
        cell(revoke, { numeric: true }),
      );
    }),
  );
}

let grantModal: {
  overlay: HTMLElement;
  form: HTMLFormElement;
  results: HTMLSelectElement;
  role: HTMLSelectElement;
} | null = null;

function openGrantModal(scope: ScopeDto, trigger: HTMLElement, reload: () => Promise<void>): void {
  grantModal ??= createGrantModal();

  const { overlay, form, results, role } = grantModal;

  form.reset();
  results.replaceChildren(h('option', { value: '' }, 'Zuerst nach einem Benutzer suchen'));
  required('[data-grant-scope]', form).textContent = scopeLabel(scope);
  form.onsubmit = (event): void => {
    event.preventDefault();
    void submit(
      form,
      async () => {
        const expiresOn = value(form, 'expiresOn');
        await access.grant({
          roleId: value(form, 'roleId'),
          userId: value(form, 'userId'),
          scope,
          reason: value(form, 'reason'),
          expiresAt: expiresOn === '' ? null : new Date(`${expiresOn}T23:59:59`).toISOString(),
        });
        Overlays.close(overlay);
        Toast.show('success', 'Rolle zugewiesen');
        await reload();
      },
      () => ({
        userId: value(form, 'userId') === '' ? 'Bitte wähle einen Benutzer aus.' : null,
        roleId: value(form, 'roleId') === '' ? 'Bitte wähle eine Rolle aus.' : null,
        reason: value(form, 'reason') === '' ? 'Bitte begründe die Zuweisung.' : null,
      }),
    );
  };

  roles ??= access.roles();
  roles
    .then((list) =>
      role.replaceChildren(
        h('option', { value: '' }, 'Rolle wählen …'),
        ...byPermissions(list).map((entry) =>
          h(
            'option',
            { value: entry.id, title: entry.permissions.join(', ') },
            `${roleName(entry.key)} (${entry.key})`,
          ),
        ),
      ),
    )
    .catch((error: unknown) => {
      roles = null;
      Toast.show('danger', 'Rollen konnten nicht geladen werden', describeError(error));
    });

  Overlays.open(overlay, trigger);
}

function createGrantModal(): NonNullable<typeof grantModal> {
  const search = h('input', {
    id: 'grant-user-search',
    name: 'userQuery',
    type: 'search',
    class: 'form-control',
    autocomplete: 'off',
    placeholder: 'Login oder Name',
    'data-autofocus': true,
  });
  const results = h('select', { id: 'grant-user', name: 'userId', class: 'form-control', size: 5 });
  const role = h('select', { id: 'grant-role', name: 'roleId', class: 'form-control' });
  const form = h(
    'form',
    {
      class: 'modal modal-wide',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'grant-title',
      id: 'grant-form',
      novalidate: true,
    },
    h(
      'div',
      { class: 'modal-header' },
      h('h3', { id: 'grant-title' }, 'Rolle zuweisen'),
      h('button', { type: 'button', class: 'close-btn', 'data-modal-close': true, 'aria-label': 'Schließen' }, '×'),
    ),
    h(
      'div',
      { class: 'modal-body' },
      h('p', { class: 'form-helper' }, 'Bereich: ', h('strong', { 'data-grant-scope': true })),
      h(
        'div',
        { class: 'form-group' },
        h('label', { class: 'form-label', for: search.id }, 'Benutzer suchen'),
        search,
        h('div', { class: 'form-helper' }, 'Nur Personen, die sich bereits einmal angemeldet haben.'),
      ),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label', for: results.id }, 'Benutzer'), results),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label', for: role.id }, 'Rolle'), role),
      h(
        'div',
        { class: 'form-group' },
        h('label', { class: 'form-label', for: 'grant-expires' }, 'Gültig bis (optional)'),
        h('input', { id: 'grant-expires', name: 'expiresOn', type: 'date', class: 'form-control' }),
      ),
      h(
        'div',
        { class: 'form-group' },
        h('label', { class: 'form-label', for: 'grant-reason' }, 'Begründung'),
        h('textarea', {
          id: 'grant-reason',
          name: 'reason',
          class: 'form-control',
          rows: 3,
          maxlength: REASON_MAX_LENGTH,
          required: true,
        }),
        h('div', { class: 'form-helper' }, 'Wird im Audit-Log gespeichert.'),
      ),
    ),
    h(
      'div',
      { class: 'modal-footer' },
      h('button', { type: 'button', class: 'btn btn-outline', 'data-modal-close': true }, 'Abbrechen'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Zuweisen'),
    ),
  );
  const overlay = h('div', { class: 'modal-overlay', id: 'grant-modal', hidden: true }, form);
  let timer: number | undefined;

  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void searchUsers(search.value.trim(), results), SEARCH_DELAY_MS);
  });

  document.body.append(overlay);
  return { overlay, form, results, role };
}

async function searchUsers(query: string, results: HTMLSelectElement): Promise<void> {
  if (query === '') {
    return;
  }

  try {
    const users = await access.searchUsers(query);
    results.replaceChildren(
      ...(users.length === 0
        ? [h('option', { value: '' }, 'Kein Benutzer gefunden')]
        : users.map((user) => h('option', { value: user.id }, userOptionLabel(user)))),
    );
  } catch (error) {
    Toast.show('danger', 'Suche fehlgeschlagen', describeError(error));
  }
}

export function userOptionLabel(user: UserSummaryDto): string {
  const login = user.login === null ? '' : ` (@${user.login})`;
  const gitHub = user.gitHubId === null ? '' : ` · GitHub-ID ${user.gitHubId}`;
  return `${user.displayName}${login}${gitHub}${user.status === 'disabled' ? ' · deaktiviert' : ''}`;
}

let revokeModal: { overlay: HTMLElement; text: HTMLElement; confirm: HTMLButtonElement } | null = null;

function openRevokeModal(assignment: AssignmentDto, trigger: HTMLElement, reload: () => Promise<void>): void {
  revokeModal ??= createRevokeModal();

  const { overlay, text, confirm } = revokeModal;
  const user = assignment.principal.type === 'user' ? assignment.principal.user?.displayName : undefined;

  text.textContent = `Die Rolle „${assignment.role?.key ?? '—'}“ von ${user ?? 'diesem Benutzer'} wird widerrufen. Die Zuweisung bleibt in der Historie erhalten.`;
  confirm.onclick = (): void => {
    void whileBusy(confirm, async () => {
      try {
        await access.revoke(assignment.id);
        Overlays.close(overlay);
        Toast.show('success', 'Rolle widerrufen');
        await reload();
      } catch (error) {
        Toast.show('danger', 'Widerruf fehlgeschlagen', describeError(error));
      }
    });
  };
  Overlays.open(overlay, trigger);
}

function createRevokeModal(): NonNullable<typeof revokeModal> {
  const text = h('p', {});
  const confirm = h('button', { type: 'button', class: 'btn btn-danger' }, 'Widerrufen');
  const overlay = h(
    'div',
    { class: 'modal-overlay', id: 'revoke-modal', hidden: true },
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'revoke-title' },
      h(
        'div',
        { class: 'modal-header' },
        h('h3', { id: 'revoke-title' }, 'Rolle widerrufen?'),
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
