import type { HeldRoleDto, UserOverviewDto } from '../../../shared/types/api.js';
import { access } from '../../services/access-service.js';
import { currentUser } from '../../services/session-service.js';
import { App } from '../core/app.js';
import { badge, cell, dataTable, emptyState, errorState, h, icon, loadingState, pager, render } from '../core/dom.js';
import { formatDate, formatDateTime } from '../core/format.js';
import { value, whileBusy } from '../core/forms.js';
import { roleName, scopeLabel } from '../core/labels.js';
import { describeError } from '../core/messages.js';
import { Overlays } from './overlays.js';
import { Toast } from './toast.js';

const PAGE_SIZE = 25;

/**
 * User administration (tab "Benutzer" of `access.html`): everybody known to the platform with last sign-in and current roles,
 * searchable and filterable by status; disabling an account ends its sessions at once. Needs
 * `permissions.manage` at platform scope; roles themselves are granted on the access pages.
 */
export const UsersPage = App.register('UsersPage', {
  async init(): Promise<void> {
    const root = document.querySelector<HTMLElement>('[data-users-page]');

    if (root === null) {
      return;
    }

    let me: string;

    try {
      const user = await currentUser();

      if (!user.capabilities.managePermissions) {
        render(
          root,
          emptyState(
            'lock',
            'Keine Berechtigung',
            'Die Benutzerverwaltung erfordert „permissions.manage“ auf Plattformebene.',
          ),
        );
        return;
      }

      me = user.id;
    } catch (error) {
      render(root, errorState(describeError(error)));
      return;
    }

    const list = h('div', {});
    const form = h(
      'form',
      { class: 'toolbar', role: 'search', 'aria-label': 'Benutzer filtern' },
      h('input', {
        type: 'search',
        name: 'query',
        class: 'form-control',
        placeholder: 'Name oder GitHub-Login',
        'aria-label': 'Name oder GitHub-Login',
        maxlength: 100,
      }),
      h(
        'select',
        { name: 'status', class: 'form-control', 'aria-label': 'Status' },
        h('option', { value: '' }, 'Alle Status'),
        h('option', { value: 'active' }, 'Aktiv'),
        h('option', { value: 'disabled' }, 'Deaktiviert'),
      ),
      h('button', { type: 'submit', class: 'btn btn-outline' }, icon('search'), 'Suchen'),
    );
    let page = 1;

    const load = async (): Promise<void> => {
      render(list, loadingState());

      try {
        const status = value(form, 'status');
        const result = await access.directory({
          query: value(form, 'query'),
          status: status === 'active' || status === 'disabled' ? status : null,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        });

        render(
          list,
          userTable(result.entries, me, load),
          pager(page, result.total, PAGE_SIZE, (next) => {
            page = next;
            void load();
          }),
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
      page = 1;
      void load();
    });

    render(root, h('div', { class: 'stack' }, form, list));
    void load();
  },
});

function userTable(users: readonly UserOverviewDto[], me: string, reload: () => Promise<void>): Node {
  if (users.length === 0) {
    return emptyState('person_search', 'Keine Benutzer', 'Für diese Suche gibt es keine Benutzer.');
  }

  return dataTable(
    [
      { label: 'Benutzer' },
      { label: 'Status' },
      { label: 'Letzte Anmeldung' },
      { label: 'Rollen' },
      { label: 'Aktionen', numeric: true },
    ],
    users.map((user) => {
      const action = user.id === me ? null : statusButton(user, reload);

      return h(
        'tr',
        { class: user.status === 'disabled' ? 'row-muted' : null },
        cell([
          h('strong', {}, user.displayName),
          h('div', { class: 'text-muted' }, user.login === null ? 'noch nie angemeldet' : `@${user.login}`),
        ]),
        cell(user.status === 'active' ? badge('Aktiv', 'success') : badge('Deaktiviert', 'neutral')),
        cell(user.lastLoginAt === null ? '—' : formatDateTime(user.lastLoginAt)),
        cell(
          user.roles.length === 0
            ? h('span', { class: 'text-muted' }, 'keine')
            : h('div', { class: 'badge-row' }, user.roles.map(roleBadge)),
        ),
        cell(action, { numeric: true }),
      );
    }),
  );
}

export function roleLabel(role: HeldRoleDto): string {
  const where = role.scope.type === 'global' ? scopeLabel(role.scope) : `${scopeLabel(role.scope)} ${role.scopeName}`;
  const details = [
    role.viaTeam ? 'über Team' : null,
    role.expiresAt === null ? null : `bis ${formatDate(role.expiresAt)}`,
  ]
    .filter((part) => part !== null)
    .join(', ');

  return `${roleName(role.roleKey)} · ${where}${details === '' ? '' : ` (${details})`}`;
}

function roleBadge(role: HeldRoleDto): HTMLElement {
  return badge(roleLabel(role), role.scope.type === 'global' ? 'primary' : 'neutral');
}

function statusButton(user: UserOverviewDto, reload: () => Promise<void>): HTMLElement {
  if (user.status === 'disabled') {
    const enable = h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, icon('how_to_reg'), 'Aktivieren');
    enable.addEventListener('click', () => {
      void whileBusy(enable, async () => {
        try {
          await access.setStatus(user.id, 'active');
          Toast.show('success', 'Benutzer aktiviert', `${user.displayName} kann sich wieder anmelden.`);
          await reload();
        } catch (error) {
          Toast.show('danger', 'Aktivieren fehlgeschlagen', describeError(error));
        }
      });
    });
    return enable;
  }

  const disable = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, icon('person_off'), 'Deaktivieren');
  disable.addEventListener('click', () => openDisableModal(user, disable, reload));
  return disable;
}

function openDisableModal(user: UserOverviewDto, trigger: HTMLElement, reload: () => Promise<void>): void {
  const confirm = h('button', { type: 'button', class: 'btn btn-danger' }, icon('person_off'), 'Deaktivieren');
  const overlay = h(
    'div',
    { class: 'modal-overlay', id: 'user-disable', hidden: true },
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'user-disable-title' },
      h(
        'div',
        { class: 'modal-header' },
        h('h3', { id: 'user-disable-title' }, 'Benutzer deaktivieren?'),
        h('button', { type: 'button', class: 'close-btn', 'data-modal-close': true, 'aria-label': 'Schließen' }, '×'),
      ),
      h(
        'div',
        { class: 'modal-body' },
        h(
          'p',
          {},
          `${user.displayName} wird sofort abgemeldet und kann sich nicht mehr anmelden. Rollen und Audit-Historie bleiben erhalten; das Konto lässt sich jederzeit wieder aktivieren.`,
        ),
      ),
      h(
        'div',
        { class: 'modal-footer' },
        h('button', { type: 'button', class: 'btn btn-outline', 'data-modal-close': true }, 'Abbrechen'),
        confirm,
      ),
    ),
  );

  document.getElementById('user-disable')?.remove();
  document.body.append(overlay);

  confirm.addEventListener('click', () => {
    void whileBusy(confirm, async () => {
      try {
        await access.setStatus(user.id, 'disabled');
        Overlays.close(overlay);
        Toast.show('success', 'Benutzer deaktiviert');
        await reload();
      } catch (error) {
        Toast.show('danger', 'Deaktivieren fehlgeschlagen', describeError(error));
      }
    });
  });

  Overlays.open(overlay, trigger);
}
