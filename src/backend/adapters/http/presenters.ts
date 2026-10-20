import type { PlatformSettings } from '../../application/get-platform-settings.js';
import type { UserOverviewEntry } from '../../application/manage-users.js';
import type { CiBindingView } from '../../application/manage-ci-bindings.js';
import type { ApplicationView } from '../../application/manage-applications.js';
import type { AssignmentView, PermissionExplanation } from '../../application/manage-access.js';
import type { ProjectView } from '../../application/manage-projects.js';
import type { ReleaseDetail, ReleaseListEntry } from '../../application/manage-releases.js';
import type { CurrentUser } from '../../application/get-current-user.js';
import type { ShareLinkView } from '../../application/manage-share-links.js';
import type { SharedApplication, SharedContent } from '../../application/open-share.js';
import type { ApplicationFlavor } from '../../domain/entities/application.js';
import type { DeletionJob } from '../../domain/entities/deletion-job.js';
import type { ReleaseArtifact } from '../../domain/entities/release-artifact.js';
import type { Role } from '../../domain/entities/role-assignment.js';
import type { Release } from '../../domain/entities/release.js';
import { isShareLinkActive } from '../../domain/entities/share-link.js';
import type { AuditRecord } from '../../domain/ports/audit-log.js';
import type { Stored } from '../../domain/ports/stored.js';
import type { UserSummary } from '../../domain/ports/user-repository.js';
import { artifactKindSpec } from '../../domain/value-objects/artifact-kind.js';
import type { Scope } from '../../domain/value-objects/scope.js';
import type {
  ApplicationDto,
  ArtifactDto,
  AssignmentDto,
  AuditEntryDto,
  CiBindingDto,
  CurrentUserDto,
  DeletionJobDto,
  DeletionStatusDto,
  FlavorDto,
  PermissionExplanationDto,
  PlatformSettingsDto,
  ProjectDto,
  ReleaseDetailDto,
  ReleaseSummaryDto,
  RoleDto,
  ScopeDto,
  SharedApplicationDto,
  SharedContentDto,
  ShareLinkDto,
  UserOverviewDto,
  UserSummaryDto,
} from '../../../shared/types/api.js';

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

export function presentCurrentUser(current: CurrentUser): CurrentUserDto {
  const { user, login } = current.summary;
  return {
    id: user.id,
    displayName: user.displayName,
    login,
    avatarUrl: user.avatarUrl,
    capabilities: current.capabilities,
    preferences: current.preferences,
  };
}

export function presentProject(view: ProjectView): ProjectDto {
  const { value: project, rowVersion } = view.project;

  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: project.description,
    status: project.status,
    archivedAt: iso(project.archivedAt),
    applicationCount: view.applicationCount,
    rowVersion,
    capabilities: view.capabilities,
    iconUrl: iconUrlOf(`/api/projects/${project.id}/icon`, view.icon),
  };
}

export function presentFlavor(stored: Stored<ApplicationFlavor>): FlavorDto {
  const { value: flavor, rowVersion } = stored;

  return {
    id: flavor.id,
    key: flavor.key,
    name: flavor.name,
    isDefault: flavor.isDefault,
    status: flavor.status,
    bundleIdentifiers: { ...flavor.bundleIdentifiers },
    hasReleases: flavor.hasReleases,
    rowVersion,
  };
}

export function presentApplication(view: ApplicationView): ApplicationDto {
  const { value: application, rowVersion } = view.application;

  return {
    id: application.id,
    projectId: application.projectId,
    slug: application.slug,
    name: application.name,
    description: application.description,
    framework: application.framework,
    platforms: application.platforms,
    flavorsEnabled: application.flavorsEnabled,
    visibility: application.visibility,
    status: application.status,
    rowVersion,
    flavors: view.flavors.map(presentFlavor),
    capabilities: view.capabilities,
    installNotes: view.presentation.installNotes,
    iconUrl: iconUrlOf(`/api/applications/${application.id}/icon`, view.presentation.icon),
  };
}

/** The hash in the query string lets browsers cache the icon until it is replaced. */
export function iconUrlOf(path: string, icon: { readonly sha256: string } | null): string | null {
  return icon === null ? null : `${path}?v=${icon.sha256.slice(0, 16)}`;
}

export function presentReleaseSummary(entry: ReleaseListEntry): ReleaseSummaryDto {
  return summaryOf(entry.release, entry.flavorKey, entry.missingPlatforms);
}

