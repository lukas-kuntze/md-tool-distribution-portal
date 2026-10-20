import { ICON_FORMATS, iconFormatOf, MAX_ICON_BYTES, type Asset, type AssetOwner } from '../domain/entities/asset.js';
import type { ArtifactStorage } from '../domain/ports/artifact-storage.js';
import type { Repositories } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { ApplicationId, FlavorId, ProjectId } from '../domain/value-objects/identifier.js';
import { assetStorageKey } from '../domain/value-objects/storage-key.js';
import {
  applicationTarget,
  auditChange,
  authorizedRead,
  authorizedTransaction,
  projectTarget,
  type ActorContext,
  type Guard,
} from './authorization.js';
import { requireApplication, requireProject } from './lookups.js';
import { getApplication, visibleApplication, type ApplicationView } from './manage-applications.js';
import { getProject, type ProjectView } from './manage-projects.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';

export interface PresentationDependencies extends UseCaseDependencies {
  readonly storage: ArtifactStorage;
}

type IconContent = { readonly icon: Asset; readonly content: AsyncIterable<Uint8Array> } | null;

/**
 * Replaces the icon of an application (`applications.manage`). The image is checked by its magic bytes (PNG or
 * JPEG only, at most 512 KB), stored below `assets/` and only then referenced; the previous file is removed.
 */
export async function uploadApplicationIcon(
  dependencies: PresentationDependencies,
  actor: Actor,
  request: RequestContext,
  input: { readonly applicationId: ApplicationId; readonly content: AsyncIterable<Uint8Array> },
): Promise<ApplicationView> {
  const owner: AssetOwner = { type: 'application', id: input.applicationId };
  authorizedRead(contextOf(dependencies, actor, request), (repositories, guard) =>
    requireIconManagement(repositories, guard, owner),
  );
  await replaceIcon(dependencies, actor, request, owner, await receiveIcon(dependencies, owner, input.content));
  return getApplication(dependencies, actor, request, input.applicationId);
}

export async function removeApplicationIcon(
  dependencies: PresentationDependencies,
  actor: Actor,
  request: RequestContext,
  applicationId: ApplicationId,
): Promise<ApplicationView> {
  await replaceIcon(dependencies, actor, request, { type: 'application', id: applicationId }, null);
  return getApplication(dependencies, actor, request, applicationId);
}

/** The icon of an application the user can see; `null` when it has none. */
export async function readApplicationIcon(
  dependencies: PresentationDependencies,
  actor: Actor,
  request: RequestContext,
  applicationId: ApplicationId,
): Promise<IconContent> {
  const icon = authorizedRead(contextOf(dependencies, actor, request), (repositories, { permissions }) => {
    visibleApplication(repositories, applicationId, permissions);
    return repositories.applications.findPresentation(applicationId).icon;
  });

  return contentOf(dependencies.storage, icon);
}

/** Replaces the icon of a project (`projects.update`); same checks and storage as application icons. */
export async function uploadProjectIcon(
  dependencies: PresentationDependencies,
  actor: Actor,
  request: RequestContext,
  input: { readonly projectId: ProjectId; readonly content: AsyncIterable<Uint8Array> },
): Promise<ProjectView> {
  const owner: AssetOwner = { type: 'project', id: input.projectId };
  authorizedRead(contextOf(dependencies, actor, request), (repositories, guard) =>
    requireIconManagement(repositories, guard, owner),
  );
  await replaceIcon(dependencies, actor, request, owner, await receiveIcon(dependencies, owner, input.content));
  return getProject(dependencies, actor, request, input.projectId);
}

export async function removeProjectIcon(
  dependencies: PresentationDependencies,
  actor: Actor,
  request: RequestContext,
  projectId: ProjectId,
): Promise<ProjectView> {
  await replaceIcon(dependencies, actor, request, { type: 'project', id: projectId }, null);
  return getProject(dependencies, actor, request, projectId);
}

/** The icon of a project the user can see; `null` when it has none. */
export function readProjectIcon(
  dependencies: PresentationDependencies,
  actor: Actor,
  request: RequestContext,
  projectId: ProjectId,
): Promise<IconContent> {
  return contentOf(dependencies.storage, getProject(dependencies, actor, request, projectId).icon);
}

