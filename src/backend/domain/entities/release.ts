import { artifactKindSpec, type ArtifactKind } from '../value-objects/artifact-kind.js';
import type { BuildNumber } from '../value-objects/build-number.js';
import type { CommitSha } from '../value-objects/commit-sha.js';
import { DomainError } from '../value-objects/domain-error.js';
import type { ApplicationId, FlavorId, ReleaseId, UserId } from '../value-objects/identifier.js';
import { PLATFORMS, type Platform } from '../value-objects/platform.js';
import type { Version } from '../value-objects/version.js';

export const PUBLICATION_STATUSES = ['draft', 'published', 'withdrawn'] as const;

export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const LIFECYCLE_STATES = ['active', 'pending_deletion', 'quarantined', 'purged'] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const RELEASE_TEXT_MAX_LENGTH = 50_000;

export interface WorkflowRun {
  readonly id: number;
  readonly attempt: number;
  readonly url: string;
}

/** Descriptive data of a release. Only the texts can be edited; the origin is fixed when the release is created. */
export interface ReleaseMetadata {
  readonly releaseNotes: string;
  readonly changelog: string;
  readonly gitRepository: string | null;
  readonly gitBranch: string | null;
  readonly gitTag: string | null;
  readonly workflowRun: WorkflowRun | null;
  readonly importedFrom: string | null;
}

export interface BuildNumberRelease {
  readonly at: Date;
  readonly by: UserId;
  readonly reason: string;
}

/** One build of a flavor, covering every required platform (IPA and APK/AAB) under one build number. */
export interface Release {
  readonly id: ReleaseId;
  readonly applicationId: ApplicationId;
  readonly flavorId: FlavorId;
  readonly version: Version;
  readonly buildNumber: BuildNumber;
  readonly requiredPlatforms: readonly Platform[];
  readonly gitCommitSha: CommitSha;
  readonly metadata: ReleaseMetadata;
  readonly publicationStatus: PublicationStatus;
  readonly lifecycleState: LifecycleState;
  readonly publishedAt: Date | null;
  readonly publishedBy: UserId | null;
  readonly deletionRequestedAt: Date | null;
  readonly deletionRequestedBy: UserId | null;
  readonly purgedAt: Date | null;
  /** Keeps the build number taken, even after the release was purged, until an administrator releases it. */
  readonly buildNumberReserved: boolean;
  readonly buildNumberRelease: BuildNumberRelease | null;
}

export interface NewRelease {
  readonly id: ReleaseId;
  readonly applicationId: ApplicationId;
  readonly flavorId: FlavorId;
  readonly version: Version;
  readonly buildNumber: BuildNumber;
  readonly requiredPlatforms: readonly Platform[];
  readonly gitCommitSha: CommitSha;
  readonly metadata: ReleaseMetadata;
}

/** What an uploaded file states about the build it came from. */
export interface ArtifactOrigin {
  readonly kind: ArtifactKind;
  readonly version: Version;
  readonly buildNumber: BuildNumber;
  readonly gitCommitSha: CommitSha;
}

export interface DeletionConfirmationSubject {
  readonly applicationSlug: string;
  /** `null` while the application does not use flavors, so the default flavor stays invisible. */
  readonly flavorKey: string | null;
  readonly version: Version;
  readonly buildNumber: BuildNumber;
}

export function createRelease(input: NewRelease): Release {
  const requiredPlatforms = PLATFORMS.filter((platform) => input.requiredPlatforms.includes(platform));

  if (requiredPlatforms.length === 0) {
    throw new DomainError('invalid_required_platforms', 'A release must require at least one platform.');
  }

  assertReleaseText(input.metadata.releaseNotes);
  assertReleaseText(input.metadata.changelog);

  return {
    ...input,
    requiredPlatforms,
    publicationStatus: 'draft',
    lifecycleState: 'active',
    publishedAt: null,
    publishedBy: null,
    deletionRequestedAt: null,
    deletionRequestedBy: null,
    purgedAt: null,
    buildNumberReserved: true,
    buildNumberRelease: null,
  };
}

export function updateReleaseTexts(
  release: Release,
  changes: Partial<Pick<ReleaseMetadata, 'releaseNotes' | 'changelog'>>,
): Release {
  assertLifecycle(release, 'active');
  const metadata = { ...release.metadata, ...changes };

  assertReleaseText(metadata.releaseNotes);
  assertReleaseText(metadata.changelog);
  return { ...release, metadata };
}

/**
 * Checks that an uploaded file belongs to this release. Android and iOS are usually built in separate
 * workflow runs; both attach to the same release, but only if they were built from the same state.
 */
export function assertArtifactAcceptable(release: Release, origin: ArtifactOrigin): void {
  assertLifecycle(release, 'active');

  if (origin.version.value !== release.version.value) {
    throw new DomainError('artifact_version_mismatch', 'Artifact version does not match the release.');
  }

  if (origin.buildNumber !== release.buildNumber) {
    throw new DomainError('artifact_build_number_mismatch', 'Artifact build number does not match the release.');
  }

  if (origin.gitCommitSha !== release.gitCommitSha) {
    throw new DomainError('artifact_commit_mismatch', 'Artifact was built from a different commit than the release.');
  }

  const spec = artifactKindSpec(origin.kind);

  if (spec.platform !== null && !release.requiredPlatforms.includes(spec.platform)) {
    throw new DomainError('platform_not_required', 'The release does not cover the platform of this artifact.');
  }

  if (release.publicationStatus === 'published' && spec.providesPlatformBuild) {
    throw new DomainError(
      'artifact_locked_after_publication',
      'Platform builds cannot be added to a published release; withdraw it first.',
    );
  }
}