export function presentReleaseDetail(detail: ReleaseDetail): ReleaseDetailDto {
  const release = detail.release.value;

  return {
    ...summaryOf(detail.release, detail.flavor.key, detail.missingPlatforms),
    releaseNotes: release.metadata.releaseNotes,
    changelog: release.metadata.changelog,
    gitRepository: release.metadata.gitRepository,
    workflowRun: release.metadata.workflowRun,
    buildNumberReserved: release.buildNumberReserved,
    purgedAt: iso(release.purgedAt),
    artifacts: detail.artifacts.map((artifact) => presentArtifact(artifact, detail.artifactRemovals.get(artifact.id))),
    deletion: detail.deletionJob === null ? null : deletionStatusOf(detail.deletionJob),
    deletionConfirmation: detail.deletionConfirmation,
    capabilities: detail.capabilities,
  };
}

export function presentArtifact(artifact: ReleaseArtifact, removal?: DeletionJob): ArtifactDto {
  return {
    removal: removal === undefined ? null : deletionStatusOf(removal),
    id: artifact.id,
    kind: artifact.kind,
    platform: artifact.platform,
    abi: artifact.abi,
    buildMode: artifact.buildMode,
    originalFileName: artifact.originalFileName,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    storageState: artifact.storageState,
    installable: artifactKindSpec(artifact.kind).installable,
    uploadedAt: artifact.uploadedAt.toISOString(),
  };
}

export function presentRole(role: Role): RoleDto {
  return { id: role.id, key: role.key, permissions: [...role.permissions].sort() };
}

export function presentUser(summary: UserSummary): UserSummaryDto {
  const { user } = summary;

  return {
    id: user.id,
    displayName: user.displayName,
    login: summary.login,
    gitHubId: summary.gitHubId,
    avatarUrl: user.avatarUrl,
    status: user.status,
    lastLoginAt: iso(summary.lastLoginAt),
  };
}

export function presentAssignment(view: AssignmentView): AssignmentDto {
  const { grant } = view.record;

  return {
    id: grant.assignmentId,
    role: view.role === null ? null : { id: view.role.id, key: view.role.key },
    principal:
      grant.principal.type === 'user'
        ? {
            type: 'user',
            userId: grant.principal.userId,
            user: view.principal === null ? null : presentUser(view.principal),
          }
        : { type: 'team', teamId: grant.principal.teamId },
    scope: presentScope(grant.scope),
    source: view.record.source,
    reason: view.record.reason,
    grantedAt: view.record.grantedAt.toISOString(),
    expiresAt: iso(grant.expiresAt),
    revokedAt: iso(grant.revokedAt),
    inherited: view.inherited,
  };
}

export function presentExplanation(explanation: PermissionExplanation): PermissionExplanationDto {
  return {
    permission: explanation.permission,
    allowed: explanation.allowed,
    grants: explanation.grants.map((grant) => ({
      assignmentId: grant.assignmentId,
      roleKey: grant.roleKey,
      scope: presentScope(grant.scope),
    })),
  };
}

export function presentAuditEntry(record: AuditRecord): AuditEntryDto {
  return {
    id: record.id,
    occurredAt: record.occurredAt.toISOString(),
    actor: {
      type: record.actor.type,
      label: record.actor.label,
      userId: record.actor.type === 'user' ? record.actor.userId : null,
    },
    action: record.action,
    target: record.target,
    projectId: record.projectId,
    applicationId: record.applicationId,
    outcome: record.outcome,
    details: record.details,
  };
}

export function presentDeletionJob(stored: Stored<DeletionJob>): DeletionJobDto {
  const job = stored.value;

  return {
    ...deletionStatusOf(job),
    releaseId: job.releaseId,
    artifactId: job.artifactId,
    failedPhase: job.failedPhase,
    nextAttemptAt: iso(job.nextAttemptAt),
    completedAt: iso(job.completedAt),
    rowVersion: stored.rowVersion,
  };
}

export function presentScope(scope: Scope): ScopeDto {
  return { ...scope };
}

function deletionStatusOf(job: DeletionJob): DeletionStatusDto {
  return {
    jobId: job.id,
    state: job.state,
    requestedAt: job.requestedAt.toISOString(),
    reason: job.reason,
    purgeAfter: iso(job.purgeAfter),
    attempts: job.attempts,
    lastErrorCode: job.lastErrorCode,
    requiresManualReview: job.requiresManualReview,
  };
}

function summaryOf(
  stored: Stored<Release>,
  flavorKey: string,
  missing: ReleaseSummaryDto['missingPlatforms'],
): ReleaseSummaryDto {
  const release = stored.value;

  return {
    id: release.id,
    applicationId: release.applicationId,
    flavorId: release.flavorId,
    flavorKey,
    version: release.version.value,
    buildNumber: release.buildNumber,
    requiredPlatforms: release.requiredPlatforms,
    missingPlatforms: missing,
    publicationStatus: release.publicationStatus,
    lifecycleState: release.lifecycleState,
    publishedAt: iso(release.publishedAt),
    gitCommitSha: release.gitCommitSha,
    gitBranch: release.metadata.gitBranch,
    gitTag: release.metadata.gitTag,
    rowVersion: stored.rowVersion,
  };
}

