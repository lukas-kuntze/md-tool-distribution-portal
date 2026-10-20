import type { LifecycleState, PublicationStatus } from '../entities/release.js';
import type { ApplicationId, ProjectId, ReleaseId, UserId } from '../value-objects/identifier.js';

/** Release counts of one application; purged tombstones are not counted. */
export interface ApplicationReleaseStatistics {
  readonly applicationId: ApplicationId;
  /** Published and active, i.e. what users can install. */
  readonly published: number;
  readonly drafts: number;
  readonly withdrawn: number;
  /** Pending deletion or in quarantine. */
  readonly inDeletion: number;
  readonly latestPublished: {
    readonly releaseId: ReleaseId;
    readonly version: string;
    readonly buildNumber: number;
    readonly publishedAt: Date;
  } | null;
}

export interface RecentRelease {
  readonly releaseId: ReleaseId;
  readonly applicationId: ApplicationId;
  readonly version: string;
  readonly buildNumber: number;
  readonly publicationStatus: PublicationStatus;
  readonly lifecycleState: LifecycleState;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
}

/**
 * Read-only aggregates for the dashboard. They only count; which applications a user may see is decided by
 * the use case, which passes the visible ids.
 */
export interface StatisticsQueries {
  releasesByApplication(applicationIds: readonly ApplicationId[]): readonly ApplicationReleaseStatistics[];
  /** Newest first, excluding purged releases; `publishedOnly` for users who may not see drafts. */
  recentReleases(
    applicationIds: readonly ApplicationId[],
    publishedOnly: readonly ApplicationId[],
    limit: number,
  ): readonly RecentRelease[];
  /** Successful artifact downloads since a point in time, by users and through share links. */
  downloadsByApplication(applicationIds: readonly ApplicationId[], since: Date): ReadonlyMap<ApplicationId, number>;
  /** Releases in quarantine whose final deletion is due before the given time, soonest first. */
  quarantineEndingBefore(applicationIds: readonly ApplicationId[], before: Date): readonly QuarantineEnding[];
  /** Active share links of these projects (including their applications' links) and applications. */
  shareLinkCounts(
    projectIds: readonly ProjectId[],
    applicationIds: readonly ApplicationId[],
    now: Date,
    expiringBefore: Date,
  ): { readonly active: number; readonly expiringSoon: number };
  /** Start of the user's sign-in before the current one, `null` on the first sign-in. */
  previousSignIn(userId: UserId): Date | null;
  /** Bytes and artifacts by project, stored and in quarantine. */
  storageUsage(): StorageUsage;
}

export interface StorageUsageEntry {
  readonly storedBytes: number;
  readonly storedArtifacts: number;
  readonly quarantinedBytes: number;
  readonly quarantinedArtifacts: number;
  readonly missingArtifacts: number;
}

export interface StorageUsage {
  readonly total: StorageUsageEntry;
  readonly projects: readonly (StorageUsageEntry & { readonly projectId: ProjectId; readonly name: string })[];
}

export interface QuarantineEnding {
  readonly releaseId: ReleaseId;
  readonly applicationId: ApplicationId;
  readonly version: string;
  readonly buildNumber: number;
  readonly purgeAfter: Date;
}
