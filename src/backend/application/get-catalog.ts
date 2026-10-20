import type { Project } from '../domain/entities/project.js';
import { authorizedRead } from './authorization.js';
import { publishedApplication, type SharedApplication } from './open-share.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';
import { canDownloadPublished } from './visibility.js';

export interface Catalog {
  readonly projects: readonly { readonly project: Project; readonly applications: readonly SharedApplication[] }[];
}

/**
 * The download page for signed-in employees: every active application they may install from, i.e. with
 * visibility `organization` or an `artifacts.download` grant, with the newest published release per flavor.
 * The same selection and presentation as on share links, but authorized by the session.
 */
export function getCatalog(
  dependencies: Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>,
  actor: Actor,
  request: RequestContext,
): Catalog {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, { permissions }) => ({
    projects: repositories.projects
      .list({ status: 'active' })
      .map(({ value: project }) => ({
        project,
        applications: repositories.applications
          .listByProject(project.id)
          .map((stored) => stored.value)
          .filter((application) => application.status === 'active' && canDownloadPublished(permissions, application))
          .map((application) => publishedApplication(repositories, application, 'latest')),
      }))
      .filter((entry) => entry.applications.length > 0),
  }));
}
