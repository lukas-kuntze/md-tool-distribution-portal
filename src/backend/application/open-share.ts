import type { Asset, ApplicationPresentation } from '../domain/entities/asset.js';
import type { Application, ApplicationFlavor } from '../domain/entities/application.js';
import type { Project } from '../domain/entities/project.js';
import type { ReleaseArtifact } from '../domain/entities/release-artifact.js';
import { isDownloadable, type Release } from '../domain/entities/release.js';
import { isShareLinkActive, type ReleaseSelection, type ShareLink } from '../domain/entities/share-link.js';
import type { ArtifactStorage, ByteRange } from '../domain/ports/artifact-storage.js';
import type { AuditEntry } from '../domain/ports/audit-log.js';
import type { Clock } from '../domain/ports/clock.js';
import type { TokenGenerator } from '../domain/ports/token-generator.js';
import type { Stored } from '../domain/ports/stored.js';
import type { Repositories, UnitOfWork } from '../domain/ports/unit-of-work.js';
import { artifactKindSpec } from '../domain/value-objects/artifact-kind.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { ApplicationId, ArtifactId, FlavorId } from '../domain/value-objects/identifier.js';
import { downloadFileName, type Download } from './download-artifact.js';
import { installManifest, type InstallManifest } from './install-ios-artifact.js';
import { requireRelease, type ReleaseContext } from './lookups.js';
import type { RequestContext } from './request-context.js';

/** Newest published releases per application shown on a shared page. */
const RELEASES_PER_APPLICATION = 50;

export interface ShareDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly tokens: TokenGenerator;
}

export interface SharedRelease {
  readonly release: Release;
  readonly flavor: ApplicationFlavor;
  /** Only installable files (APK, IPA); build by-products such as dSYM or mapping files stay internal. */
  readonly artifacts: readonly ReleaseArtifact[];
}

export interface SharedApplication {
  readonly application: Application;
  readonly presentation: ApplicationPresentation;
  readonly releases: readonly SharedRelease[];
}

export interface SharedContent {
  readonly link: ShareLink;
  readonly project: Project;
  readonly applications: readonly SharedApplication[];
}

interface ResolvedShare {
  readonly link: ShareLink;
  readonly project: Project;
  readonly applications: readonly Application[];
}

/**
 * What a share link shows: the published, active releases of the shared project or application, without
 * drafts, withdrawn or deleted releases and without archived applications or flavors. Every view is audited
 * with the link as actor.
 */
export function viewShare(dependencies: ShareDependencies, token: string, request: RequestContext): SharedContent {
  const now = dependencies.clock.now();

  return dependencies.unitOfWork.transaction((repositories) => {
    const share = resolveShare(repositories, dependencies.tokens, token, now);
    const applications = share.applications.map((application) =>
      publishedApplication(repositories, application, share.link.releases),
    );

    repositories.auditLog.append(
      shareAuditEntry(share, request, now, 'share_link.viewed', { type: 'share_link', id: share.link.id }, null, {}),
    );
    return { ...share, applications };
  });
}

/** Streams an installable artifact of the share; the same rules as on the shared page apply. */
export async function openSharedDownload(
  dependencies: ShareDependencies & { readonly storage: ArtifactStorage },
  token: string,
  request: RequestContext,
  input: { readonly artifactId: ArtifactId; readonly selectRange?: (sizeBytes: number) => ByteRange | null },
): Promise<Download> {
  const now = dependencies.clock.now();
  const { share, context, artifact } = dependencies.unitOfWork.read((repositories) => {
    const resolved = resolveShare(repositories, dependencies.tokens, token, now);
    return { share: resolved, ...requireSharedArtifact(repositories, resolved, input.artifactId) };
  });
  const range = input.selectRange?.(artifact.sizeBytes) ?? null;
  const content = await dependencies.storage.read(artifact.storageKey, range ?? undefined);

  dependencies.unitOfWork.transaction(({ auditLog }) =>
    auditLog.append(
      shareAuditEntry(share, request, now, 'artifact.downloaded', { type: 'artifact', id: artifact.id }, context, {
        releaseId: artifact.releaseId,
        kind: artifact.kind,
        range,
        shareLinkId: share.link.id,
      }),
    ),
  );

  return { artifact, fileName: downloadFileName(context, artifact), content, range };
}

/** The icon of a shared application; `null` when it has none. */
export async function openSharedIcon(
  dependencies: ShareDependencies & { readonly storage: ArtifactStorage },
  token: string,
  applicationId: ApplicationId,
): Promise<{ readonly icon: Asset; readonly content: AsyncIterable<Uint8Array> } | null> {
  const now = dependencies.clock.now();
  const icon = dependencies.unitOfWork.read((repositories) => {
    const share = resolveShare(repositories, dependencies.tokens, token, now);

    if (!share.applications.some((application) => application.id === applicationId)) {
      throw new DomainError('application_not_found', 'The application does not exist.');
    }

    return repositories.applications.findPresentation(applicationId).icon;
  });

  return icon === null ? null : { icon, content: await dependencies.storage.read(icon.storageKey) };
}

