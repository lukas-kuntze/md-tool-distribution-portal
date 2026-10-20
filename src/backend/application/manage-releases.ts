import type { Application, ApplicationFlavor } from '../domain/entities/application.js';
import type { DeletionJob } from '../domain/entities/deletion-job.js';
import type { ReleaseArtifact } from '../domain/entities/release-artifact.js';
import {
  deletionConfirmationPhrase,
  missingPlatforms,
  publishRelease as publish,
  releaseBuildNumber as releaseNumber,
  updateReleaseTexts as updateTexts,
  withdrawRelease as withdraw,
  type LifecycleState,
  type PublicationStatus,
  type Release,
} from '../domain/entities/release.js';
import type { ReleaseQuery } from '../domain/ports/release-repository.js';
import type { Stored } from '../domain/ports/stored.js';
import type { Repositories } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { ApplicationId, FlavorId, ReleaseId } from '../domain/value-objects/identifier.js';
import type { Permission } from '../domain/value-objects/permission.js';
import type { Platform } from '../domain/value-objects/platform.js';
import { applicationTarget, auditChange, authorizedRead, authorizedTransaction, type Guard } from './authorization.js';
import { visibleApplication } from './manage-applications.js';
import { assertUnchanged, requireRelease } from './lookups.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';
import { applicationCapabilities, type ApplicationCapabilities } from './visibility.js';

type Dependencies = Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>;

/** One page of a list together with the number of all matching entries. */
export interface Paged<Entry> {
  readonly entries: readonly Entry[];
  readonly total: number;
}

export interface ReleaseListEntry {
  readonly release: Stored<Release>;
  readonly flavorKey: string;
  readonly missingPlatforms: readonly Platform[];
}

export interface ListReleasesInput {
  readonly applicationId: ApplicationId;
  readonly flavorId?: FlavorId;
  readonly publicationStatuses?: readonly PublicationStatus[];
  readonly lifecycleStates?: readonly LifecycleState[];
  readonly search?: string;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Users with `releases.read` see drafts and releases in deletion; everyone else who can see the application
 * only sees published releases. Purged tombstones appear only when asked for explicitly.
 */
export function listReleases(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: ListReleasesInput,
): Paged<ReleaseListEntry> {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, { permissions }) => {
    const application = visibleApplication(repositories, input.applicationId, permissions);
    const readsAll = permissions.allows('releases.read', applicationTarget(application));
    const flavors = new Map(
      repositories.applications.listFlavors(application.id).map((flavor) => [flavor.value.id, flavor.value]),
    );
    const query: ReleaseQuery = readsAll
      ? {
          ...input,
          lifecycleStates: input.lifecycleStates ?? ['active', 'pending_deletion', 'quarantined'],
        }
      : { ...input, publicationStatuses: ['published'], lifecycleStates: ['active'] };

    const entries = repositories.releases.list(query).map((release) => ({
      release,
      flavorKey: flavors.get(release.value.flavorId)?.key ?? '',
      missingPlatforms: missingPlatforms(
        release.value,
        storedKinds(repositories.releases.listArtifacts(release.value.id)),
      ),
    }));

    return { entries, total: repositories.releases.count(query) };
  });
}

export interface ReleaseDetail {
  readonly release: Stored<Release>;
  readonly application: Application;
  readonly flavor: ApplicationFlavor;
  readonly artifacts: readonly ReleaseArtifact[];
  readonly missingPlatforms: readonly Platform[];
  readonly deletionJob: DeletionJob | null;
  /** Open removals of single artifacts, by artifact. */
  readonly artifactRemovals: ReadonlyMap<string, DeletionJob>;
  /** The text the user has to type to delete the release; only for users allowed to delete it. */
  readonly deletionConfirmation: string | null;
  readonly capabilities: ApplicationCapabilities;
}

export function getRelease(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  releaseId: ReleaseId,
): ReleaseDetail {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, { permissions }) => {
    const { stored, flavor } = requireRelease(repositories, releaseId);
    const application = visibleApplication(repositories, stored.value.applicationId, permissions);
    const capabilities = applicationCapabilities(permissions, application);

    if (
      !capabilities.readDrafts &&
      (stored.value.publicationStatus !== 'published' || stored.value.lifecycleState !== 'active')
    ) {
      throw new DomainError('release_not_found', 'The release does not exist.');
    }

    return detailOf(repositories, stored, application, flavor, capabilities);
  });
}

export interface ReleaseChange {
  readonly releaseId: ReleaseId;
  readonly expectedRowVersion: number;
}

