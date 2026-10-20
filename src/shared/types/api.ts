/** Response bodies of the administration API, shared by backend and frontend. Timestamps are ISO-8601 strings. */

export type PlatformDto = 'android' | 'ios';

export interface ApiErrorDto {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly issues?: readonly { readonly path: string; readonly message: string }[];
  };
}

export interface GlobalCapabilitiesDto {
  readonly createProjects: boolean;
  readonly managePermissions: boolean;
  readonly readAudit: boolean;
  readonly manageStorage: boolean;
  readonly manageSettings: boolean;
  readonly purgeReleases: boolean;
  readonly managesAnyPermissions: boolean;
  readonly administers: boolean;
}

export interface CurrentUserDto {
  readonly id: string;
  readonly displayName: string;
  readonly login: string | null;
  readonly avatarUrl: string | null;
  readonly capabilities: GlobalCapabilitiesDto;
  readonly preferences: PreferencesDto;
}

export interface ProjectCapabilitiesDto {
  readonly update: boolean;
  readonly createApplications: boolean;
  readonly managePermissions: boolean;
  readonly readAudit: boolean;
  readonly manageShares: boolean;
}

export interface ProjectDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly status: 'active' | 'archived';
  readonly archivedAt: string | null;
  readonly applicationCount: number;
  readonly rowVersion: number;
  readonly capabilities: ProjectCapabilitiesDto;
  /** Versioned URL of the icon, `null` without icon. */
  readonly iconUrl: string | null;
}

export interface ApplicationCapabilitiesDto {
  readonly manage: boolean;
  readonly manageFlavors: boolean;
  readonly readDrafts: boolean;
  readonly createReleases: boolean;
  readonly updateReleases: boolean;
  readonly publishReleases: boolean;
  readonly deleteReleases: boolean;
  readonly restoreReleases: boolean;
  readonly releaseBuildNumbers: boolean;
  readonly uploadArtifacts: boolean;
  readonly downloadArtifacts: boolean;
  readonly deleteArtifacts: boolean;
  readonly managePermissions: boolean;
  readonly readAudit: boolean;
  readonly manageShares: boolean;
}

export interface FlavorDto {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly status: 'active' | 'disabled' | 'archived';
  readonly bundleIdentifiers: Partial<Record<PlatformDto, string>>;
  readonly hasReleases: boolean;
  readonly rowVersion: number;
}

export interface ApplicationDto {
  readonly id: string;
  readonly projectId: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly framework: 'flutter' | 'dotnet_maui';
  readonly platforms: readonly PlatformDto[];
  readonly flavorsEnabled: boolean;
  readonly visibility: 'private' | 'organization';
  readonly status: 'active' | 'archived';
  readonly rowVersion: number;
  readonly flavors: readonly FlavorDto[];
  readonly capabilities: ApplicationCapabilitiesDto;
  /** Plain text with line breaks, shown on download pages. */
  readonly installNotes: string;
  /** Versioned URL of the icon, `null` without icon. */
  readonly iconUrl: string | null;
}

export type PublicationStatusDto = 'draft' | 'published' | 'withdrawn';
export type LifecycleStateDto = 'active' | 'pending_deletion' | 'quarantined' | 'purged';

export interface ReleaseSummaryDto {
  readonly id: string;
  readonly applicationId: string;
  readonly flavorId: string;
  readonly flavorKey: string;
  readonly version: string;
  readonly buildNumber: number;
  readonly requiredPlatforms: readonly PlatformDto[];
  readonly missingPlatforms: readonly PlatformDto[];
  readonly publicationStatus: PublicationStatusDto;
  readonly lifecycleState: LifecycleStateDto;
  readonly publishedAt: string | null;
  readonly gitCommitSha: string;
  readonly gitBranch: string | null;
  readonly gitTag: string | null;
  readonly rowVersion: number;
}

export interface ArtifactDto {
  readonly id: string;
  readonly kind: 'apk' | 'aab' | 'ipa' | 'dsym' | 'mapping' | 'metadata';
  readonly platform: PlatformDto | null;
  readonly abi: string | null;
  readonly buildMode: 'release' | 'profile' | 'debug';
  readonly originalFileName: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly storageState: 'uploading' | 'stored' | 'quarantined' | 'purged' | 'missing';
  readonly installable: boolean;
  readonly uploadedAt: string;
  /** Open removal of this artifact (requested or in quarantine), otherwise `null`. */
  readonly removal: DeletionStatusDto | null;
}

