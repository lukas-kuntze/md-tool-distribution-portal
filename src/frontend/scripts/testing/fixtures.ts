import type {
  ApplicationCapabilitiesDto,
  ApplicationDto,
  ArtifactDto,
  FlavorDto,
  ProjectDto,
  ReleaseDetailDto,
  ReleaseSummaryDto,
} from '../../../shared/types/api.js';

/** API answers as the backend presents them, with every capability granted unless a test says otherwise. */
export const PROJECT_ID = '0192f3a4-0000-7000-8000-0000000000a1';
export const APPLICATION_ID = '0192f3a4-0000-7000-8000-0000000000b1';
export const FLAVOR_ID = '0192f3a4-0000-7000-8000-0000000000c1';
export const RELEASE_ID = '0192f3a4-0000-7000-8000-0000000000d1';
export const SHA = '0123456789abcdef0123456789abcdef01234567';

export function project(overrides: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id: PROJECT_ID,
    slug: 'md-ambulant',
    name: 'MD Ambulant',
    description: 'Pflege',
    status: 'active',
    archivedAt: null,
    applicationCount: 2,
    iconUrl: null,
    rowVersion: 1,
    capabilities: {
      update: true,
      createApplications: true,
      managePermissions: true,
      readAudit: true,
      manageShares: true,
    },
    ...overrides,
  };
}

export const ALL_APPLICATION_CAPABILITIES: ApplicationCapabilitiesDto = {
  manage: true,
  manageFlavors: true,
  readDrafts: true,
  createReleases: true,
  updateReleases: true,
  publishReleases: true,
  deleteReleases: true,
  restoreReleases: true,
  releaseBuildNumbers: true,
  uploadArtifacts: true,
  downloadArtifacts: true,
  deleteArtifacts: true,
  managePermissions: true,
  readAudit: true,
  manageShares: true,
};

export function flavor(overrides: Partial<FlavorDto> = {}): FlavorDto {
  return {
    id: FLAVOR_ID,
    key: 'default',
    name: 'Standard',
    isDefault: true,
    status: 'active',
    bundleIdentifiers: { android: 'de.md.kmobile', ios: 'de.md.kmobile' },
    hasReleases: false,
    rowVersion: 1,
    ...overrides,
  };
}

export function application(overrides: Partial<ApplicationDto> = {}): ApplicationDto {
  return {
    id: APPLICATION_ID,
    projectId: PROJECT_ID,
    slug: 'k-mobile',
    name: 'K Mobile',
    description: '',
    framework: 'flutter',
    platforms: ['android', 'ios'],
    flavorsEnabled: false,
    installNotes: '',
    iconUrl: null,
    visibility: 'private',
    status: 'active',
    rowVersion: 1,
    flavors: [flavor()],
    capabilities: ALL_APPLICATION_CAPABILITIES,
    ...overrides,
  };
}

export function releaseSummary(overrides: Partial<ReleaseSummaryDto> = {}): ReleaseSummaryDto {
  return {
    id: RELEASE_ID,
    applicationId: APPLICATION_ID,
    flavorId: FLAVOR_ID,
    flavorKey: 'default',
    version: '4.13.0',
    buildNumber: 125,
    requiredPlatforms: ['android', 'ios'],
    missingPlatforms: [],
    publicationStatus: 'draft',
    lifecycleState: 'active',
    publishedAt: null,
    gitCommitSha: SHA,
    gitBranch: 'main',
    gitTag: null,
    rowVersion: 1,
    ...overrides,
  };
}

export function artifact(overrides: Partial<ArtifactDto> = {}): ArtifactDto {
  return {
    id: '0192f3a4-0000-7000-8000-0000000000e1',
    kind: 'ipa',
    platform: 'ios',
    abi: null,
    buildMode: 'release',
    originalFileName: 'Runner.ipa',
    sizeBytes: 52_428_800,
    sha256: 'a'.repeat(64),
    storageState: 'stored',
    installable: true,
    uploadedAt: '2026-10-17T08:00:00.000Z',
    removal: null,
    ...overrides,
  };
}

export function release(overrides: Partial<ReleaseDetailDto> = {}): ReleaseDetailDto {
  return {
    ...releaseSummary(),
    releaseNotes: 'Neu',
    changelog: '',
    gitRepository: 'md/k-mobile',
    workflowRun: { id: 4711, attempt: 1, url: 'https://github.example.com/md/k-mobile/actions/runs/4711' },
    buildNumberReserved: true,
    purgedAt: null,
    artifacts: [
      artifact(),
      artifact({
        id: '0192f3a4-0000-7000-8000-0000000000e2',
        kind: 'apk',
        platform: 'android',
        originalFileName: 'app-release.apk',
      }),
    ],
    deletion: null,
    deletionConfirmation: 'k-mobile 4.13.0 (125)',
    capabilities: ALL_APPLICATION_CAPABILITIES,
    ...overrides,
  };
}
