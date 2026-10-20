import type { ApplicationId, ArtifactId, ReleaseId, StorageReportId } from '../value-objects/identifier.js';

/** An artifact whose file is not where the database expects it, or not of the recorded size. */
export interface MissingArtifact {
  readonly artifactId: ArtifactId;
  readonly releaseId: ReleaseId;
  readonly applicationId: ApplicationId;
  /** Where the file was expected, relative to the storage root. */
  readonly expectedPath: string;
  readonly sizeBytes: number;
  readonly problem: 'missing' | 'size_mismatch';
  /** Whether the artifact was in quarantine; quarantined artifacts keep their state. */
  readonly quarantined: boolean;
}

/** A file or other entry that no artifact accounts for. Never removed automatically. */
export interface OrphanedEntry {
  readonly path: string;
  readonly sizeBytes: number;
  readonly type: 'file' | 'other';
}

/**
 * Result of comparing the database with the storage areas (concept 5.6). Missing files of stored artifacts
 * mark them `missing`; orphaned files are only reported, so that an administrator decides what happens.
 */
export interface StorageReport {
  readonly id: StorageReportId;
  readonly trigger: 'schedule' | 'manual';
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly filesChecked: number;
  readonly bytesChecked: number;
  readonly missing: readonly MissingArtifact[];
  /** Artifacts marked missing earlier whose file is back with the recorded size. */
  readonly recovered: readonly { readonly artifactId: ArtifactId; readonly releaseId: ReleaseId }[];
  readonly orphaned: readonly OrphanedEntry[];
}
