import type { Database } from 'better-sqlite3';

import type { ReleaseArtifact, StorageState } from '../../domain/entities/release-artifact.js';
import type { Release } from '../../domain/entities/release.js';
import type { ReleaseQuery, ReleaseRepository } from '../../domain/ports/release-repository.js';
import type { ChangeContext, Stored } from '../../domain/ports/stored.js';
import type { BuildNumber } from '../../domain/value-objects/build-number.js';
import type { CommitSha } from '../../domain/value-objects/commit-sha.js';
import type { ApplicationId, ArtifactId, FlavorId, ReleaseId, UserId } from '../../domain/value-objects/identifier.js';
import { parsePlatform, type Platform } from '../../domain/value-objects/platform.js';
import { parseStorageKey } from '../../domain/value-objects/storage-key.js';
import { parseVersion } from '../../domain/value-objects/version.js';
import {
  assertRowUpdated,
  escapeLike,
  fromDbBoolean,
  fromDbTime,
  toDbBoolean,
  toDbTime,
  translateConstraints,
} from './sqlite-values.js';

interface ReleaseRow {
  readonly id: string;
  readonly application_id: string;
  readonly flavor_id: string;
  readonly version: string;
  readonly build_number: number;
  readonly required_platforms: string;
  readonly release_notes: string;
  readonly changelog: string;
  readonly git_repository: string | null;
  readonly git_commit_sha: string;
  readonly git_branch: string | null;
  readonly git_tag: string | null;
  readonly workflow_run_id: number | null;
  readonly workflow_run_attempt: number | null;
  readonly workflow_run_url: string | null;
  readonly imported_from: string | null;
  readonly publication_status: Release['publicationStatus'];
  readonly published_at: string | null;
  readonly published_by: string | null;
  readonly lifecycle_state: Release['lifecycleState'];
  readonly deletion_requested_at: string | null;
  readonly deletion_requested_by: string | null;
  readonly purged_at: string | null;
  readonly build_number_reserved: number;
  readonly build_number_released_at: string | null;
  readonly build_number_released_by: string | null;
  readonly build_number_release_reason: string | null;
  readonly row_version: number;
}

interface ArtifactRow {
  readonly id: string;
  readonly release_id: string;
  readonly platform: Platform | null;
  readonly kind: ReleaseArtifact['kind'];
  readonly abi: ReleaseArtifact['abi'];
  readonly build_mode: ReleaseArtifact['buildMode'];
  readonly original_file_name: string;
  readonly content_type: string;
  readonly size_bytes: number;
  readonly sha256: string;
  readonly storage_key: string;
  readonly storage_state: ReleaseArtifact['storageState'];
  readonly git_commit_sha: string;
  readonly workflow_run_id: number | null;
  readonly workflow_run_attempt: number | null;
  readonly upload_source: ReleaseArtifact['uploadSource'];
  readonly uploaded_at: string;
  readonly uploaded_by: string | null;
  readonly purged_at: string | null;
}

const BUILD_NUMBER_TAKEN = {
  constraint: 'releases.flavor_id, releases.build_number',
  code: 'build_number_taken',
  message: 'Another release of this flavor already uses this build number.',
} as const;

const ARTIFACT_EXISTS = {
  constraint: "index 'release_artifacts_variant'",
  code: 'artifact_exists',
  message: 'The release already contains a file of this kind, ABI and build mode.',
} as const;

const MUTABLE_COLUMNS = `
  release_notes = @releaseNotes, changelog = @changelog, publication_status = @publicationStatus,
  published_at = @publishedAt, published_by = @publishedBy, lifecycle_state = @lifecycleState,
  deletion_requested_at = @deletionRequestedAt, deletion_requested_by = @deletionRequestedBy, purged_at = @purgedAt,
  build_number_reserved = @buildNumberReserved, build_number_released_at = @buildNumberReleasedAt,
  build_number_released_by = @buildNumberReleasedBy, build_number_release_reason = @buildNumberReleaseReason`;

