import type { Asset, ApplicationPresentation } from '../entities/asset.js';
import type { Application, ApplicationFlavor } from '../entities/application.js';
import type { ApplicationId, FlavorId, ProjectId } from '../value-objects/identifier.js';
import type { Slug } from '../value-objects/slug.js';
import type { ChangeContext, Stored } from './stored.js';

/**
 * Applications together with their flavors. `hasReleases` of a loaded flavor is derived from the releases
 * that refer to it and is ignored when a flavor is written.
 */
export interface ApplicationRepository {
  /** Every application is created together with its default flavor. Fails with `slug_taken`. */
  insert(application: Application, defaultFlavor: ApplicationFlavor, context: ChangeContext): void;
  update(application: Application, expectedRowVersion: number, context: ChangeContext): number;
  findById(id: ApplicationId): Stored<Application> | null;
  findBySlug(projectId: ProjectId, slug: Slug): Stored<Application> | null;
  listByProject(projectId: ProjectId): readonly Stored<Application>[];

  /** Fails with `flavor_key_taken` or `bundle_identifier_taken`. */
  insertFlavor(flavor: ApplicationFlavor, context: ChangeContext): void;
  updateFlavor(flavor: ApplicationFlavor, expectedRowVersion: number, context: ChangeContext): number;
  findFlavor(id: FlavorId): Stored<ApplicationFlavor> | null;
  /** In display order: `sort_order`, then the default flavor first, then by name. */
  listFlavors(applicationId: ApplicationId): readonly Stored<ApplicationFlavor>[];
  /** Stores the display order; `flavorIds` lists every flavor of the application exactly once. */
  reorderFlavors(applicationId: ApplicationId, flavorIds: readonly FlavorId[], context: ChangeContext): void;

  findPresentation(applicationId: ApplicationId): ApplicationPresentation;
  updateInstallNotes(applicationId: ApplicationId, installNotes: string, context: ChangeContext): void;
  /** Points the application at a new icon, or none, and returns the previous one, whose row is removed. */
  replaceIcon(applicationId: ApplicationId, icon: Asset | null, context: ChangeContext): Asset | null;
}
