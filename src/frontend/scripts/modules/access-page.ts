import type { PermissionExplanationDto, ScopeDto, UserSummaryDto } from '../../../shared/types/api.js';
import { access } from '../../services/access-service.js';
import { applications, projects } from '../../services/project-service.js';
import { currentUser } from '../../services/session-service.js';
import { App } from '../core/app.js';
import { badge, cell, dataTable, emptyState, errorState, h, loadingState, render, required } from '../core/dom.js';
import { formatDateTime } from '../core/format.js';
import { byPermissions, PERMISSION_LABELS, ROLE_LABELS, roleName, scopeLabel } from '../core/labels.js';
import { describeError } from '../core/messages.js';
import { Overlays } from './overlays.js';
import { RoleAssignments } from './role-assignments.js';
import { Tabs } from './tabs.js';

/**
 * Users and access (`access.html`), concept 7.3, in tabs: pick a scope (platform, project or application), manage its
 * role assignments, search users and explain their effective permissions at that scope.
 */
export const AccessPage = App.register('AccessPage', {
  async init(): Promise<void> {
    const root = document.querySelector<HTMLElement>('[data-access-page]');

    if (root === null) {
      return;
    }

    const content = required('[data-page-content]', root);
    const state = required('[data-page-state]', root);

    try {
      const user = await currentUser();

      if (!user.capabilities.managesAnyPermissions) {
        render(
          state,
          emptyState(
            'lock',
            'Keine Berechtigung',
            'Die Zugriffsverwaltung steht Personen offen, die Rollen vergeben dürfen.',
          ),
        );
        return;
      }

      const scopeType = required<HTMLSelectElement>('[name="scopeType"]', root);
      const projectSelect = required<HTMLSelectElement>('[name="projectId"]', root);
      const applicationSelect = required<HTMLSelectElement>('[name="applicationId"]', root);
      const assignments = required('[data-assignments]', root);
      let scope: ScopeDto = { type: 'global' };

      const apply = (): void => {
        scope = selectedScope(scopeType.value, projectSelect.value, applicationSelect.value) ?? scope;
        RoleAssignments.mount(assignments, scope);
      };

      const projectList = await projects.list('active');
      projectSelect.replaceChildren(...projectList.map((project) => h('option', { value: project.id }, project.name)));

      // Only platform-wide permission managers may work at platform scope; others start at a project.
      if (!user.capabilities.managePermissions) {
        required<HTMLOptionElement>('option[value="global"]', scopeType).disabled = true;
        scopeType.value = 'project';
      }

      const loadApplications = async (): Promise<void> => {
        const found = projectSelect.value === '' ? [] : await applications.list(projectSelect.value);
        applicationSelect.replaceChildren(
          ...found.map((application) => h('option', { value: application.id }, application.name)),
        );
      };

      const syncFields = (): void => {
        projectSelect.closest<HTMLElement>('.form-group')?.toggleAttribute('hidden', scopeType.value === 'global');
        applicationSelect
          .closest<HTMLElement>('.form-group')
          ?.toggleAttribute('hidden', scopeType.value !== 'application');
      };

      scopeType.addEventListener('change', () => {
        syncFields();
        apply();
      });
      projectSelect.addEventListener('change', () => {
        void loadApplications().then(apply);
      });
      applicationSelect.addEventListener('change', apply);

      bindUserSearch(root, () => scope);
      void showRoleCatalog(required('[data-role-catalog]', root));
      syncFields();
      await loadApplications();
      apply();

      // The user list covers the whole platform, so it needs `permissions.manage` there; `#benutzer` opens it.
      const usersTab = required('#tab-users', root);
      usersTab.hidden = !user.capabilities.managePermissions;
      Tabs.activate(
        window.location.hash === '#benutzer' && !usersTab.hidden ? usersTab : required('#tab-assignments', root),
      );
      content.hidden = false;
    } catch (error) {
      render(state, errorState(describeError(error)));
    }
  },
});

