import { describe, expect, it } from 'vitest';

import { parseId, type ApplicationId, type ArtifactId, type DeletionJobId, type ReleaseId } from './identifier.js';
import {
  artifactStorageKey,
  parseStorageKey,
  quarantineDirectoryKey,
  releaseDirectoryKey,
  releaseManifestKey,
  storageKeySegments,
  type StorageKey,
} from './storage-key.js';

const applicationId = parseId<'Application'>('0192f3a4-5b6c-7d8e-9f01-23456789abcd');
const releaseId = parseId<'Release'>('0192f3a4-5b6c-7d8e-af01-23456789abce');
const artifactId = parseId<'Artifact'>('0192f3a4-5b6c-7d8e-bf01-23456789abcf');
const jobId = parseId<'DeletionJob'>('0192f3a4-5b6c-7d8e-8f01-23456789abc0');

describe('storage keys', (): void => {
  it('places each release in its own directory below its application', (): void => {
    expect(releaseDirectoryKey(applicationId, releaseId)).toBe(`objects/${applicationId}/${releaseId}`);
  });

  it('names artifact files after their identifier and the fixed extension of their kind', (): void => {
    expect(artifactStorageKey(applicationId, releaseId, artifactId, 'dsym')).toBe(
      `objects/${applicationId}/${releaseId}/${artifactId}.zip`,
    );
  });

  it('stores the manifest next to the artifacts', (): void => {
    expect(releaseManifestKey(applicationId, releaseId)).toBe(
      `objects/${applicationId}/${releaseId}/release-manifest.json`,
    );
  });

  it('moves a release into a directory of its deletion job when quarantined', (): void => {
    expect(quarantineDirectoryKey(jobId, releaseId)).toBe(`quarantine/${jobId}/${releaseId}`);
  });

  it('splits keys into segments', (): void => {
    expect(storageKeySegments(releaseDirectoryKey(applicationId, releaseId))).toEqual([
      'objects',
      applicationId,
      releaseId,
    ]);
  });

  it('rechecks identifiers at runtime even though they are branded', (): void => {
    const forged = '../../windows' as ApplicationId;

    expect((): StorageKey => releaseDirectoryKey(forged, releaseId)).toThrow(
      expect.objectContaining({ code: 'invalid_storage_key' }),
    );
    expect((): StorageKey => artifactStorageKey(applicationId, releaseId, 'x' as ArtifactId, 'apk')).toThrow(
      expect.objectContaining({ code: 'invalid_storage_key' }),
    );
    expect((): StorageKey => quarantineDirectoryKey('..' as DeletionJobId, '..' as ReleaseId)).toThrow(
      expect.objectContaining({ code: 'invalid_storage_key' }),
    );
  });

  it.each([
    `objects/${applicationId}/${releaseId}/../other`,
    `objects\\${applicationId}\\${releaseId}`,
    `objects/${applicationId}/${releaseId}/${artifactId}.exe`,
    `objects/${applicationId}/${releaseId}/${artifactId}.apk:stream`,
    `incoming/${applicationId}/${releaseId}`,
    `objects/${applicationId}`,
    `/objects/${applicationId}/${releaseId}`,
    `C:/objects/${applicationId}/${releaseId}`,
  ])('rejects the key %s read back from persistence', (value): void => {
    expect((): StorageKey => parseStorageKey(value)).toThrow(expect.objectContaining({ code: 'invalid_storage_key' }));
  });
});