export class SqliteReleaseRepository implements ReleaseRepository {
  public constructor(private readonly database: Database) {}

  public insert(release: Release, context: ChangeContext): void {
    translateConstraints(
      () =>
        this.database
          .prepare(
            `INSERT INTO releases (
               id, application_id, flavor_id, version, version_major, version_minor, version_patch, version_pre,
               build_number, required_platforms, release_notes, changelog, git_repository, git_commit_sha,
               git_branch, git_tag, workflow_run_id, workflow_run_attempt, workflow_run_url, imported_from,
               publication_status, published_at, published_by, lifecycle_state, deletion_requested_at,
               deletion_requested_by, purged_at, build_number_reserved, build_number_released_at,
               build_number_released_by, build_number_release_reason, created_at, created_by, updated_at, updated_by)
             VALUES (
               @id, @applicationId, @flavorId, @version, @versionMajor, @versionMinor, @versionPatch, @versionPre,
               @buildNumber, @requiredPlatforms, @releaseNotes, @changelog, @gitRepository, @gitCommitSha,
               @gitBranch, @gitTag, @workflowRunId, @workflowRunAttempt, @workflowRunUrl, @importedFrom,
               @publicationStatus, @publishedAt, @publishedBy, @lifecycleState, @deletionRequestedAt,
               @deletionRequestedBy, @purgedAt, @buildNumberReserved, @buildNumberReleasedAt,
               @buildNumberReleasedBy, @buildNumberReleaseReason, @at, @actor, @at, @actor)`,
          )
          .run({ ...releaseParameters(release), at: toDbTime(context.at), actor: context.actor }),
      [BUILD_NUMBER_TAKEN],
    );
  }

  public update(release: Release, expectedRowVersion: number, context: ChangeContext): number {
    const result = translateConstraints(
      () =>
        this.database
          .prepare(
            `UPDATE releases
             SET ${MUTABLE_COLUMNS}, updated_at = @at, updated_by = @actor, row_version = row_version + 1
             WHERE id = @id AND row_version = @expectedRowVersion`,
          )
          .run({ ...releaseParameters(release), at: toDbTime(context.at), actor: context.actor, expectedRowVersion }),
      [BUILD_NUMBER_TAKEN],
    );

    assertRowUpdated(result.changes);
    return expectedRowVersion + 1;
  }

  public findById(id: ReleaseId): Stored<Release> | null {
    const row = this.database.prepare<[string], ReleaseRow>('SELECT * FROM releases WHERE id = ?').get(id);
    return row === undefined ? null : toStoredRelease(row);
  }

  public findByBuildNumber(flavorId: FlavorId, buildNumber: BuildNumber): Stored<Release> | null {
    const row = this.database
      .prepare<[string, number], ReleaseRow>(
        'SELECT * FROM releases WHERE flavor_id = ? AND build_number = ? AND build_number_reserved = 1',
      )
      .get(flavorId, buildNumber);
    return row === undefined ? null : toStoredRelease(row);
  }

  public list(query: ReleaseQuery): readonly Stored<Release>[] {
    return this.database
      .prepare<Record<string, unknown>, ReleaseRow>(
        `SELECT * FROM releases ${RELEASE_FILTER}
         ORDER BY version_major DESC, version_minor DESC, version_patch DESC, version_pre IS NULL DESC,
                  build_number DESC
         LIMIT @limit OFFSET @offset`,
      )
      .all({ ...releaseFilterParameters(query), limit: query.limit, offset: query.offset })
      .map(toStoredRelease);
  }

  public count(query: Omit<ReleaseQuery, 'limit' | 'offset'>): number {
    return (
      this.database
        .prepare<Record<string, unknown>, { total: number }>(`SELECT count(*) AS total FROM releases ${RELEASE_FILTER}`)
        .get(releaseFilterParameters(query))?.total ?? 0
    );
  }

