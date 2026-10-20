import { lstat, mkdir, mkdtemp, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ArtifactSnapshotEntry } from '../../domain/entities/deletion-job.js';
import type { StorageOutcome } from '../../domain/ports/artifact-storage.js';
import { parseId, type ArtifactId, type Id, type UploadId } from '../../domain/value-objects/identifier.js';
import {
  artifactStorageKey,
  quarantineDirectoryKey,
  releaseDirectoryKey,
  releaseManifestKey,
  type StorageKey,
} from '../../domain/value-objects/storage-key.js';
import { FileSystemArtifactStorage } from './file-system-artifact-storage.js';
import { StoragePathResolver } from './storage-path-resolver.js';

const applicationId = parseId<'Application'>('0192f3a4-0000-7000-8000-000000000020');
const releaseId = parseId<'Release'>('0192f3a4-0000-7000-8000-000000000100');
const otherReleaseId = parseId<'Release'>('0192f3a4-0000-7000-8000-000000000101');
const jobId = parseId<'DeletionJob'>('0192f3a4-0000-7000-8000-000000000200');
const releaseKey = releaseDirectoryKey(applicationId, releaseId);
const quarantineKey = quarantineDirectoryKey(jobId, releaseId);

let sequence = 0;
const nextId = <Entity extends string>(): Id<Entity> =>
  parseId(`0192f3a4-0000-7000-9000-${(sequence += 1).toString(16).padStart(12, '0')}`);

function chunks(...parts: readonly string[]): AsyncIterable<Uint8Array> {
  return Readable.from(parts.map((part) => Buffer.from(part)));
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const parts: Buffer[] = [];

  for await (const part of stream) {
    parts.push(Buffer.from(part));
  }

  return Buffer.concat(parts).toString();
}

const failure = (errorCode: string, securityViolation = true): StorageOutcome => ({
  ok: false,
  failure: { errorCode, securityViolation },
});

