import type { AccountDto, AccountSessionDto, PreferencesDto } from '../../../shared/types/api.js';
import { account } from '../../services/account-service.js';
import { currentUser } from '../../services/session-service.js';
import { App } from '../core/app.js';
import { badge, cell, dataTable, emptyState, h, icon, loadPage, render, required } from '../core/dom.js';
import { formatDateTime } from '../core/format.js';
import { setValue, submit, value, whileBusy } from '../core/forms.js';
import { PERMISSION_LABELS, roleName, scopeLabel } from '../core/labels.js';
import { describeError } from '../core/messages.js';
import { Overlays } from './overlays.js';
import { Theme } from './theme.js';
import { Toast } from './toast.js';

const LOGIN_PAGE = '/login.html';
const THEMES = ['system', 'light', 'dark'] as const;
const START_PAGES = ['dashboard', 'apps'] as const;

/**
 * "Mein Konto" (`account.html`): the signed-in person's profile from GitHub, personal settings (colour mode,
 * start page), the roles they hold with the permissions that follow, and their open sessions, which they can
 * end one by one or all at once. Open to everybody who is signed in.
 */
export const AccountPage = App.register('AccountPage', {
  async init(): Promise<void> {
    const root = document.querySelector<HTMLElement>('[data-account-page]');

    if (root === null) {
      return;
    }

    const form = required<HTMLFormElement>('#account-preferences-form', root);

    const load = async (): Promise<void> => {
      const [loaded, user] = await Promise.all([account.get(), currentUser()]);
      render(required('[data-account-profile]', root), profile(loaded));
      render(required('[data-account-roles]', root), rolesTable(loaded));
      render(required('[data-account-sessions]', root), sessionsTable(loaded.sessions, reloadSessions));
      setValue(form, 'theme', loaded.preferences.theme);
      setValue(form, 'startPage', loaded.preferences.startPage);
      // Without an administrative role the dashboard forwards to the download page anyway.
      required<HTMLSelectElement>('[name="startPage"]', form).disabled = !user.capabilities.administers;
      required('[data-start-page-hint]', form).hidden = user.capabilities.administers;
    };

    const reloadSessions = async (): Promise<void> => {
      const loaded = await account.get();
      render(required('[data-account-sessions]', root), sessionsTable(loaded.sessions, reloadSessions));
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void submit(form, async () => {
        const changes: Partial<PreferencesDto> = {
          theme: preference(value(form, 'theme'), THEMES, 'system'),
          ...(required<HTMLSelectElement>('[name="startPage"]', form).disabled
            ? {}
            : { startPage: preference(value(form, 'startPage'), START_PAGES, 'dashboard') }),
        };
        const saved = await account.savePreferences(changes);
        Theme.fromAccount(saved.theme);
        Toast.show('success', 'Einstellungen gespeichert');
      });
    });

    bindSignOutEverywhere(root);
    await loadPage(root, load, describeError);
  },
});

function preference<Option extends string>(selected: string, options: readonly Option[], fallback: Option): Option {
  return (options as readonly string[]).includes(selected) ? (selected as Option) : fallback;
}

function profile({ user }: AccountDto): Node {
  return h(
    'div',
    { class: 'account-profile-row' },
    user.avatarUrl === null
      ? h('span', { class: 'account-avatar account-avatar-placeholder', 'aria-hidden': 'true' }, icon('account_circle'))
      : h('img', { class: 'account-avatar', src: user.avatarUrl, alt: '', referrerpolicy: 'no-referrer' }),
    h(
      'dl',
      { class: 'meta-list' },
      h('dt', {}, 'Name'),
      h('dd', {}, user.displayName),
      h('dt', {}, 'GitHub'),
      h('dd', {}, user.login === null ? '—' : `@${user.login}`),
      h('dt', {}, 'Letzte Anmeldung'),
      h('dd', {}, user.lastLoginAt === null ? '—' : formatDateTime(user.lastLoginAt)),
    ),
  );
}

function rolesTable({ roles }: AccountDto): Node {
  if (roles.length === 0) {
    return emptyState(
      'badge',
      'Keine Rolle',
      'Du kannst die Apps installieren, die für die ganze Organisation sichtbar sind. Weitere Rechte vergibt ein Admin deines Projekts.',
    );
  }

  return dataTable(
    [{ label: 'Rolle' }, { label: 'Geltungsbereich' }, { label: 'Erlaubt' }],
    roles.map((role) =>
      h(
        'tr',
        {},
        cell([
          h('strong', {}, roleName(role.roleKey)),
          role.viaTeam ? h('div', { class: 'text-muted' }, 'über ein Team') : null,
          role.expiresAt === null ? null : h('div', { class: 'text-muted' }, `bis ${formatDateTime(role.expiresAt)}`),
        ]),
        cell(role.scope.type === 'global' ? scopeLabel(role.scope) : `${scopeLabel(role.scope)} ${role.scopeName}`),
        cell(
          h(
            'ul',
            { class: 'account-permissions' },
            role.permissions.map((permission) => h('li', {}, PERMISSION_LABELS[permission] ?? permission)),
          ),
        ),
      ),
    ),
  );
}

function sessionsTable(sessions: readonly AccountSessionDto[], reload: () => Promise<void>): Node {
  return dataTable(
    [
      { label: 'Gerät' },
      { label: 'Angemeldet seit' },
      { label: 'Zuletzt aktiv' },
      { label: 'Aktionen', numeric: true },
    ],
    sessions.map((session) => {
      const end = session.current
        ? badge('Dieses Gerät', 'primary')
        : h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, 'Beenden');

      if (end instanceof HTMLButtonElement) {
        end.addEventListener('click', () => {
          void whileBusy(end, async () => {
            try {
              await account.endSession(session.id);
              Toast.show('success', 'Sitzung beendet');
              await reload();
            } catch (error) {
              Toast.show('danger', 'Sitzung nicht beendet', describeError(error));
            }
          });
        });
      }

      return h(
        'tr',
        {},
        cell(describeDevice(session.userAgent)),
        cell(formatDateTime(session.createdAt)),
        cell(formatDateTime(session.lastSeenAt)),
        cell(end, { numeric: true }),
      );
    }),
  );
}

function bindSignOutEverywhere(root: HTMLElement): void {
  const overlay = required('#sign-out-everywhere');
  const confirm = required<HTMLButtonElement>('[data-confirm-sign-out]', overlay);

  required('[data-action="sign-out-everywhere"]', root).addEventListener('click', (event) =>
    Overlays.open(overlay, event.currentTarget as HTMLElement),
  );
  confirm.addEventListener('click', () => {
    void whileBusy(confirm, async () => {
      try {
        await account.endAllSessions();
        window.location.assign(LOGIN_PAGE);
      } catch (error) {
        Toast.show('danger', 'Abmelden fehlgeschlagen', describeError(error));
      }
    });
  });
}

/** "Chrome auf Windows" from a user agent; rough on purpose, it only helps to recognise a device. */
export function describeDevice(userAgent: string | null): string {
  if (userAgent === null || userAgent === '') {
    return 'Unbekanntes Gerät';
  }

  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Browser';
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];

  return system === undefined ? browser : `${browser} auf ${system}`;
}

// Order matters: Edge and Opera also name Chrome, Chrome also names Safari.
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

// iPhones also name "Mac OS X", Android also names Linux.
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
];