  public insertArtifact(artifact: ReleaseArtifact): void {
    translateConstraints(
      () =>
        this.database
          .prepare(
            `INSERT INTO release_artifacts (
               id, release_id, platform, kind, abi, build_mode, original_file_name, content_type, size_bytes,
               sha256, storage_key, storage_state, git_commit_sha, workflow_run_id, workflow_run_attempt,
               upload_source, uploaded_at, uploaded_by, purged_at)
             VALUES (
               @id, @releaseId, @platform, @kind, @abi, @buildMode, @originalFileName, @contentType, @sizeBytes,
               @sha256, @storageKey, @storageState, @gitCommitSha, @workflowRunId, @workflowRunAttempt,
               @uploadSource, @uploadedAt, @uploadedBy, @purgedAt)`,
          )
          .run({ ...artifact, uploadedAt: toDbTime(artifact.uploadedAt), purgedAt: toDbTime(artifact.purgedAt) }),
      [ARTIFACT_EXISTS],
    );
  }

  public updateArtifactState(artifact: ReleaseArtifact): void {
    const result = translateConstraints(
      () =>
        this.database
          .prepare('UPDATE release_artifacts SET storage_state = @storageState, purged_at = @purgedAt WHERE id = @id')
          .run({ id: artifact.id, storageState: artifact.storageState, purgedAt: toDbTime(artifact.purgedAt) }),
      [ARTIFACT_EXISTS],
    );

    assertRowUpdated(result.changes);
  }

  public findArtifact(id: ArtifactId): ReleaseArtifact | null {
    const row = this.database.prepare<[string], ArtifactRow>('SELECT * FROM release_artifacts WHERE id = ?').get(id);
    return row === undefined ? null : toArtifact(row);
  }

  public listArtifacts(releaseId: ReleaseId): readonly ReleaseArtifact[] {
    return this.database
      .prepare<[string], ArtifactRow>(
        'SELECT * FROM release_artifacts WHERE release_id = ? ORDER BY platform, kind, abi, uploaded_at',
      )
      .all(releaseId)
      .map(toArtifact);
  }

  public listArtifactsByStorageState(states: readonly StorageState[]): readonly ReleaseArtifact[] {
    return this.database
      .prepare<[string], ArtifactRow>(
        'SELECT * FROM release_artifacts WHERE storage_state IN (SELECT value FROM json_each(?)) ORDER BY id',
      )
      .all(JSON.stringify(states))
      .map(toArtifact);
  }
}

function releaseParameters(release: Release): Record<string, unknown> {
  const { metadata, version } = release;

  return {
    id: release.id,
    applicationId: release.applicationId,
    flavorId: release.flavorId,
    version: version.value,
    versionMajor: version.major,
    versionMinor: version.minor,
    versionPatch: version.patch,
    versionPre: version.preRelease,
    buildNumber: release.buildNumber,
    requiredPlatforms: release.requiredPlatforms.join(','),
    releaseNotes: metadata.releaseNotes,
    changelog: metadata.changelog,
    gitRepository: metadata.gitRepository,
    gitCommitSha: release.gitCommitSha,
    gitBranch: metadata.gitBranch,
    gitTag: metadata.gitTag,
    workflowRunId: metadata.workflowRun?.id ?? null,
    workflowRunAttempt: metadata.workflowRun?.attempt ?? null,
    workflowRunUrl: metadata.workflowRun?.url ?? null,
    importedFrom: metadata.importedFrom,
    publicationStatus: release.publicationStatus,
    publishedAt: toDbTime(release.publishedAt),
    publishedBy: release.publishedBy,
    lifecycleState: release.lifecycleState,
    deletionRequestedAt: toDbTime(release.deletionRequestedAt),
    deletionRequestedBy: release.deletionRequestedBy,
    purgedAt: toDbTime(release.purgedAt),
    buildNumberReserved: toDbBoolean(release.buildNumberReserved),
    buildNumberReleasedAt: toDbTime(release.buildNumberRelease?.at ?? null),
    buildNumberReleasedBy: release.buildNumberRelease?.by ?? null,
    buildNumberReleaseReason: release.buildNumberRelease?.reason ?? null,
  };
}

