import type { ReleaseArtifact } from '../domain/entities/release-artifact.js';
import { isDownloadable } from '../domain/entities/release.js';
import type { ArtifactStorage, ByteRange } from '../domain/ports/artifact-storage.js';
import type { Repositories } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { ArtifactId } from '../domain/value-objects/identifier.js';
import type { Target } from '../domain/value-objects/scope.js';
import { applicationTarget, auditChange, authorizedRead, type Guard } from './authorization.js';
import { requireRelease, type ReleaseContext } from './lookups.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';
import { canDownloadPublished } from './visibility.js';

export interface DownloadDependencies extends Pick<UseCaseDependencies, 'unitOfWork' | 'clock'> {
  readonly storage: ArtifactStorage;
}

export interface Download {
  readonly artifact: ReleaseArtifact;
  /** Suggested file name for the browser, built from metadata only. */
  readonly fileName: string;
  readonly content: AsyncIterable<Uint8Array>;
  readonly range: ByteRange | null;
}

/**
 * Hands out the content of a stored artifact. Published releases need `artifacts.download` (or an application
 * visible to the whole organisation); drafts additionally need `releases.read`. Releases in deletion are never
 * served, so no new download starts once a deletion was requested.
 */
export async function openArtifactDownload(
  dependencies: DownloadDependencies,
  actor: Actor,
  request: RequestContext,
  input: {
    readonly artifactId: ArtifactId;
    /** Picks the requested part once the size is known; `null` for the whole file. */
    readonly selectRange?: (sizeBytes: number) => ByteRange | null;
  },
): Promise<Download> {
  const context = contextOf(dependencies, actor, request);
  const { artifact, fileName, target } = authorizedRead(context, (repositories, guard) =>
    requireReadableArtifact(repositories, guard, input.artifactId),
  );
  const range = input.selectRange?.(artifact.sizeBytes) ?? null;
  const content = await dependencies.storage.read(artifact.storageKey, range ?? undefined);

  dependencies.unitOfWork.transaction(({ auditLog }) =>
    auditLog.append(
      auditChange(
        context,
        'artifact.downloaded',
        target,
        { type: 'artifact', id: artifact.id },
        {
          releaseId: artifact.releaseId,
          kind: artifact.kind,
          range,
        },
      ),
    ),
  );

  return { artifact, fileName, content, range };
}

export interface ReadableArtifact extends ReleaseContext {
  readonly artifact: ReleaseArtifact;
  readonly fileName: string;
  readonly target: Target;
}

/**
 * The access rule for artifact content, shared by downloads and installation links. Releases in deletion are
 * reported as missing, so that no new download or installation starts once a deletion was requested.
 */
export function requireReadableArtifact(
  repositories: Repositories,
  guard: Guard,
  artifactId: ArtifactId,
): ReadableArtifact {
  const found = repositories.releases.findArtifact(artifactId);

  // An artifact whose removal was requested is gone for users at once, before the worker moves the file.
  if (
    found === null ||
    found.storageState !== 'stored' ||
    repositories.deletionJobs.findOpenByArtifact(found.id) !== null
  ) {
    throw new DomainError('artifact_not_found', 'The artifact does not exist.');
  }

  const context = requireRelease(repositories, found.releaseId);
  const { stored, application } = context;
  const release = stored.value;
  const target = applicationTarget(application);
  const subject = { type: 'artifact', id: found.id };

  if (release.lifecycleState !== 'active') {
    throw new DomainError('artifact_not_found', 'The artifact does not exist.');
  }

  if (!isDownloadable(release)) {
    guard.require('releases.read', target, subject);
    guard.require('artifacts.download', target, subject);
  } else if (!canDownloadPublished(guard.permissions, application)) {
    guard.require('artifacts.download', target, subject);
  }

  return { ...context, artifact: found, fileName: downloadFileName(context, found), target };
}

/** Download name built from metadata only, e.g. `k-mobile-production-4.13.0-125.apk`. */
export function downloadFileName({ application, flavor, stored }: ReleaseContext, artifact: ReleaseArtifact): string {
  const flavorPart = application.flavorsEnabled ? `-${flavor.key}` : '';
  const release = stored.value;
  return `${application.slug}${flavorPart}-${release.version.value}-${release.buildNumber}${extensionOf(artifact.originalFileName)}`;
}

function extensionOf(fileName: string): string {
  const match = /\.[a-z0-9]{1,8}$/i.exec(fileName);
  return match === null ? '' : match[0].toLowerCase();
}