export function selectedScope(type: string, projectId: string, applicationId: string): ScopeDto | null {
  switch (type) {
    case 'global':
      return { type: 'global' };
    case 'project':
      return projectId === '' ? null : { type: 'project', projectId };
    case 'application':
      return applicationId === '' ? null : { type: 'application', applicationId };
    default:
      return null;
  }
}

function bindUserSearch(root: HTMLElement, scope: () => ScopeDto): void {
  const form = required<HTMLFormElement>('[data-user-search]', root);
  const results = required('[data-user-results]', root);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = (form.elements.namedItem('query') as HTMLInputElement).value.trim();

    render(results, loadingState());
    access
      .searchUsers(query)
      .then((users) => render(results, userTable(users, scope)))
      .catch((error: unknown) => render(results, errorState(describeError(error))));
  });
}

function userTable(users: readonly UserSummaryDto[], scope: () => ScopeDto): Node {
  if (users.length === 0) {
    return emptyState(
      'person_search',
      'Keine Benutzer gefunden',
      'Benutzer erscheinen hier, sobald sie sich einmal angemeldet haben.',
    );
  }

  return dataTable(
    [
      { label: 'Benutzer' },
      { label: 'GitHub-ID' },
      { label: 'Status' },
      { label: 'Letzte Anmeldung' },
      { label: 'Rechte', numeric: true },
    ],
    users.map((user) => {
      const explain = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Effektive Rechte');
      explain.addEventListener('click', () => void openExplanation(user, scope(), explain));

      return h(
        'tr',
        {},
        cell([user.displayName, user.login === null ? null : h('div', { class: 'text-muted' }, `@${user.login}`)]),
        cell(user.gitHubId === null ? '—' : h('code', {}, user.gitHubId)),
        cell(user.status === 'active' ? badge('Aktiv', 'success') : badge('Deaktiviert', 'warning')),
        cell(formatDateTime(user.lastLoginAt)),
        cell(explain, { numeric: true }),
      );
    }),
  );
}

async function openExplanation(user: UserSummaryDto, scope: ScopeDto, trigger: HTMLElement): Promise<void> {
  const overlay = required('#permission-modal');
  const body = required('[data-permission-body]', overlay);

  required('[data-permission-user]', overlay).textContent = `${user.displayName} · ${scopeLabel(scope)}`;
  render(body, loadingState());
  Overlays.open(overlay, trigger);

  try {
    render(body, explanationTable(await access.explain(user.id, scope)));
  } catch (error) {
    render(body, errorState(describeError(error)));
  }
}

function explanationTable(explanations: readonly PermissionExplanationDto[]): Node {
  return dataTable(
    [{ label: 'Berechtigung' }, { label: 'Erhalten über' }],
    explanations.map((explanation) =>
      h(
        'tr',
        { class: explanation.allowed ? null : 'row-muted' },
        cell([
          explanation.allowed ? badge('ja', 'success') : badge('nein', 'neutral'),
          ' ',
          h('code', {}, explanation.permission),
        ]),
        cell(
          explanation.grants.length === 0
            ? '—'
            : explanation.grants.map((grant) => h('div', {}, `Rolle ${grant.roleKey} auf ${scopeLabel(grant.scope)}`)),
        ),
      ),
    ),
  );
}

/** The roles of the platform with what each of them allows, in plain words. */
async function showRoleCatalog(container: HTMLElement): Promise<void> {
  render(container, loadingState());

  try {
    const roles = byPermissions(await access.roles());

    render(
      container,
      dataTable(
        [{ label: 'Rolle' }, { label: 'Darf' }],
        roles.map((role) =>
          h(
            'tr',
            {},
            cell([h('strong', {}, roleName(role.key)), h('div', { class: 'text-muted' }, h('code', {}, role.key))]),
            cell([
              ROLE_LABELS[role.key] === undefined
                ? null
                : h('p', { class: 'role-summary' }, ROLE_LABELS[role.key]?.summary),
              h(
                'ul',
                { class: 'permission-list' },
                role.permissions.map((permission) =>
                  h('li', { title: permission }, PERMISSION_LABELS[permission] ?? permission),
                ),
              ),
            ]),
          ),
        ),
      ),
    );
  } catch (error) {
    render(container, errorState(describeError(error)));
  }
}