/** Manifest for installing a shared IPA over `itms-services`; the link itself authorizes the device. */
export function describeSharedInstall(
  dependencies: ShareDependencies,
  token: string,
  artifactId: ArtifactId,
): InstallManifest {
  const now = dependencies.clock.now();

  return dependencies.unitOfWork.read((repositories) => {
    const share = resolveShare(repositories, dependencies.tokens, token, now);
    const { context, artifact } = requireSharedArtifact(repositories, share, artifactId);
    return installManifest({ ...context, artifact });
  });
}

function resolveShare(repositories: Repositories, tokens: TokenGenerator, token: string, now: Date): ResolvedShare {
  const link = repositories.shareLinks.findByTokenHash(tokens.hash(token));
  const notFound = new DomainError('share_link_not_found', 'The share link does not exist or is no longer valid.');

  if (link === null || !isShareLinkActive(link, now)) {
    throw notFound;
  }

  const applications =
    link.scope.type === 'project'
      ? repositories.applications.listByProject(link.scope.projectId).map((stored) => stored.value)
      : [repositories.applications.findById(link.scope.applicationId)?.value].filter(
          (application): application is Application => application !== undefined,
        );
  const projectId = link.scope.type === 'project' ? link.scope.projectId : applications[0]?.projectId;
  const project = projectId === undefined ? undefined : repositories.projects.findById(projectId)?.value;
  const visible = applications.filter((application) => application.status === 'active');

  // An archived project or a shared application that was archived ends the link without revoking it.
  if (
    project === undefined ||
    project.status !== 'active' ||
    (link.scope.type === 'application' && visible.length === 0)
  ) {
    throw notFound;
  }

  return { link, project, applications: visible };
}

/**
 * The published, active releases of an application with their installable files, grouped by flavor in the
 * configured flavor order and newest first within a flavor. Shared by share links and the download page.
 */
export function publishedApplication(
  repositories: Repositories,
  application: Application,
  selection: ReleaseSelection,
): SharedApplication {
  const flavors = new Map(
    repositories.applications
      .listFlavors(application.id)
      .map((stored) => stored.value)
      .filter((flavor) => flavor.status !== 'archived')
      .map((flavor) => [flavor.id, flavor]),
  );
  // "latest" asks per flavor, so that a flavor with few releases is not crowded out by a busy one.
  const published =
    selection === 'all'
      ? repositories.releases.list({ ...PUBLISHED, applicationId: application.id, limit: RELEASES_PER_APPLICATION })
      : [...flavors.keys()].flatMap((flavorId) => newestPublished(repositories, application.id, flavorId));
  const order = [...flavors.keys()];
  const releases = published
    .toSorted((left, right) => order.indexOf(left.value.flavorId) - order.indexOf(right.value.flavorId))
    .flatMap(({ value: release }): SharedRelease[] => {
      const flavor = flavors.get(release.flavorId);
      return flavor === undefined
        ? []
        : [
            {
              release,
              flavor,
              artifacts: repositories.releases
                .listArtifacts(release.id)
                .filter((artifact) => isShareable(repositories, artifact)),
            },
          ];
    });

  return { application, presentation: repositories.applications.findPresentation(application.id), releases };
}

/** Published, active releases, newest version first. */
const PUBLISHED = { publicationStatuses: ['published'], lifecycleStates: ['active'], offset: 0 } as const;

function newestPublished(
  repositories: Repositories,
  applicationId: ApplicationId,
  flavorId: FlavorId,
): readonly Stored<Release>[] {
  return repositories.releases.list({ ...PUBLISHED, applicationId, flavorId, limit: 1 });
}

function requireSharedArtifact(
  repositories: Repositories,
  share: ResolvedShare,
  artifactId: ArtifactId,
): { readonly context: ReleaseContext; readonly artifact: ReleaseArtifact } {
  const artifact = repositories.releases.findArtifact(artifactId);
  const context = artifact === null ? null : requireRelease(repositories, artifact.releaseId);

  if (
    artifact === null ||
    context === null ||
    !isShareable(repositories, artifact) ||
    !isDownloadable(context.stored.value) ||
    context.flavor.status === 'archived' ||
    (share.link.releases === 'latest' &&
      newestPublished(repositories, context.application.id, context.flavor.id)[0]?.value.id !==
        context.stored.value.id) ||
    !share.applications.some((application) => application.id === context.application.id)
  ) {
    throw new DomainError('artifact_not_found', 'The artifact does not exist.');
  }

  return { context, artifact };
}

function isShareable(repositories: Repositories, artifact: ReleaseArtifact): boolean {
  return (
    artifact.storageState === 'stored' &&
    artifactKindSpec(artifact.kind).installable &&
    repositories.deletionJobs.findOpenByArtifact(artifact.id) === null
  );
}

function shareAuditEntry(
  share: ResolvedShare,
  request: RequestContext,
  now: Date,
  action: string,
  target: AuditEntry['target'],
  context: ReleaseContext | null,
  details: Readonly<Record<string, unknown>>,
): AuditEntry {
  return {
    occurredAt: now,
    actor: { type: 'share', label: share.link.label },
    action,
    target,
    projectId: share.project.id,
    applicationId:
      context?.application.id ?? (share.link.scope.type === 'application' ? share.link.scope.applicationId : null),
    outcome: 'success',
    correlationId: request.correlationId,
    clientIp: request.clientIp,
    userAgent: request.userAgent,
    details: { shareLinkId: share.link.id, ...details },
  };
}