describe('FileSystemArtifactStorage', (): void => {
  let base: string;
  let resolver: StoragePathResolver;
  let storage: FileSystemArtifactStorage;

  beforeEach(async (): Promise<void> => {
    base = await mkdtemp(path.join(tmpdir(), 'artifact-storage-'));
    resolver = new StoragePathResolver(path.join(base, 'storage'));
    storage = new FileSystemArtifactStorage(resolver);
  });

  afterEach(async (): Promise<void> => {
    await rm(base, { recursive: true, force: true });
  });

  /** Uploads a file and returns its snapshot entry. */
  async function store(content: string, release = releaseId): Promise<ArtifactSnapshotEntry> {
    const uploadId = nextId<'Upload'>();
    const artifactId = nextId<'Artifact'>() as ArtifactId;
    const key = artifactStorageKey(applicationId, release, artifactId, 'apk');
    const received = await storage.receive(uploadId, chunks(content), 1024);

    await storage.commit(uploadId, key);
    return { artifactId, storageKey: key, sizeBytes: received.sizeBytes, sha256: received.sha256 };
  }

  const pathOf = (key: StorageKey): string => resolver.resolve(key);
  const exists = async (key: StorageKey): Promise<boolean> =>
    lstat(pathOf(key)).then(
      () => true,
      () => false,
    );

  describe('uploads', (): void => {
    it('measures, hashes and stores an upload immutably', async (): Promise<void> => {
      const uploadId = nextId<'Upload'>();
      const key = artifactStorageKey(applicationId, releaseId, nextId(), 'apk');

      await expect(storage.receive(uploadId, chunks('hello ', 'world'), 1024)).resolves.toEqual({
        sizeBytes: 11,
        sha256: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
      });

      await storage.commit(uploadId, key);

      await expect(collect(await storage.read(key))).resolves.toBe('hello world');
      await expect(collect(await storage.read(key, { start: 6, end: 10 }))).resolves.toBe('world');
      expect(await readdir(path.join(base, 'storage', 'incoming'))).toEqual([]);
    });

    it('never overwrites a stored artifact', async (): Promise<void> => {
      const entry = await store('first');
      const uploadId = nextId<'Upload'>();
      await storage.receive(uploadId, chunks('second'), 1024);

      await expect(storage.commit(uploadId, entry.storageKey)).rejects.toThrow(
        expect.objectContaining({ code: 'target_exists' }),
      );
      await expect(collect(await storage.read(entry.storageKey))).resolves.toBe('first');
    });

    it('rejects uploads above the limit and leaves nothing behind', async (): Promise<void> => {
      await expect(storage.receive(nextId(), chunks('12345', '6'), 5)).rejects.toThrow(
        expect.objectContaining({ code: 'upload_too_large' }),
      );
      expect(await readdir(path.join(base, 'storage', 'incoming'))).toEqual([]);
    });

    it('refuses to reuse an upload file and keeps the existing one', async (): Promise<void> => {
      const uploadId = nextId<'Upload'>();
      await storage.receive(uploadId, chunks('first'), 1024);

      await expect(storage.receive(uploadId, chunks('second'), 1024)).rejects.toThrow(
        expect.objectContaining({ code: 'EEXIST' }),
      );
      expect(await readdir(path.join(base, 'storage', 'incoming'))).toEqual([`${uploadId}.part`]);

      await storage.discard(uploadId);
      expect(await readdir(path.join(base, 'storage', 'incoming'))).toEqual([]);
    });

    it('refuses to read through a link', async (): Promise<void> => {
      const entry = await store('content');
      await rename(path.dirname(pathOf(entry.storageKey)), path.join(base, 'moved'));
      await symlink(path.join(base, 'moved'), path.dirname(pathOf(entry.storageKey)), 'junction');

      await expect(storage.read(entry.storageKey)).rejects.toThrow(expect.objectContaining({ code: 'reparse_point' }));
    });

    it('refuses to read anything but a regular file', async (): Promise<void> => {
      const key = artifactStorageKey(applicationId, releaseId, nextId(), 'apk');
      await mkdir(pathOf(key), { recursive: true });

      await expect(storage.read(key)).rejects.toThrow(expect.objectContaining({ code: 'unexpected_entry' }));
    });
  });

  describe('quarantine and restore', (): void => {
    it('moves exactly the release directory and back again', async (): Promise<void> => {
      const snapshot = [await store('apk'), await store('ipa')];
      const neighbour = await store('other release', otherReleaseId);
      await writeFile(pathOf(releaseManifestKey(applicationId, releaseId)), '{}');

      await expect(storage.moveToQuarantine(releaseKey, quarantineKey, snapshot)).resolves.toEqual({ ok: true });
      expect(await exists(releaseKey)).toBe(false);
      expect(await readdir(pathOf(quarantineKey))).toHaveLength(3);
      expect(await exists(neighbour.storageKey)).toBe(true);

      await expect(storage.restoreFromQuarantine(quarantineKey, releaseKey, snapshot)).resolves.toEqual({ ok: true });
      expect(await readdir(pathOf(releaseKey))).toHaveLength(3);
      expect(await readdir(path.join(base, 'storage', 'quarantine'))).toEqual([]);
    });

    it('converges when run again after the move already happened', async (): Promise<void> => {
      const snapshot = [await store('apk')];

      await storage.moveToQuarantine(releaseKey, quarantineKey, snapshot);

      await expect(storage.moveToQuarantine(releaseKey, quarantineKey, snapshot)).resolves.toEqual({ ok: true });
    });

    it('treats a release without files as quarantined', async (): Promise<void> => {
      await expect(storage.moveToQuarantine(releaseKey, quarantineKey, [])).resolves.toEqual({ ok: true });
    });

    it.each([
      [
        'an unexpected file',
        async (): Promise<void> => writeFile(path.join(pathOf(releaseKey), 'planted.exe'), 'x'),
        'unexpected_entry',
      ],
      [
        'a link',
        async (): Promise<void> => symlink(tmpdir(), path.join(pathOf(releaseKey), 'link'), 'junction'),
        'reparse_point',
      ],
      [
        'a nested directory',
        async (): Promise<void> => mkdir(path.join(pathOf(releaseKey), 'nested')).then(() => undefined),
        'unexpected_entry',
      ],
    ])('stops at %s and changes nothing', async (_case, tamper, code): Promise<void> => {
      const snapshot = [await store('apk')];
      await tamper();

      await expect(storage.moveToQuarantine(releaseKey, quarantineKey, snapshot)).resolves.toEqual(failure(code));
      expect(await exists(releaseKey)).toBe(true);
      expect(await exists(quarantineKey)).toBe(false);
    });

    it('stops when a recorded file is missing or has a different size', async (): Promise<void> => {
      const entry = await store('apk');

      await expect(
        storage.moveToQuarantine(releaseKey, quarantineKey, [{ ...entry, sizeBytes: entry.sizeBytes + 1 }]),
      ).resolves.toEqual(failure('size_mismatch'));

      await unlink(pathOf(entry.storageKey));
      await expect(storage.moveToQuarantine(releaseKey, quarantineKey, [entry])).resolves.toEqual(
        failure('artifact_missing'),
      );
    });

    it('stops when the release directory is gone or exists twice', async (): Promise<void> => {
      const snapshot = [await store('apk')];

      await mkdir(pathOf(quarantineKey), { recursive: true });
      await expect(storage.moveToQuarantine(releaseKey, quarantineKey, snapshot)).resolves.toEqual(
        failure('both_locations_exist'),
      );

      await rm(pathOf(releaseKey), { recursive: true });
      await rm(pathOf(quarantineKey), { recursive: true });
      await expect(storage.moveToQuarantine(releaseKey, quarantineKey, snapshot)).resolves.toEqual(
        failure('release_directory_missing'),
      );
    });

    it('rejects a snapshot that points into another release', async (): Promise<void> => {
      const foreign = await store('other release', otherReleaseId);

      await expect(storage.moveToQuarantine(releaseKey, quarantineKey, [foreign])).resolves.toEqual(
        failure('snapshot_mismatch'),
      );
      expect(await exists(foreign.storageKey)).toBe(true);
    });

    it('refuses to quarantine through a junction', async (): Promise<void> => {
      const snapshot = [await store('apk')];
      await mkdir(path.join(base, 'outside', jobId), { recursive: true });
      await mkdir(path.join(base, 'storage', 'quarantine'), { recursive: true });
      await symlink(path.join(base, 'outside', jobId), path.join(base, 'storage', 'quarantine', jobId), 'junction');

      await expect(storage.moveToQuarantine(releaseKey, quarantineKey, snapshot)).resolves.toEqual(
        failure('reparse_point'),
      );
      expect(await exists(releaseKey)).toBe(true);
    });
  });

  describe('purge', (): void => {
    it('removes the verified files and the emptied directories only', async (): Promise<void> => {
      const snapshot = [await store('apk'), await store('ipa')];
      await writeFile(pathOf(releaseManifestKey(applicationId, releaseId)), '{}');
      await storage.moveToQuarantine(releaseKey, quarantineKey, snapshot);

      await expect(storage.purge(quarantineKey, snapshot)).resolves.toEqual({ ok: true });
      expect(await readdir(path.join(base, 'storage', 'quarantine'))).toEqual([]);
      expect(await readdir(path.join(base, 'storage', 'objects', applicationId))).toEqual([]);
    });

    it('finishes a purge that was interrupted half-way', async (): Promise<void> => {
      const snapshot = [await store('apk'), await store('ipa')];
      await storage.moveToQuarantine(releaseKey, quarantineKey, snapshot);
      const [first] = await readdir(pathOf(quarantineKey));
      await unlink(path.join(pathOf(quarantineKey), first ?? ''));

      await expect(storage.purge(quarantineKey, snapshot)).resolves.toEqual({ ok: true });
      await expect(storage.purge(quarantineKey, snapshot)).resolves.toEqual({ ok: true });
    });

    it('deletes nothing when the directory holds something unexpected', async (): Promise<void> => {
      const snapshot = [await store('apk')];
      await storage.moveToQuarantine(releaseKey, quarantineKey, snapshot);
      await mkdir(path.join(pathOf(quarantineKey), 'nested'));

      await expect(storage.purge(quarantineKey, snapshot)).resolves.toEqual(failure('unexpected_entry'));
      expect(await readdir(pathOf(quarantineKey))).toHaveLength(2);
    });

    it('reports other I/O problems as retryable', async (): Promise<void> => {
      const snapshot = [await store('apk')];
      await storage.moveToQuarantine(releaseKey, quarantineKey, snapshot);
      await rm(pathOf(quarantineKey), { recursive: true });
      await writeFile(pathOf(quarantineKey), 'a file where a directory belongs');

      await expect(storage.purge(quarantineKey, snapshot)).resolves.toEqual(failure('io_enotdir', false));
    });
  });

  it('rejects upload identifiers that are not canonical', async (): Promise<void> => {
    await expect(storage.discard('../escape' as UploadId)).rejects.toThrow(
      expect.objectContaining({ code: 'invalid_upload_id' }),
    );
  });
});