export interface DeletionStatusDto {
  readonly jobId: string;
  readonly state: string;
  readonly requestedAt: string;
  readonly reason: string;
  readonly purgeAfter: string | null;
  readonly attempts: number;
  readonly lastErrorCode: string | null;
  readonly requiresManualReview: boolean;
}

export interface ReleaseDetailDto extends ReleaseSummaryDto {
  readonly releaseNotes: string;
  readonly changelog: string;
  readonly gitRepository: string | null;
  readonly workflowRun: { readonly id: number; readonly attempt: number; readonly url: string } | null;
  readonly buildNumberReserved: boolean;
  readonly purgedAt: string | null;
  readonly artifacts: readonly ArtifactDto[];
  readonly deletion: DeletionStatusDto | null;
  /** Text to type when deleting; only present for users allowed to delete. */
  readonly deletionConfirmation: string | null;
  readonly capabilities: ApplicationCapabilitiesDto;
}

export type ScopeDto =
  | { readonly type: 'global' }
  | { readonly type: 'project'; readonly projectId: string }
  | { readonly type: 'application'; readonly applicationId: string };

export interface RoleDto {
  readonly id: string;
  readonly key: string;
  readonly permissions: readonly string[];
}

export interface UserSummaryDto {
  readonly id: string;
  readonly displayName: string;
  readonly login: string | null;
  readonly gitHubId: string | null;
  readonly avatarUrl: string | null;
  readonly status: 'active' | 'disabled';
  readonly lastLoginAt: string | null;
}

export interface AssignmentDto {
  readonly id: string;
  readonly role: { readonly id: string; readonly key: string } | null;
  readonly principal:
    | { readonly type: 'user'; readonly user: UserSummaryDto | null; readonly userId: string }
    | { readonly type: 'team'; readonly teamId: string };
  readonly scope: ScopeDto;
  readonly source: 'manual' | 'configuration';
  readonly reason: string;
  readonly grantedAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly inherited: boolean;
}

export interface PermissionExplanationDto {
  readonly permission: string;
  readonly allowed: boolean;
  readonly grants: readonly { readonly assignmentId: string; readonly roleKey: string; readonly scope: ScopeDto }[];
}

export interface AuditEntryDto {
  readonly id: number;
  readonly occurredAt: string;
  readonly actor: {
    readonly type: 'user' | 'ci' | 'system' | 'share';
    readonly label: string;
    readonly userId: string | null;
  };
  readonly action: string;
  readonly target: { readonly type: string; readonly id: string | null };
  readonly projectId: string | null;
  readonly applicationId: string | null;
  readonly outcome: 'success' | 'denied' | 'failed';
  readonly details: Readonly<Record<string, unknown>>;
}

export interface DeletionJobDto extends DeletionStatusDto {
  readonly releaseId: string;
  /** Set when the job removes a single artifact instead of the whole release. */
  readonly artifactId: string | null;
  readonly failedPhase: 'quarantine' | 'purge' | null;
  readonly nextAttemptAt: string | null;
  readonly completedAt: string | null;
  readonly rowVersion: number;
}

/** Answer to a deletion request: the release is gone at once, its files follow through quarantine. */
export interface DeletionAcceptedDto {
  readonly deletionJobId: string;
}

/** Answer to an upload; `releaseCreated` is set when the file started a new draft release. */
export interface UploadResultDto {
  readonly releaseId: string;
  readonly artifactId: string;
  readonly releaseCreated: boolean;
}

export interface RoleGrantedDto {
  readonly assignmentId: string;
}

/** Short-lived link for installing an IPA on iOS; `installUrl` is opened on the device. */
export interface InstallLinkDto {
  readonly installUrl: string;
  readonly manifestUrl: string;
  readonly expiresAt: string;
}

export type ShareScopeDto =
  | { readonly type: 'project'; readonly projectId: string }
  | { readonly type: 'application'; readonly applicationId: string };

/** A link for people without an account; its secret is only part of `ShareLinkCreatedDto`. */
export interface ShareLinkDto {
  readonly id: string;
  readonly label: string;
  /** `latest`: only the newest published release per flavor, replaced automatically by the next one. */
  readonly releases: 'all' | 'latest';
  readonly scope: ShareScopeDto;
  /** Name of the shared project or application. */
  readonly scopeName: string;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly active: boolean;
}

/** Answer to creating a share link: the only time its address is shown. */
export interface ShareLinkCreatedDto {
  readonly shareLink: ShareLinkDto;
  readonly url: string;
}

