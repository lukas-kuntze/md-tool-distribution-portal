import type { Application, ApplicationFlavor } from '../domain/entities/application.js';
import type { Project } from '../domain/entities/project.js';
import type { Release } from '../domain/entities/release.js';
import type { Stored } from '../domain/ports/stored.js';
import type { Repositories } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { ApplicationId, FlavorId, ProjectId, ReleaseId } from '../domain/value-objects/identifier.js';

export function requireProject(repositories: Repositories, id: ProjectId): Stored<Project> {
  const stored = repositories.projects.findById(id);

  if (stored === null) {
    throw new DomainError('project_not_found', 'The project does not exist.');
  }

  return stored;
}

export function requireApplication(repositories: Repositories, id: ApplicationId): Stored<Application> {
  const stored = repositories.applications.findById(id);

  if (stored === null) {
    throw new DomainError('application_not_found', 'The application does not exist.');
  }

  return stored;
}

export function requireFlavor(repositories: Repositories, id: FlavorId): Stored<ApplicationFlavor> {
  const stored = repositories.applications.findFlavor(id);

  if (stored === null) {
    throw new DomainError('flavor_not_found', 'The flavor does not exist.');
  }

  return stored;
}

export interface ReleaseContext {
  readonly stored: Stored<Release>;
  readonly application: Application;
  readonly flavor: ApplicationFlavor;
}

/** A release together with the application and flavor it belongs to. */
export function requireRelease(repositories: Repositories, id: ReleaseId): ReleaseContext {
  const stored = repositories.releases.findById(id);
  const application = stored && repositories.applications.findById(stored.value.applicationId)?.value;
  const flavor = stored && repositories.applications.findFlavor(stored.value.flavorId)?.value;

  if (!stored || !application || !flavor) {
    throw new DomainError('release_not_found', 'The release does not exist.');
  }

  return { stored, application, flavor };
}

/** Optimistic locking for user edits: the user must have seen the current version. */
export function assertUnchanged(stored: Stored<unknown>, expectedRowVersion: number): void {
  if (stored.rowVersion !== expectedRowVersion) {
    throw new DomainError('concurrent_modification', 'The record changed after it was shown; review it again.');
  }
}