function toStoredRelease(row: ReleaseRow): Stored<Release> {
  const workflowRun =
    row.workflow_run_id === null
      ? null
      : { id: row.workflow_run_id, attempt: row.workflow_run_attempt ?? 1, url: row.workflow_run_url ?? '' };
  const buildNumberRelease =
    row.build_number_released_at === null
      ? null
      : {
          at: fromDbTime(row.build_number_released_at),
          by: row.build_number_released_by as UserId,
          reason: row.build_number_release_reason ?? '',
        };

  return {
    value: {
      id: row.id as ReleaseId,
      applicationId: row.application_id as ApplicationId,
      flavorId: row.flavor_id as FlavorId,
      version: parseVersion(row.version),
      buildNumber: row.build_number as BuildNumber,
      requiredPlatforms: row.required_platforms.split(',').map(parsePlatform),
      gitCommitSha: row.git_commit_sha as CommitSha,
      metadata: {
        releaseNotes: row.release_notes,
        changelog: row.changelog,
        gitRepository: row.git_repository,
        gitBranch: row.git_branch,
        gitTag: row.git_tag,
        workflowRun,
        importedFrom: row.imported_from,
      },
      publicationStatus: row.publication_status,
      lifecycleState: row.lifecycle_state,
      publishedAt: fromDbTime(row.published_at),
      publishedBy: row.published_by as UserId | null,
      deletionRequestedAt: fromDbTime(row.deletion_requested_at),
      deletionRequestedBy: row.deletion_requested_by as UserId | null,
      purgedAt: fromDbTime(row.purged_at),
      buildNumberReserved: fromDbBoolean(row.build_number_reserved),
      buildNumberRelease,
    },
    rowVersion: row.row_version,
  };
}

function toArtifact(row: ArtifactRow): ReleaseArtifact {
  return {
    id: row.id as ArtifactId,
    releaseId: row.release_id as ReleaseId,
    kind: row.kind,
    platform: row.platform,
    abi: row.abi,
    buildMode: row.build_mode,
    originalFileName: row.original_file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    // Keys are re-validated on every read: they are resolved against the storage root later.
    storageKey: parseStorageKey(row.storage_key),
    storageState: row.storage_state,
    gitCommitSha: row.git_commit_sha as CommitSha,
    workflowRunId: row.workflow_run_id,
    workflowRunAttempt: row.workflow_run_attempt,
    uploadSource: row.upload_source,
    uploadedAt: fromDbTime(row.uploaded_at),
    uploadedBy: row.uploaded_by as UserId | null,
    purgedAt: fromDbTime(row.purged_at),
  };
}

/** Shared by `list` and `count`, so that the total always matches the pages. */
const RELEASE_FILTER = `WHERE application_id = @applicationId
           AND (@flavorId IS NULL OR flavor_id = @flavorId)
           AND (@lifecycleStates IS NULL OR lifecycle_state IN (SELECT value FROM json_each(@lifecycleStates)))
           AND (@publicationStatuses IS NULL
                OR publication_status IN (SELECT value FROM json_each(@publicationStatuses)))
           AND (@search = ''
                OR version LIKE @searchPrefix ESCAPE '\\'
                OR git_commit_sha LIKE @searchPrefix ESCAPE '\\'
                OR build_number = @searchNumber)`;

function releaseFilterParameters(query: Omit<ReleaseQuery, 'limit' | 'offset'>): Record<string, unknown> {
  const search = query.search?.trim() ?? '';

  return {
    applicationId: query.applicationId,
    flavorId: query.flavorId ?? null,
    lifecycleStates: query.lifecycleStates === undefined ? null : JSON.stringify(query.lifecycleStates),
    publicationStatuses: query.publicationStatuses === undefined ? null : JSON.stringify(query.publicationStatuses),
    search,
    searchPrefix: `${escapeLike(search.toLowerCase())}%`,
    searchNumber: /^\d+$/.test(search) ? Number(search) : -1,
  };
}
