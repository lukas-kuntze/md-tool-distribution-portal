import { describe, expect, it } from 'vitest';

import { parseCommitSha } from '../value-objects/commit-sha.js';
import { parseId } from '../value-objects/identifier.js';
import { parseStorageKey } from '../value-objects/storage-key.js';
import {
  createReleaseArtifact,
  markArtifactMissing,
  markArtifactPurged,
  markArtifactQuarantined,
  markArtifactRestored,
  markArtifactStored,
  type NewReleaseArtifact,
  type ReleaseArtifact,
} from './release-artifact.js';

const now = new Date('2026-10-17T10:00:00Z');
const errorCode = (code: string): unknown => expect.objectContaining({ code });

const input: NewReleaseArtifact = {
  id: parseId('0192f3a4-0000-7000-bf01-23456789abcf'),
  releaseId: parseId('0192f3a4-0000-7000-af01-23456789abce'),
  kind: 'apk',
  abi: 'universal',
  buildMode: 'release',
  originalFileName: 'app-production-release.apk',
  contentType: 'application/vnd.android.package-archive',
  sizeBytes: 52_428_800,
  sha256: 'c'.repeat(64),
  storageKey: parseStorageKey(
    'objects/0192f3a4-0000-7000-9f01-23456789abcd/0192f3a4-0000-7000-af01-23456789abce/0192f3a4-0000-7000-bf01-23456789abcf.apk',
  ),
  gitCommitSha: parseCommitSha('a'.repeat(40)),
  workflowRunId: 4711,
  workflowRunAttempt: 1,
  uploadSource: 'ci',
  uploadedAt: now,
  uploadedBy: null,
};

describe('createReleaseArtifact', (): void => {
  it('derives the platform from the kind and starts as uploading', (): void => {
    expect(createReleaseArtifact(input)).toMatchObject({
      platform: 'android',
      storageState: 'uploading',
      purgedAt: null,
    });
    expect(createReleaseArtifact({ ...input, kind: 'metadata', abi: null }).platform).toBeNull();
  });

  it.each([
    ['an invalid digest', { sha256: 'C'.repeat(64) }],
    ['a negative size', { sizeBytes: -1 }],
    ['an empty file name', { originalFileName: '' }],
    ['an ABI on an iOS build', { kind: 'ipa' as const }],
  ])('rejects %s', (_case, overrides): void => {
    expect((): ReleaseArtifact => createReleaseArtifact({ ...input, ...overrides })).toThrow(
      errorCode('invalid_artifact'),
    );
  });
});

describe('storage state', (): void => {
  const stored = markArtifactStored(createReleaseArtifact(input));

  it('moves through quarantine to purged', (): void => {
    const quarantined = markArtifactQuarantined(stored);

    expect(quarantined.storageState).toBe('quarantined');
    expect(markArtifactRestored(quarantined).storageState).toBe('stored');
    expect(markArtifactPurged(quarantined, now)).toMatchObject({ storageState: 'purged', purgedAt: now });
  });

  it('records missing files and accepts them again once found', (): void => {
    const missing = markArtifactMissing(stored);

    expect(missing.storageState).toBe('missing');
    expect(markArtifactStored(missing).storageState).toBe('stored');
  });

  it('purges uploads that never completed', (): void => {
    expect(markArtifactPurged(createReleaseArtifact(input), now).storageState).toBe('purged');
  });

  it('rejects invalid transitions', (): void => {
    expect((): ReleaseArtifact => markArtifactPurged(stored, now)).toThrow(errorCode('invalid_artifact_state'));
    expect((): ReleaseArtifact => markArtifactQuarantined(createReleaseArtifact(input))).toThrow(
      errorCode('invalid_artifact_state'),
    );
  });
});