/** Required platforms for which no stored artifact provides a build yet. */
export function missingPlatforms(release: Release, storedKinds: readonly ArtifactKind[]): readonly Platform[] {
  const provided = new Set(
    storedKinds
      .map(artifactKindSpec)
      .flatMap((spec) => (spec.providesPlatformBuild && spec.platform ? [spec.platform] : [])),
  );

  return release.requiredPlatforms.filter((platform) => !provided.has(platform));
}

/** `actor` is `null` when a workflow publishes automatically. */
export function publishRelease(
  release: Release,
  storedKinds: readonly ArtifactKind[],
  now: Date,
  actor: UserId | null,
): Release {
  assertLifecycle(release, 'active');

  if (release.publicationStatus === 'published') {
    throw new DomainError('invalid_release_state', 'Release is already published.');
  }

  if (missingPlatforms(release, storedKinds).length > 0) {
    throw new DomainError(
      'release_incomplete',
      'Every required platform needs a build before the release can be published.',
    );
  }

  return { ...release, publicationStatus: 'published', publishedAt: now, publishedBy: actor };
}

export function withdrawRelease(release: Release): Release {
  assertLifecycle(release, 'active');

  if (release.publicationStatus !== 'published') {
    throw new DomainError('invalid_release_state', 'Only a published release can be withdrawn.');
  }

  return { ...release, publicationStatus: 'withdrawn' };
}

export function isDownloadable(release: Release): boolean {
  return release.lifecycleState === 'active' && release.publicationStatus === 'published';
}

/** The text a user has to type to confirm the deletion of a release, e.g. `k-mobile/production 4.13.0 (125)`. */
export function deletionConfirmationPhrase(subject: DeletionConfirmationSubject): string {
  const name = subject.flavorKey === null ? subject.applicationSlug : `${subject.applicationSlug}/${subject.flavorKey}`;
  return `${name} ${subject.version.value} (${subject.buildNumber})`;
}

export function assertDeletionConfirmed(subject: DeletionConfirmationSubject, confirmation: string): void {
  if (confirmation.trim() !== deletionConfirmationPhrase(subject)) {
    throw new DomainError('confirmation_mismatch', 'Confirmation text does not match the release.');
  }
}

export function requestReleaseDeletion(release: Release, now: Date, actor: UserId): Release {
  assertLifecycle(release, 'active');
  return { ...release, lifecycleState: 'pending_deletion', deletionRequestedAt: now, deletionRequestedBy: actor };
}

export function cancelReleaseDeletion(release: Release): Release {
  assertLifecycle(release, 'pending_deletion');
  return { ...release, lifecycleState: 'active', deletionRequestedAt: null, deletionRequestedBy: null };
}

export function markReleaseQuarantined(release: Release): Release {
  assertLifecycle(release, 'pending_deletion');
  return { ...release, lifecycleState: 'quarantined' };
}

/** A restored release comes back withdrawn rather than published, so that it is released again deliberately. */
export function restoreRelease(release: Release): Release {
  assertLifecycle(release, 'quarantined');

  return {
    ...release,
    lifecycleState: 'active',
    publicationStatus: release.publicationStatus === 'published' ? 'withdrawn' : release.publicationStatus,
    deletionRequestedAt: null,
    deletionRequestedBy: null,
  };
}

export function markReleasePurged(release: Release, now: Date): Release {
  assertLifecycle(release, 'quarantined');
  return { ...release, lifecycleState: 'purged', purgedAt: now };
}

/**
 * Frees the build number of a purged release for reuse. Not possible while the release is quarantined,
 * because restoring it would then collide with the release that took over the number.
 */
export function releaseBuildNumber(release: Release, decision: BuildNumberRelease): Release {
  assertLifecycle(release, 'purged');

  if (!release.buildNumberReserved) {
    throw new DomainError('invalid_release_state', 'Build number has already been released.');
  }

  const reason = decision.reason.trim();

  if (reason.length === 0) {
    throw new DomainError('reason_required', 'Releasing a build number requires a reason.');
  }

  return { ...release, buildNumberReserved: false, buildNumberRelease: { ...decision, reason } };
}

function assertLifecycle(release: Release, expected: LifecycleState): void {
  if (release.lifecycleState !== expected) {
    throw new DomainError('invalid_release_state', `Operation requires the release to be ${expected}.`);
  }
}

function assertReleaseText(text: string): void {
  if (text.length > RELEASE_TEXT_MAX_LENGTH) {
    throw new DomainError(
      'invalid_release_notes',
      `Release notes and changelog are limited to ${RELEASE_TEXT_MAX_LENGTH} characters.`,
    );
  }
}
