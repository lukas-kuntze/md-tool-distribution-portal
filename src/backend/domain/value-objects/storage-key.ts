import { artifactKindSpec, type ArtifactKind } from './artifact-kind.js';
import { DomainError } from './domain-error.js';
import {
  isId,
  type ApplicationId,
  type ArtifactId,
  type AssetId,
  type DeletionJobId,
  type ProjectId,
  type ReleaseId,
} from './identifier.js';

declare const storageKeyBrand: unique symbol;

/**
 * Relative, forward-slash separated location of a stored object below the storage root.
 * It is derived exclusively from server-generated identifiers and fixed names, never from user input.
 */
export type StorageKey = string & { readonly [storageKeyBrand]: 'StorageKey' };

export const RELEASE_MANIFEST_FILE_NAME = 'release-manifest.json';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const EXTENSIONS = ['apk', 'aab', 'ipa', 'zip', 'txt', 'json'].join('|');
const FILE = `(?:${UUID}\\.(?:${EXTENSIONS})|${RELEASE_MANIFEST_FILE_NAME.replace('.', '\\.')})`;
const STORAGE_KEY = new RegExp(`^(?:objects|quarantine)/${UUID}/${UUID}(?:/${FILE})?$`);
// Icons and other presentation assets: one file per asset, below the application or project it belongs to.
const ASSET_KEY = new RegExp(`^assets/${UUID}/${UUID}\\.(?:png|jpg)$`);

/** Location of an icon or other presentation asset of an application or a project. */
export function assetStorageKey(
  ownerId: ApplicationId | ProjectId,
  assetId: AssetId,
  extension: 'png' | 'jpg',
): StorageKey {
  assertIds(ownerId, assetId);
  return parseStorageKey(`assets/${ownerId}/${assetId}.${extension}`);
}

export function isAssetKey(key: StorageKey): boolean {
  return ASSET_KEY.test(key);
}

export function releaseDirectoryKey(applicationId: ApplicationId, releaseId: ReleaseId): StorageKey {
  return build('objects', applicationId, releaseId);
}

export function artifactStorageKey(
  applicationId: ApplicationId,
  releaseId: ReleaseId,
  artifactId: ArtifactId,
  kind: ArtifactKind,
): StorageKey {
  assertIds(artifactId);
  return build('objects', applicationId, releaseId, `${artifactId}.${artifactKindSpec(kind).extension}`);
}

export function releaseManifestKey(applicationId: ApplicationId, releaseId: ReleaseId): StorageKey {
  return build('objects', applicationId, releaseId, RELEASE_MANIFEST_FILE_NAME);
}

/** Where the directory of a release is moved while its deletion job holds it in quarantine. */
export function quarantineDirectoryKey(deletionJobId: DeletionJobId, releaseId: ReleaseId): StorageKey {
  return build('quarantine', deletionJobId, releaseId);
}

/** Validates a key read back from persistence before it is resolved against the storage root. */
export function parseStorageKey(value: string): StorageKey {
  if (!STORAGE_KEY.test(value) && !ASSET_KEY.test(value)) {
    throw new DomainError('invalid_storage_key', 'Storage key does not match the storage layout.');
  }

  return value as StorageKey;
}

export function storageKeySegments(key: StorageKey): readonly string[] {
  return key.split('/');
}

function build(area: 'objects' | 'quarantine', owner: string, releaseId: string, file?: string): StorageKey {
  assertIds(owner, releaseId);
  return parseStorageKey(
    file === undefined ? `${area}/${owner}/${releaseId}` : `${area}/${owner}/${releaseId}/${file}`,
  );
}

function assertIds(...values: readonly string[]): void {
  // Identifiers are branded, but a key is a security boundary, so their format is checked again at runtime.
  if (!values.every(isId)) {
    throw new DomainError('invalid_storage_key', 'Storage keys can only be built from canonical identifiers.');
  }
}