/** Sets the display order of the flavors; the list has to name every flavor of the application once. */
export function reorderFlavors(
  dependencies: UseCaseDependencies,
  actor: Actor,
  request: RequestContext,
  input: { readonly applicationId: ApplicationId; readonly flavorIds: readonly FlavorId[] },
): ApplicationView {
  const context = contextOf(dependencies, actor, request);

  authorizedTransaction(context, (repositories, guard) => {
    const application = requireApplication(repositories, input.applicationId).value;
    guard.require('flavors.manage', applicationTarget(application), { type: 'application', id: application.id });

    const known = repositories.applications.listFlavors(application.id).map((flavor) => flavor.value.id);
    const requested = new Set(input.flavorIds);

    if (
      requested.size !== input.flavorIds.length ||
      known.length !== requested.size ||
      !known.every((id) => requested.has(id))
    ) {
      throw new DomainError(
        'invalid_flavor_order',
        'The order has to list every flavor of the application exactly once.',
      );
    }

    repositories.applications.reorderFlavors(application.id, input.flavorIds, { actor: actor.userId, at: context.now });
    repositories.auditLog.append(
      auditChange(
        context,
        'flavor.reordered',
        applicationTarget(application),
        { type: 'application', id: application.id },
        { before: known, after: input.flavorIds },
      ),
    );
  });

  return getApplication(dependencies, actor, request, input.applicationId);
}

/** Streams an upload into the storage, checks that it is a PNG or JPEG and commits it below `assets/`. */
async function receiveIcon(
  dependencies: PresentationDependencies,
  owner: AssetOwner,
  content: AsyncIterable<Uint8Array>,
): Promise<Asset> {
  const { storage, ids } = dependencies;
  const uploadId = ids.next<'Upload'>();
  const received = await storage.receive(uploadId, content, MAX_ICON_BYTES).catch(async (error: unknown) => {
    await storage.discard(uploadId);
    throw error;
  });
  const format = await readFormat(storage, uploadId);

  if (format === null) {
    await storage.discard(uploadId);
    throw new DomainError('invalid_icon', 'The icon must be a PNG or JPEG image.');
  }

  const assetId = ids.next<'Asset'>();
  const icon: Asset = {
    id: assetId,
    owner,
    kind: 'icon',
    contentType: ICON_FORMATS[format].contentType,
    sizeBytes: received.sizeBytes,
    sha256: received.sha256,
    storageKey: assetStorageKey(owner.id, assetId, format),
    createdAt: dependencies.clock.now(),
  };

  await storage.commit(uploadId, icon.storageKey);
  return icon;
}

async function replaceIcon(
  dependencies: PresentationDependencies,
  actor: Actor,
  request: RequestContext,
  owner: AssetOwner,
  icon: Asset | null,
): Promise<void> {
  const context = contextOf(dependencies, actor, request);
  let previous: Asset | null;

  try {
    previous = authorizedTransaction(context, (repositories, guard) => {
      const target = requireIconManagement(repositories, guard, owner);
      const change = { actor: actor.userId, at: context.now };
      const replaced =
        owner.type === 'application'
          ? repositories.applications.replaceIcon(owner.id, icon, change)
          : repositories.projects.replaceIcon(owner.id, icon, change);

      audit(repositories, context, owner, target, icon);
      return replaced;
    });
  } catch (error) {
    if (icon !== null) {
      await dependencies.storage.removeAsset(icon.storageKey);
    }

    throw error;
  }

  if (previous !== null) {
    // The database no longer refers to the file; a failure here only leaves a stray file behind.
    await dependencies.storage.removeAsset(previous.storageKey).catch(() => undefined);
  }
}

/** Checks the permission to change the owner's icon and returns the audit target. */
function requireIconManagement(
  repositories: Repositories,
  guard: Guard,
  owner: AssetOwner,
): ReturnType<typeof projectTarget> {
  if (owner.type === 'application') {
    const target = applicationTarget(requireApplication(repositories, owner.id).value);
    guard.require('applications.manage', target, { type: 'application', id: owner.id });
    return target;
  }

  const target = projectTarget(requireProject(repositories, owner.id).value);
  guard.require('projects.update', target, { type: 'project', id: owner.id });
  return target;
}

function audit(
  repositories: Repositories,
  context: ActorContext,
  owner: AssetOwner,
  target: ReturnType<typeof projectTarget>,
  icon: Asset | null,
): void {
  repositories.auditLog.append(
    auditChange(
      context,
      `${owner.type}.${icon === null ? 'icon_removed' : 'icon_changed'}`,
      target,
      { type: owner.type, id: owner.id },
      icon === null
        ? {}
        : { assetId: icon.id, contentType: icon.contentType, sizeBytes: icon.sizeBytes, sha256: icon.sha256 },
    ),
  );
}

async function contentOf(storage: ArtifactStorage, icon: Asset | null): Promise<IconContent> {
  return icon === null ? null : { icon, content: await storage.read(icon.storageKey) };
}

async function readFormat(
  storage: ArtifactStorage,
  uploadId: Parameters<ArtifactStorage['discard']>[0],
): Promise<ReturnType<typeof iconFormatOf>> {
  const file = await storage.openReceived(uploadId);

  try {
    return iconFormatOf(await file.read(0, 8));
  } finally {
    await file.close();
  }
}