export interface SharedArtifactDto {
  readonly id: string;
  readonly kind: ArtifactDto['kind'];
  readonly platform: PlatformDto | null;
  readonly sizeBytes: number;
  readonly downloadUrl: string;
  /** `itms-services` address for IPA files, otherwise `null`. */
  readonly installUrl: string | null;
}

export interface SharedReleaseDto {
  readonly id: string;
  readonly version: string;
  readonly buildNumber: number;
  /** Only set while the application uses flavors. */
  readonly flavorName: string | null;
  readonly publishedAt: string | null;
  readonly releaseNotes: string;
  readonly artifacts: readonly SharedArtifactDto[];
}

export interface SharedApplicationDto {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly platforms: readonly PlatformDto[];
  /** Plain text with line breaks, shown above the downloads. */
  readonly installNotes: string;
  readonly iconUrl: string | null;
  readonly releases: readonly SharedReleaseDto[];
}

/** What the shared page shows; served without a session under `/public/shares/<token>`. */
export interface SharedContentDto {
  readonly label: string;
  readonly releases: ShareLinkDto['releases'];
  readonly expiresAt: string | null;
  readonly project: { readonly name: string; readonly description: string };
  readonly applications: readonly SharedApplicationDto[];
}

export interface DashboardLatestReleaseDto {
  readonly releaseId: string;
  readonly version: string;
  readonly buildNumber: number;
  readonly publishedAt: string;
}

export interface DashboardApplicationDto {
  readonly id: string;
  readonly name: string;
  readonly published: number;
  readonly drafts: number;
  readonly inDeletion: number;
  readonly downloads: number;
  readonly latest: DashboardLatestReleaseDto | null;
}

export interface DashboardProjectDto {
  readonly id: string;
  readonly name: string;
  readonly applications: readonly DashboardApplicationDto[];
}

/** Overview of everything the signed-in user can see. */
export interface DashboardDto {
  /** Period of the download counts in days. */
  readonly downloadDays: number;
  /** Window of `quarantineEnding` and of expiring share links, in days. */
  readonly quarantineDays: number;
  readonly shareExpiryDays: number;
  /** Start of the user's previous sign-in. */
  readonly previousSignInAt: string | null;
  /** `null` for users who manage no share links. */
  readonly shareLinks: { readonly active: number; readonly expiringSoon: number } | null;
  readonly quarantineEnding: readonly {
    readonly releaseId: string;
    readonly version: string;
    readonly buildNumber: number;
    readonly purgeAfter: string;
    readonly applicationId: string;
    readonly applicationName: string;
    readonly projectName: string;
    readonly canRestore: boolean;
  }[];
  readonly totals: {
    readonly projects: number;
    readonly applications: number;
    readonly published: number;
    readonly drafts: number;
    readonly inDeletion: number;
    readonly downloads: number;
  };
  readonly projects: readonly DashboardProjectDto[];
  readonly recentReleases: readonly {
    readonly id: string;
    readonly version: string;
    readonly buildNumber: number;
    readonly publicationStatus: PublicationStatusDto;
    readonly lifecycleState: LifecycleStateDto;
    readonly createdAt: string;
    readonly publishedAt: string | null;
    readonly applicationId: string;
    readonly applicationName: string;
    readonly projectId: string;
    readonly projectName: string;
  }[];
}

export interface StorageUsageDto {
  readonly storedBytes: number;
  readonly storedArtifacts: number;
  readonly quarantinedBytes: number;
  readonly quarantinedArtifacts: number;
  readonly missingArtifacts: number;
}

/** Result of one database-to-file-system reconciliation. */
export interface StorageReportDto {
  readonly id: string;
  readonly trigger: 'schedule' | 'manual';
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly filesChecked: number;
  readonly bytesChecked: number;
  /** Artifacts the database knows whose file is absent or has a different size. */
  readonly missing: readonly {
    readonly artifactId: string;
    readonly releaseId: string;
    readonly applicationId: string;
    readonly expectedPath: string;
    readonly sizeBytes: number;
    readonly problem: 'missing' | 'size_mismatch';
    readonly quarantined: boolean;
  }[];
  /** Missing artifacts whose file was found again. */
  readonly recovered: readonly { readonly artifactId: string; readonly releaseId: string }[];
  /** Files and entries no artifact accounts for; reported, never removed. */
  readonly orphaned: readonly { readonly path: string; readonly sizeBytes: number; readonly type: 'file' | 'other' }[];
}

export interface StorageOverviewDto {
  readonly total: StorageUsageDto;
  readonly projects: readonly (StorageUsageDto & { readonly projectId: string; readonly name: string })[];
  readonly latestReport: StorageReportDto | null;
}

