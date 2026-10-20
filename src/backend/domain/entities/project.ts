import type { DisplayName } from '../value-objects/display-name.js';
import { DomainError } from '../value-objects/domain-error.js';
import type { ProjectId, UserId } from '../value-objects/identifier.js';
import type { Slug } from '../value-objects/slug.js';

export const PROJECT_DESCRIPTION_MAX_LENGTH = 2_000;

export interface Project {
  readonly id: ProjectId;
  /** Fixed at creation; used in URLs and never in file system paths. */
  readonly slug: Slug;
  readonly name: DisplayName;
  readonly description: string;
  readonly status: 'active' | 'archived';
  readonly archivedAt: Date | null;
  readonly archivedBy: UserId | null;
}

export function createProject(id: ProjectId, slug: Slug, name: DisplayName, description: string): Project {
  assertDescription(description);
  return { id, slug, name, description, status: 'active', archivedAt: null, archivedBy: null };
}

export function updateProjectDetails(project: Project, name: DisplayName, description: string): Project {
  assertActive(project);
  assertDescription(description);
  return { ...project, name, description };
}

/** Archived projects are read-only and hidden from download pages; nothing is deleted. */
export function archiveProject(project: Project, now: Date, actor: UserId): Project {
  assertActive(project);
  return { ...project, status: 'archived', archivedAt: now, archivedBy: actor };
}

export function restoreProject(project: Project): Project {
  if (project.status !== 'archived') {
    throw new DomainError('invalid_project_state', 'Only an archived project can be restored.');
  }

  return { ...project, status: 'active', archivedAt: null, archivedBy: null };
}

function assertActive(project: Project): void {
  if (project.status !== 'active') {
    throw new DomainError('invalid_project_state', 'Archived projects cannot be changed.');
  }
}

function assertDescription(description: string): void {
  if (description.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
    throw new DomainError('invalid_name', `Description is limited to ${PROJECT_DESCRIPTION_MAX_LENGTH} characters.`);
  }
}
