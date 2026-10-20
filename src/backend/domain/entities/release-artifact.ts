import { artifactKindSpec, type ArtifactKind } from '../value-objects/artifact-kind.js';
import type { CommitSha } from '../value-objects/commit-sha.js';
import { DomainError } from '../value-objects/domain-error.js';
import type { ArtifactId, ReleaseId, UserId } from '../value-objects/identifier.js';
import type { Platform } from '../value-objects/platform.js';
import type { StorageKey } from '../value-objects/storage-key.js';

export const ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'universal'] as const;

export type Abi = (typeof ABIS)[number];

export const BUILD_MODES = ['release', 'profile', 'debug'] as const;

export type BuildMode = (typeof BUILD_MODES)[number];

export const STORAGE_STATES = ['uploading', 'stored', 'quarantined', 'purged', 'missing'] as const;

export type StorageState = (typeof STORAGE_STATES)[number];

export const UPLOAD_SOURCES = ['ci', 'ui', 'import'] as const;

export type UploadSource = (typeof UPLOAD_SOURCES)[number];

export const ORIGINAL_FILE_NAME_MAX_LENGTH = 255;

/** One immutable file of a release. Its content never changes; a wrong file is removed and uploaded again. */
export interface ReleaseArtifact {
  readonly id: ArtifactId;
  readonly releaseId: ReleaseId;
  readonly kind: ArtifactKind;
  readonly platform: Platform | null;
  readonly abi: Abi | null;
  readonly buildMode: BuildMode;
  /** Shown to users and used as download file name after sanitising; never used as a path. */
  readonly originalFileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly storageKey: StorageKey;
  readonly storageState: StorageState;
  readonly gitCommitSha: CommitSha;
  readonly workflowRunId: number | null;
  readonly workflowRunAttempt: number | null;
  readonly uploadSource: UploadSource;
  readonly uploadedAt: Date;
  readonly uploadedBy: UserId | null;
  readonly purgedAt: Date | null;
}

export type NewReleaseArtifact = Omit<ReleaseArtifact, 'platform' | 'storageState' | 'purgedAt'>;

const SHA256 = /^[0-9a-f]{64}$/;

/** Starts tracking an upload; the file is only usable once it was verified and moved into place. */
export function createReleaseArtifact(input: NewReleaseArtifact): ReleaseArtifact {
  const platform = artifactKindSpec(input.kind).platform;
  const name = input.originalFileName;

  if (!SHA256.test(input.sha256) || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new DomainError('invalid_artifact', 'Artifact needs a lowercase SHA-256 digest and a non-negative size.');
  }

  if (name.length === 0 || name.length > ORIGINAL_FILE_NAME_MAX_LENGTH) {
    throw new DomainError(
      'invalid_artifact',
      `Original file name must contain between 1 and ${ORIGINAL_FILE_NAME_MAX_LENGTH} characters.`,
    );
  }

  if (input.abi !== null && platform !== 'android') {
    throw new DomainError('invalid_artifact', 'Only Android artifacts can have an ABI.');
  }

  return { ...input, platform, storageState: 'uploading', purgedAt: null };
}

export function markArtifactStored(artifact: ReleaseArtifact): ReleaseArtifact {
  return transition(artifact, ['uploading', 'missing'], 'stored');
}

export function markArtifactQuarantined(artifact: ReleaseArtifact): ReleaseArtifact {
  return transition(artifact, ['stored', 'missing'], 'quarantined');
}

export function markArtifactRestored(artifact: ReleaseArtifact): ReleaseArtifact {
  return transition(artifact, ['quarantined'], 'stored');
}

/** Quarantined files are purged with their release; uploads that never completed are purged alongside. */
export function markArtifactPurged(artifact: ReleaseArtifact, now: Date): ReleaseArtifact {
  return { ...transition(artifact, ['quarantined', 'uploading'], 'purged'), purgedAt: now };
}

/** Set by the storage reconciliation when a stored file has disappeared. */
export function markArtifactMissing(artifact: ReleaseArtifact): ReleaseArtifact {
  return transition(artifact, ['stored'], 'missing');
}

function transition(artifact: ReleaseArtifact, from: readonly StorageState[], to: StorageState): ReleaseArtifact {
  if (!from.includes(artifact.storageState)) {
    throw new DomainError('invalid_artifact_state', `Artifact cannot become ${to} from its current state.`);
  }

  return { ...artifact, storageState: to };
}
