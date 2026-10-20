import type { ArtifactSnapshotEntry, FailureDetails } from '../entities/deletion-job.js';
import type { UploadId } from '../value-objects/identifier.js';
import type { StorageKey } from '../value-objects/storage-key.js';

export interface ReceivedUpload {
  readonly sizeBytes: number;
  readonly sha256: string;
}

/** Random access to a received upload, so that identifiers can be read from the binary before it is committed. */
export interface ReceivedFile {
  readonly sizeBytes: number;
  /** Fewer bytes than requested only at the end of the file. */
  read(offset: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** One entry found in the storage areas. */
export interface StoredObject {
  /** Relative, forward-slash path below the storage root; only for reports. */
  readonly path: string;
  /** `null` for entries that do not fit the storage layout. */
  readonly key: StorageKey | null;
  /** `other` for directories at file level, symbolic links, junctions and similar. */
  readonly type: 'file' | 'other';
  readonly sizeBytes: number;
}

/** Result of a step of the deletion workflow; failures are recorded on the deletion job instead of thrown. */
export type StorageOutcome = { readonly ok: true } | { readonly ok: false; readonly failure: FailureDetails };

export interface ByteRange {
  /** Inclusive offsets, as in an HTTP `Range` header. */
  readonly start: number;
  readonly end: number;
}

/**
 * The file store for artifacts. Every location is a `StorageKey`, so callers never handle paths. The
 * deletion steps are idempotent: running one again after a crash converges on the same final state, and
 * they only ever touch the objects listed in the snapshot.
 */
export interface ArtifactStorage {
  /** Streams an upload into a temporary file while measuring it. Fails with `upload_too_large`. */
  receive(uploadId: UploadId, content: AsyncIterable<Uint8Array>, maxBytes: number): Promise<ReceivedUpload>;
  /** Opens a received, not yet committed upload for reading; the caller closes it before committing. */
  openReceived(uploadId: UploadId): Promise<ReceivedFile>;
  /** Moves a received upload to its final, immutable location. Never overwrites an existing object. */
  commit(uploadId: UploadId, key: StorageKey): Promise<void>;
  discard(uploadId: UploadId): Promise<void>;
  read(key: StorageKey, range?: ByteRange): Promise<AsyncIterable<Uint8Array>>;

  moveToQuarantine(
    releaseDirectory: StorageKey,
    quarantineDirectory: StorageKey,
    snapshot: readonly ArtifactSnapshotEntry[],
  ): Promise<StorageOutcome>;
  restoreFromQuarantine(
    quarantineDirectory: StorageKey,
    releaseDirectory: StorageKey,
    snapshot: readonly ArtifactSnapshotEntry[],
  ): Promise<StorageOutcome>;
  purge(quarantineDirectory: StorageKey, snapshot: readonly ArtifactSnapshotEntry[]): Promise<StorageOutcome>;
  /**
   * Moves a single artifact file of a release into the quarantine directory of its deletion job, or back.
   * Idempotent like the directory steps; the quarantined file is purged with `purge`.
   */
  quarantineArtifact(entry: ArtifactSnapshotEntry, quarantineDirectory: StorageKey): Promise<StorageOutcome>;
  restoreArtifact(quarantineDirectory: StorageKey, entry: ArtifactSnapshotEntry): Promise<StorageOutcome>;
  /** Deletes a replaced icon or other asset; only keys below `assets/` are accepted. Missing files are fine. */
  removeAsset(key: StorageKey): Promise<void>;
  /** Every entry below `objects/` and `quarantine/`, for the reconciliation with the database. Read-only. */
  inventory(): Promise<readonly StoredObject[]>;
}