export function presentShareLink(view: ShareLinkView, now: Date): ShareLinkDto {
  const { link } = view;

  return {
    id: link.id,
    label: link.label,
    releases: link.releases,
    scope:
      link.scope.type === 'project'
        ? { type: 'project', projectId: link.scope.projectId }
        : { type: 'application', applicationId: link.scope.applicationId },
    scopeName: view.scopeName,
    createdAt: link.createdAt.toISOString(),
    createdBy: view.createdBy,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    revokedAt: link.revokedAt?.toISOString() ?? null,
    active: isShareLinkActive(link, now),
  };
}

/** Addresses of the public share routes; the secret is part of the path, as iOS sends no cookies. */
export interface ShareAddresses {
  readonly publicUrl: string;
  readonly token: string;
}

export function presentSharedContent(content: SharedContent, addresses: ShareAddresses): SharedContentDto {
  const root = new URL(`/public/shares/${addresses.token}/`, addresses.publicUrl).toString();

  return {
    label: content.link.label,
    releases: content.link.releases,
    expiresAt: content.link.expiresAt?.toISOString() ?? null,
    project: { name: content.project.name, description: content.project.description },
    applications: content.applications.map((shared) =>
      presentPublishedApplication(shared, {
        icon: (id) => `${root}applications/${id}/icon`,
        download: (id) => `${root}artifacts/${id}/download`,
        install: (id) =>
          `itms-services://?action=download-manifest&url=${encodeURIComponent(`${root}artifacts/${id}/manifest.plist`)}`,
      }),
    ),
  };
}

/** Where the files of a published application are fetched from: a share link or the signed-in API. */
export interface PublishedAddresses {
  readonly icon: (applicationId: string) => string;
  readonly download: (artifactId: string) => string;
  /** `itms-services` address of an IPA; `null` where it has to be requested per installation. */
  readonly install: (artifactId: string) => string | null;
}

export function presentPublishedApplication(
  { application, presentation, releases }: SharedApplication,
  addresses: PublishedAddresses,
): SharedApplicationDto {
  return {
    id: application.id,
    name: application.name,
    description: application.description,
    platforms: application.platforms,
    installNotes: presentation.installNotes,
    iconUrl: iconUrlOf(addresses.icon(application.id), presentation.icon),
    releases: releases.map(({ release, flavor, artifacts }) => ({
      id: release.id,
      version: release.version.value,
      buildNumber: release.buildNumber,
      flavorName: application.flavorsEnabled ? flavor.name : null,
      publishedAt: release.publishedAt?.toISOString() ?? null,
      releaseNotes: release.metadata.releaseNotes,
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        platform: artifact.platform,
        sizeBytes: artifact.sizeBytes,
        downloadUrl: addresses.download(artifact.id),
        installUrl: artifact.kind === 'ipa' ? addresses.install(artifact.id) : null,
      })),
    })),
  };
}

export function presentCiBinding(view: CiBindingView): CiBindingDto {
  const { binding } = view;

  return {
    id: binding.id,
    applicationId: binding.applicationId,
    repositoryId: binding.repositoryId,
    repositoryName: binding.repositoryName,
    refPattern: binding.refPattern,
    environment: binding.environment,
    createdAt: binding.createdAt.toISOString(),
    createdBy: view.createdBy,
    revokedAt: binding.revokedAt?.toISOString() ?? null,
  };
}

export function presentUserOverview(entry: UserOverviewEntry): UserOverviewDto {
  return {
    ...presentUser(entry.summary),
    roles: entry.roles.map((role) => ({
      roleKey: role.roleKey,
      scope: presentScope(role.scope),
      scopeName: role.scopeName,
      viaTeam: role.viaTeam,
      expiresAt: iso(role.expiresAt),
    })),
  };
}

export function presentPlatformSettings(settings: PlatformSettings): PlatformSettingsDto {
  const minutes = (ms: number): number => ms / 60_000;

  return {
    version: settings.version,
    nodeVersion: settings.nodeVersion,
    publicUrl: settings.publicUrl,
    gitHub: settings.gitHub,
    bootstrapAdministrators: settings.bootstrapAdministrators,
    ci: settings.ci,
    storage: settings.storage,
    limits: {
      maxUploadMegabytes: settings.limits.maxUploadBytes / (1024 * 1024),
      quarantineDays: minutes(settings.limits.quarantineRetentionMs) / (60 * 24),
      installLinkMinutes: minutes(settings.limits.installLinkLifetimeMs),
      sessionAbsoluteHours: minutes(settings.limits.sessionAbsoluteMs) / 60,
      sessionIdleMinutes: minutes(settings.limits.sessionIdleMs),
    },
    worker: {
      pollSeconds: settings.worker.pollMs / 1000,
      leaseMinutes: minutes(settings.worker.leaseMs),
      reconcileHours: minutes(settings.worker.reconcileMs) / 60,
    },
  };
}
