import type { ReleaseArtifact, StorageState } from '../entities/release-artifact.js';
import type { LifecycleState, PublicationStatus, Release } from '../entities/release.js';
import type { BuildNumber } from '../value-objects/build-number.js';
import type { ApplicationId, ArtifactId, FlavorId, ReleaseId } from '../value-objects/identifier.js';
import type { ChangeContext, Stored } from './stored.js';

export interface ReleaseQuery {
  readonly applicationId: ApplicationId;
  readonly flavorId?: FlavorId;
  readonly lifecycleStates?: readonly LifecycleState[];
  readonly publicationStatuses?: readonly PublicationStatus[];
  /** Matches the beginning of the version or commit SHA, or the exact build number. */
  readonly search?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface ReleaseRepository {
  /** Fails with `build_number_taken` while another release of the flavor reserves the build number. */
  insert(release: Release, context: ChangeContext): void;
  update(release: Release, expectedRowVersion: number, context: ChangeContext): number;
  findById(id: ReleaseId): Stored<Release> | null;
  /** The release that currently reserves the build number of the flavor, if any. */
  findByBuildNumber(flavorId: FlavorId, buildNumber: BuildNumber): Stored<Release> | null;
  /** Newest version first. */
  list(query: ReleaseQuery): readonly Stored<Release>[];
  /** Number of releases matching the query, regardless of paging. */
  count(query: Omit<ReleaseQuery, 'limit' | 'offset'>): number;

  /** Fails with `artifact_exists` if the release already holds a file of the same kind, ABI and build mode. */
  insertArtifact(artifact: ReleaseArtifact): void;
  /** Persists the storage state; everything else about an artifact is immutable. */
  updateArtifactState(artifact: ReleaseArtifact): void;
  findArtifact(id: ArtifactId): ReleaseArtifact | null;
  listArtifacts(releaseId: ReleaseId): readonly ReleaseArtifact[];
  /** Artifacts in the given storage states across all releases, e.g. for the storage reconciliation. */
  listArtifactsByStorageState(states: readonly StorageState[]): readonly ReleaseArtifact[];
}
