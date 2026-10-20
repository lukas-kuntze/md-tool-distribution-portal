import type { Asset } from '../entities/asset.js';
import type { Project } from '../entities/project.js';
import type { ProjectId } from '../value-objects/identifier.js';
import type { Slug } from '../value-objects/slug.js';
import type { ChangeContext, Stored } from './stored.js';

export interface ProjectRepository {
  /** Fails with `slug_taken` if the slug is in use. */
  insert(project: Project, context: ChangeContext): void;
  /** Returns the new row version; fails with `concurrent_modification` if the row changed in between. */
  update(project: Project, expectedRowVersion: number, context: ChangeContext): number;
  findById(id: ProjectId): Stored<Project> | null;
  findBySlug(slug: Slug): Stored<Project> | null;
  list(filter: { readonly status?: Project['status'] }): readonly Stored<Project>[];
  findIcon(id: ProjectId): Asset | null;
  /** Points the project at a new icon, or none, and returns the previous one, whose row is removed. */
  replaceIcon(id: ProjectId, icon: Asset | null, context: ChangeContext): Asset | null;
}
