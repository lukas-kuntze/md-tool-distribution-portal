import type { Asset } from '../domain/entities/asset.js';
import type { Application } from '../domain/entities/application.js';
import {
  archiveProject as archive,
  createProject as create,
  restoreProject as restore,
  updateProjectDetails,
  type Project,
} from '../domain/entities/project.js';
import type { Stored } from '../domain/ports/stored.js';
import { parseDisplayName } from '../domain/value-objects/display-name.js';
import type { EffectivePermissions } from '../domain/value-objects/effective-permissions.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { ProjectId } from '../domain/value-objects/identifier.js';
import { parseSlug } from '../domain/value-objects/slug.js';
import { auditChange, authorizedRead, authorizedTransaction, GLOBAL_TARGET, projectTarget } from './authorization.js';
import { assertUnchanged, requireProject } from './lookups.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';
import { canSeeApplication, projectCapabilities, type ProjectCapabilities } from './visibility.js';

export interface ProjectView {
  readonly project: Stored<Project>;
  readonly icon: Asset | null;
  readonly applicationCount: number;
  readonly capabilities: ProjectCapabilities;
}

type Dependencies = Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>;

/** Projects the user can see: with `projects.read` on them, or with access to one of their applications. */
export function listProjects(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  filter: { readonly status?: Project['status'] },
): readonly ProjectView[] {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, { permissions }) =>
    repositories.projects.list(filter).flatMap((stored) => {
      const view = viewOf(
        stored,
        repositories.applications.listByProject(stored.value.id).map((app) => app.value),
        permissions,
        repositories.projects.findIcon(stored.value.id),
      );
      return view === null ? [] : [view];
    }),
  );
}

export function getProject(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  projectId: ProjectId,
): ProjectView {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, { permissions }) => {
    const stored = requireProject(repositories, projectId);
    const view = viewOf(
      stored,
      repositories.applications.listByProject(projectId).map((app) => app.value),
      permissions,
      repositories.projects.findIcon(projectId),
    );

    // Projects the user cannot see are reported as missing, so that their existence does not leak.
    if (view === null) {
      throw new DomainError('project_not_found', 'The project does not exist.');
    }

    return view;
  });
}

export interface CreateProjectInput {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
}

export function createProject(
  dependencies: UseCaseDependencies,
  actor: Actor,
  request: RequestContext,
  input: CreateProjectInput,
): Stored<Project> {
  const context = contextOf(dependencies, actor, request);

  return authorizedTransaction(context, (repositories, guard) => {
    guard.require('projects.create', GLOBAL_TARGET, { type: 'project', id: null });

    const project = create(
      dependencies.ids.next(),
      parseSlug(input.slug),
      parseDisplayName(input.name),
      input.description,
    );
    repositories.projects.insert(project, { actor: actor.userId, at: context.now });
    repositories.auditLog.append(
      auditChange(
        context,
        'project.created',
        projectTarget(project),
        { type: 'project', id: project.id },
        {
          slug: project.slug,
          name: project.name,
        },
      ),
    );

    return { value: project, rowVersion: 1 };
  });
}

export interface ProjectChange {
  readonly projectId: ProjectId;
  readonly expectedRowVersion: number;
}

export function updateProject(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: ProjectChange & { readonly name: string; readonly description: string },
): Stored<Project> {
  return changeProject(dependencies, actor, request, input, 'project.updated', (project) =>
    updateProjectDetails(project, parseDisplayName(input.name), input.description),
  );
}

export function archiveProject(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: ProjectChange,
): Stored<Project> {
  return changeProject(dependencies, actor, request, input, 'project.archived', (project, now) =>
    archive(project, now, actor.userId),
  );
}

export function restoreProject(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: ProjectChange,
): Stored<Project> {
  return changeProject(dependencies, actor, request, input, 'project.restored', restore);
}

function changeProject(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: ProjectChange,
  action: string,
  change: (project: Project, now: Date) => Project,
): Stored<Project> {
  const context = contextOf(dependencies, actor, request);

  return authorizedTransaction(context, (repositories, guard) => {
    const stored = requireProject(repositories, input.projectId);
    const target = projectTarget(stored.value);

    guard.require('projects.update', target, { type: 'project', id: stored.value.id });
    assertUnchanged(stored, input.expectedRowVersion);

    const changed = change(stored.value, context.now);
    const rowVersion = repositories.projects.update(changed, stored.rowVersion, {
      actor: actor.userId,
      at: context.now,
    });
    repositories.auditLog.append(
      auditChange(
        context,
        action,
        target,
        { type: 'project', id: changed.id },
        {
          before: { name: stored.value.name, description: stored.value.description, status: stored.value.status },
          after: { name: changed.name, description: changed.description, status: changed.status },
        },
      ),
    );

    return { value: changed, rowVersion };
  });
}

function viewOf(
  stored: Stored<Project>,
  applications: readonly Application[],
  permissions: EffectivePermissions,
  icon: Asset | null,
): ProjectView | null {
  const target = projectTarget(stored.value);
  const visibleApplications = applications.filter((application) => canSeeApplication(permissions, application));

  if (!permissions.allows('projects.read', target) && visibleApplications.length === 0) {
    return null;
  }

  return {
    project: stored,
    icon,
    applicationCount: visibleApplications.length,
    capabilities: projectCapabilities(permissions, target),
  };
}