/** Download page for signed-in employees: what they may install, newest published release per flavor. */
export interface CatalogDto {
  readonly projects: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    /** IPA entries carry no `installUrl`; the page requests a signed installation link per tap. */
    readonly applications: readonly SharedApplicationDto[];
  }[];
}

/** Allows the workflows of one repository to upload into an application (GitHub Actions OIDC). */
export interface CiBindingDto {
  readonly id: string;
  readonly applicationId: string;
  readonly repositoryId: number;
  readonly repositoryName: string;
  readonly refPattern: string;
  readonly environment: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly revokedAt: string | null;
}

/** What a workflow needs to upload into an application: the bindings and the values for the action. */
export interface CiSettingsDto {
  readonly bindings: readonly CiBindingDto[];
  /** Value of the action's `portal-url` input. */
  readonly portalUrl: string;
  /** Audience the portal expects in OIDC tokens; the action's default when it equals `portalUrl`. */
  readonly audience: string;
}

/** A role a user holds right now, directly or through a team. */
export interface HeldRoleDto {
  readonly roleKey: string;
  readonly scope: ScopeDto;
  /** Name of the project or application; empty for the platform. */
  readonly scopeName: string;
  readonly viaTeam: boolean;
  readonly expiresAt: string | null;
}

/** Entry of the user administration: the account, its last sign-in and its current roles. */
export interface UserOverviewDto extends UserSummaryDto {
  readonly roles: readonly HeldRoleDto[];
}

/** Read-only platform configuration for operators; contains no secrets. */
export interface PlatformSettingsDto {
  readonly version: string;
  readonly nodeVersion: string;
  readonly publicUrl: string;
  readonly gitHub: { readonly webUrl: string; readonly apiUrl: string; readonly organization: string };
  readonly bootstrapAdministrators: number;
  readonly ci: { readonly issuer: string; readonly audience: string };
  readonly storage: {
    readonly databasePath: string;
    readonly storageRoot: string;
    readonly servedAreas: readonly string[];
  };
  readonly limits: {
    readonly maxUploadMegabytes: number;
    readonly quarantineDays: number;
    readonly installLinkMinutes: number;
    readonly sessionAbsoluteHours: number;
    readonly sessionIdleMinutes: number;
  };
  readonly worker: { readonly pollSeconds: number; readonly leaseMinutes: number; readonly reconcileHours: number };
}

/** Settings administrators change at runtime (`settings.manage`); `rowVersion` guards against lost updates. */
export interface SettingsDto {
  readonly quarantineDays: number;
  readonly sessionAbsoluteHours: number;
  readonly sessionIdleMinutes: number;
  readonly installLinkMinutes: number;
  readonly shareLinkDefaultDays: number | null;
  readonly shareLinkMaxDays: number | null;
  readonly shareLinkDefaultReleases: 'all' | 'latest';
  readonly defaultVisibility: 'private' | 'organization';
  readonly reconcileHours: number;
  readonly dashboardDownloadDays: number;
  readonly dashboardQuarantineDays: number;
  readonly dashboardShareExpiryDays: number;
  readonly portalName: string;
  readonly supportContact: string;
  readonly publicNotice: string;
  readonly footerText: string;
  readonly rowVersion: number;
}

/** Presets for forms of every signed-in user. */
export type SettingPresetsDto = Pick<
  SettingsDto,
  'shareLinkDefaultDays' | 'shareLinkMaxDays' | 'shareLinkDefaultReleases' | 'defaultVisibility'
>;

/** Name and texts of the portal; public, for share links and the sign-in page. */
export type BrandingDto = Pick<SettingsDto, 'portalName' | 'supportContact' | 'publicNotice' | 'footerText'>;

/** Personal settings of the signed-in person. */
export interface PreferencesDto {
  /** `system` follows the colour mode of the device. */
  readonly theme: 'system' | 'light' | 'dark';
  readonly startPage: 'dashboard' | 'apps';
}

export interface AccountSessionDto {
  readonly id: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly userAgent: string | null;
  /** The browser of this request. */
  readonly current: boolean;
}

/** The "Mein Konto" page: own profile, settings, roles with their permissions and open sessions. */
export interface AccountDto {
  readonly user: UserSummaryDto;
  readonly preferences: PreferencesDto;
  readonly roles: readonly (HeldRoleDto & { readonly permissions: readonly string[] })[];
  readonly sessions: readonly AccountSessionDto[];
}