export function updateReleaseTexts(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: ReleaseChange & { readonly releaseNotes?: string; readonly changelog?: string },
): ReleaseDetail {
  return changeRelease(dependencies, actor, request, input, 'releases.update', 'release.updated', ({ release }) =>
    updateTexts(release, {
      ...(input.releaseNotes === undefined ? {} : { releaseNotes: input.releaseNotes }),
      ...(input.changelog === undefined ? {} : { changelog: input.changelog }),
    }),
  );
}

export function publishRelease(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: ReleaseChange,
): ReleaseDetail {
  return changeRelease(
    dependencies,
    actor,
    request,
    input,
    'releases.publish',
    'release.published',
    ({ release, artifacts, now }) => publish(release, storedKinds(artifacts), now, actor.userId),
  );
}

export function withdrawRelease(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: ReleaseChange,
): ReleaseDetail {
  return changeRelease(dependencies, actor, request, input, 'releases.publish', 'release.withdrawn', ({ release }) =>
    withdraw(release),
  );
}

/** Frees the build number of a purged release (E4); the dialog in the user interface warns about device updates. */
export function releaseBuildNumber(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: ReleaseChange & { readonly reason: string },
): ReleaseDetail {
  return changeRelease(
    dependencies,
    actor,
    request,
    input,
    'build_numbers.release',
    'release.build_number_released',
    ({ release, now }) => releaseNumber(release, { at: now, by: actor.userId, reason: input.reason }),
  );
}

interface ChangeArguments {
  readonly release: Release;
  readonly artifacts: readonly ReleaseArtifact[];
  readonly now: Date;
}

function changeRelease(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: ReleaseChange,
  permission: Permission,
  action: string,
  change: (args: ChangeArguments) => Release,
): ReleaseDetail {
  const context = contextOf(dependencies, actor, request);

  return authorizedTransaction(context, (repositories, guard: Guard) => {
    const { stored, application, flavor } = requireRelease(repositories, input.releaseId);
    const target = applicationTarget(application);

    guard.require(permission, target, { type: 'release', id: stored.value.id });
    assertUnchanged(stored, input.expectedRowVersion);

    const artifacts = repositories.releases.listArtifacts(stored.value.id);
    const changed = change({ release: stored.value, artifacts, now: context.now });
    const rowVersion = repositories.releases.update(changed, stored.rowVersion, {
      actor: actor.userId,
      at: context.now,
    });

    repositories.auditLog.append(
      auditChange(
        context,
        action,
        target,
        { type: 'release', id: changed.id },
        {
          flavorKey: flavor.key,
          version: changed.version.value,
          buildNumber: changed.buildNumber,
          before: {
            publicationStatus: stored.value.publicationStatus,
            buildNumberReserved: stored.value.buildNumberReserved,
          },
          after: { publicationStatus: changed.publicationStatus, buildNumberReserved: changed.buildNumberReserved },
          ...(changed.buildNumberRelease === null ? {} : { reason: changed.buildNumberRelease.reason }),
        },
      ),
    );

    return detailOf(
      repositories,
      { value: changed, rowVersion },
      application,
      flavor,
      applicationCapabilities(guard.permissions, application),
    );
  });
}

function detailOf(
  repositories: Repositories,
  stored: Stored<Release>,
  application: Application,
  flavor: ApplicationFlavor,
  capabilities: ApplicationCapabilities,
): ReleaseDetail {
  const artifacts = repositories.releases.listArtifacts(stored.value.id);

  return {
    release: stored,
    application,
    flavor,
    artifacts,
    missingPlatforms: missingPlatforms(stored.value, storedKinds(artifacts)),
    deletionJob: repositories.deletionJobs.findOpenByRelease(stored.value.id)?.value ?? null,
    artifactRemovals: new Map(
      repositories.deletionJobs
        .listOpenArtifactJobs(stored.value.id)
        .flatMap(({ value }) => (value.artifactId === null ? [] : [[value.artifactId, value] as const])),
    ),
    deletionConfirmation: capabilities.deleteReleases
      ? deletionConfirmationPhrase({
          applicationSlug: application.slug,
          flavorKey: application.flavorsEnabled ? flavor.key : null,
          version: stored.value.version,
          buildNumber: stored.value.buildNumber,
        })
      : null,
    capabilities,
  };
}

function storedKinds(artifacts: readonly ReleaseArtifact[]): readonly ReleaseArtifact['kind'][] {
  return artifacts.filter((artifact) => artifact.storageState === 'stored').map((artifact) => artifact.kind);
}
