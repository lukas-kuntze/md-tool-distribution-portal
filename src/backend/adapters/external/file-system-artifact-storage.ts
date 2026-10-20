import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { ArtifactSnapshotEntry } from '../../domain/entities/deletion-job.js';
import type {
  ArtifactStorage,
  ByteRange,
  ReceivedFile,
  ReceivedUpload,
  StorageOutcome,
  StoredObject,
} from '../../domain/ports/artifact-storage.js';
import { DomainError } from '../../domain/value-objects/domain-error.js';
import type { UploadId } from '../../domain/value-objects/identifier.js';
import {
  isAssetKey,
  parseStorageKey,
  RELEASE_MANIFEST_FILE_NAME,
  storageKeySegments,
  type StorageKey,
} from '../../domain/value-objects/storage-key.js';
import { ignoreMissing, StorageSecurityError, type StoragePathResolver } from './storage-path-resolver.js';

/** Expected regular files of a release directory, by file name, with their size in bytes. */
type ExpectedFiles = ReadonlyMap<string, number>;

/**
 * Artifact store on a local file system (NTFS in production). Release directories are moved as a whole,
 * which is a single atomic rename on the same volume; deletion removes only verified, expected files and
 * then the emptied directory — never a recursive delete.
 */
export class FileSystemArtifactStorage implements ArtifactStorage {
  public constructor(private readonly resolver: StoragePathResolver) {}

  public async receive(
    uploadId: UploadId,
    content: AsyncIterable<Uint8Array>,
    maxBytes: number,
  ): Promise<ReceivedUpload> {
    const target = this.resolver.resolveIncoming(uploadId);
    const hash = createHash('sha256');
    let sizeBytes = 0;

    const meter = new Transform({
      transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
        sizeBytes += chunk.length;

        if (sizeBytes > maxBytes) {
          callback(new DomainError('upload_too_large', 'The upload exceeds the maximum size for this kind of file.'));
          return;
        }

        hash.update(chunk);
        callback(null, chunk);
      },
    });

    await this.ensureDirectory(this.resolver.dirname(target));

    try {
      // `wx` refuses to reuse an existing file; `flush` syncs it to disk before the stream reports completion.
      await pipeline(content, meter, createWriteStream(target, { flags: 'wx', flush: true }));
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) {
        await rm(target, { force: true });
      }

      throw error;
    }

    return { sizeBytes, sha256: hash.digest('hex') };
  }

  public async openReceived(uploadId: UploadId): Promise<ReceivedFile> {
    const target = this.resolver.resolveIncoming(uploadId);

    await this.resolver.assertNoReparsePoints(target);
    const handle = await open(target, 'r');
    const { size } = await handle.stat();

    return {
      sizeBytes: size,
      read: async (offset: number, length: number): Promise<Uint8Array> => {
        const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - offset)));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        return buffer.subarray(0, bytesRead);
      },
      close: () => handle.close(),
    };
  }

  public async commit(uploadId: UploadId, key: StorageKey): Promise<void> {
    const source = this.resolver.resolveIncoming(uploadId);
    const target = this.resolver.resolve(key);

    await this.resolver.assertNoReparsePoints(source);
    await this.ensureDirectory(this.resolver.dirname(target));

    if (await exists(target)) {
      throw new StorageSecurityError('target_exists', 'Stored artifacts are immutable and are never overwritten.');
    }

    await rename(source, target);
  }

  public async discard(uploadId: UploadId): Promise<void> {
    const target = this.resolver.resolveIncoming(uploadId);

    await this.resolver.assertNoReparsePoints(target);
    await rm(target, { force: true });
  }

  public async read(key: StorageKey, range?: ByteRange): Promise<AsyncIterable<Uint8Array>> {
    const target = this.resolver.resolve(key);

    await this.resolver.assertNoReparsePoints(target);

    if (!(await lstat(target)).isFile()) {
      throw new StorageSecurityError('unexpected_entry', 'A stored artifact is not a regular file.');
    }

    return createReadStream(target, range === undefined ? {} : { start: range.start, end: range.end });
  }

  public async removeAsset(key: StorageKey): Promise<void> {
    if (!isAssetKey(key)) {
      throw new StorageSecurityError('unexpected_entry', 'Only assets can be removed directly.');
    }

    const target = this.resolver.resolve(key);
    await this.resolver.assertNoReparsePoints(target);
    const stats = await lstat(target).catch(ignoreMissing);

    if (stats === null) {
      return;
    }

    if (!stats.isFile()) {
      throw new StorageSecurityError('unexpected_entry', 'A stored asset is not a regular file.');
    }

    await unlink(target);
  }

  public moveToQuarantine(
    releaseDirectory: StorageKey,
    quarantineDirectory: StorageKey,
    snapshot: readonly ArtifactSnapshotEntry[],
  ): Promise<StorageOutcome> {
    return outcomeOf(() => this.move(releaseDirectory, quarantineDirectory, expectedFiles(releaseDirectory, snapshot)));
  }

  public restoreFromQuarantine(
    quarantineDirectory: StorageKey,
    releaseDirectory: StorageKey,
    snapshot: readonly ArtifactSnapshotEntry[],
  ): Promise<StorageOutcome> {
    return outcomeOf(async () => {
      await this.move(quarantineDirectory, releaseDirectory, expectedFiles(releaseDirectory, snapshot));
      await removeIfEmpty(this.resolver.dirname(this.resolver.resolve(quarantineDirectory)));
    });
  }

  public purge(quarantineDirectory: StorageKey, snapshot: readonly ArtifactSnapshotEntry[]): Promise<StorageOutcome> {
    return outcomeOf(async () => {
      const directory = this.resolver.resolve(quarantineDirectory);
      const expected = expectedFiles(quarantineDirectory, snapshot);

      await this.resolver.assertNoReparsePoints(directory);

      if (await exists(directory)) {
        // Files already removed by an interrupted earlier attempt are fine; anything unknown is not.
        const names = await this.verifyDirectory(directory, expected, { allowMissing: true });

        for (const name of names) {
          await unlink(this.resolver.join(directory, name));
        }

        await rmdir(directory);
      }

      await removeIfEmpty(this.resolver.dirname(directory));

      if (await exists(directory)) {
        throw new StorageSecurityError('purge_incomplete', 'The release directory still exists after purging.');
      }
    });
  }

  public quarantineArtifact(entry: ArtifactSnapshotEntry, quarantineDirectory: StorageKey): Promise<StorageOutcome> {
    return outcomeOf(async () => {
      const { file, quarantined } = this.artifactLocations(entry, quarantineDirectory);
      await this.moveFile(file, quarantined, entry.sizeBytes);
    });
  }

  public restoreArtifact(quarantineDirectory: StorageKey, entry: ArtifactSnapshotEntry): Promise<StorageOutcome> {
    return outcomeOf(async () => {
      const { file, quarantined } = this.artifactLocations(entry, quarantineDirectory);
      await this.moveFile(quarantined, file, entry.sizeBytes);

      const directory = this.resolver.dirname(quarantined);
      await removeIfEmpty(directory);
      await removeIfEmpty(this.resolver.dirname(directory));
    });
  }

  public async inventory(): Promise<readonly StoredObject[]> {
    const found: StoredObject[] = [];

    for (const area of ['objects', 'quarantine'] as const) {
      await this.walk(this.resolver.join(this.resolver.root, area), [area], found);
    }

    return found;
  }

  /**
   * Collects `<area>/<owner>/<release>/<file>`. Links and junctions are reported, never followed; anything at a
   * place the layout does not foresee is reported as `other`.
   */
  private async walk(directory: string, segments: readonly string[], found: StoredObject[]): Promise<void> {
    const names = await readdir(directory).catch(ignoreMissing);

    for (const name of names ?? []) {
      const target = this.resolver.join(directory, name);
      const stats = await lstat(target);
      const relative = [...segments, name];
      const path = relative.join('/');

      if (!stats.isSymbolicLink() && stats.isDirectory() && relative.length < 4) {
        await this.walk(target, relative, found);
      } else if (!stats.isSymbolicLink() && stats.isFile() && relative.length === 4) {
        found.push({ path, key: keyOf(path), type: 'file', sizeBytes: stats.size });
      } else {
        found.push({ path, key: null, type: 'other', sizeBytes: stats.isFile() ? stats.size : 0 });
      }
    }
  }

  /** The artifact's file in its release directory and its place in the job's quarantine directory. */
  private artifactLocations(
    entry: ArtifactSnapshotEntry,
    quarantineDirectory: StorageKey,
  ): { readonly file: string; readonly quarantined: string } {
    const [name] = expectedFiles(quarantineDirectory, [entry]).keys();

    if (name === undefined) {
      throw new StorageSecurityError('snapshot_mismatch', 'The artifact does not belong to the quarantined release.');
    }

    return {
      file: this.resolver.resolve(entry.storageKey),
      quarantined: this.resolver.join(this.resolver.resolve(quarantineDirectory), name),
    };
  }

  /** Moves one artifact file; safe to repeat after a crash, like `move` for whole directories. */
  private async moveFile(source: string, target: string, sizeBytes: number): Promise<void> {
    await this.resolver.assertNoReparsePoints(source);
    await this.resolver.assertNoReparsePoints(target);

    const [sourceExists, targetExists] = [await exists(source), await exists(target)];

    if (sourceExists && targetExists) {
      throw new StorageSecurityError('both_locations_exist', 'The artifact exists in both storage areas.');
    }

    if (!sourceExists) {
      if (!targetExists) {
        throw new StorageSecurityError('artifact_missing', 'The artifact file does not exist.');
      }

      await assertRegularFile(target, sizeBytes);
      return;
    }

    await assertRegularFile(source, sizeBytes);
    await this.ensureDirectory(this.resolver.dirname(target));
    await rename(source, target);
    await assertRegularFile(target, sizeBytes);
  }

  /**
   * Moves a release directory from one area to the other. Safe to run again after a crash: if the move already
   * happened, only the result is verified.
   */
  private async move(from: StorageKey, to: StorageKey, expected: ExpectedFiles): Promise<void> {
    const source = this.resolver.resolve(from);
    const target = this.resolver.resolve(to);

    await this.resolver.assertNoReparsePoints(source);
    await this.resolver.assertNoReparsePoints(target);

    const [sourceExists, targetExists] = [await exists(source), await exists(target)];

    if (sourceExists && targetExists) {
      throw new StorageSecurityError('both_locations_exist', 'The release directory exists in both storage areas.');
    }

    if (!sourceExists) {
      if (targetExists) {
        await this.verifyDirectory(target, expected, { allowMissing: false });
      } else if (expected.size > 0) {
        throw new StorageSecurityError('release_directory_missing', 'The release directory does not exist.');
      }

      return;
    }

    await this.verifyDirectory(source, expected, { allowMissing: false });
    await this.ensureDirectory(this.resolver.dirname(target));
    await rename(source, target);
    await this.verifyDirectory(target, expected, { allowMissing: false });
  }

  /** Returns the names found; every entry must be an expected regular file of the expected size, or the manifest. */
  private async verifyDirectory(
    directory: string,
    expected: ExpectedFiles,
    options: { readonly allowMissing: boolean },
  ): Promise<readonly string[]> {
    const names = await readdir(directory);
    const remaining = new Map(expected);

    for (const name of names) {
      const stats = await lstat(this.resolver.join(directory, name));

      if (stats.isSymbolicLink()) {
        throw new StorageSecurityError(
          'reparse_point',
          'A symbolic link or junction was found inside the storage area.',
        );
      }

      const expectedSize = remaining.get(name);

      if (!stats.isFile() || (expectedSize === undefined && name !== RELEASE_MANIFEST_FILE_NAME)) {
        throw new StorageSecurityError('unexpected_entry', 'The release directory contains an unexpected entry.');
      }

      if (expectedSize !== undefined && stats.size !== expectedSize) {
        throw new StorageSecurityError('size_mismatch', 'A stored artifact does not have its recorded size.');
      }

      remaining.delete(name);
    }

    if (!options.allowMissing && remaining.size > 0) {
      throw new StorageSecurityError('artifact_missing', 'A recorded artifact is missing from the release directory.');
    }

    return names;
  }

  private async ensureDirectory(directory: string): Promise<void> {
    await this.resolver.assertNoReparsePoints(directory);
    await mkdir(directory, { recursive: true });
    await this.resolver.assertNoReparsePoints(directory);
  }
}

/**
 * The file names a release directory must contain. Each snapshot key has to point into the same release,
 * otherwise the snapshot itself is not trustworthy.
 */
function expectedFiles(directory: StorageKey, snapshot: readonly ArtifactSnapshotEntry[]): ExpectedFiles {
  const releaseId = storageKeySegments(directory)[2];
  const expected = new Map<string, number>();

  for (const entry of snapshot) {
    const [area, , entryReleaseId, fileName] = storageKeySegments(entry.storageKey);

    if (area !== 'objects' || entryReleaseId !== releaseId || fileName === undefined) {
      throw new StorageSecurityError(
        'snapshot_mismatch',
        'An artifact of the snapshot does not belong to the release.',
      );
    }

    expected.set(fileName, entry.sizeBytes);
  }

  return expected;
}

async function outcomeOf(work: () => Promise<void>): Promise<StorageOutcome> {
  try {
    await work();
    return { ok: true };
  } catch (error) {
    if (error instanceof StorageSecurityError) {
      return { ok: false, failure: { errorCode: error.code, securityViolation: true } };
    }

    // Locked files (virus scanner, backup, open downloads) and other I/O errors are retried with backoff.
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'unknown';
    return { ok: false, failure: { errorCode: `io_${code.toLowerCase()}`, securityViolation: false } };
  }
}

async function exists(target: string): Promise<boolean> {
  return (await lstat(target).catch(ignoreMissing)) !== null;
}

async function removeIfEmpty(directory: string): Promise<void> {
  try {
    await rmdir(directory);
  } catch (error) {
    if (!hasCode(error, 'ENOENT') && !hasCode(error, 'ENOTEMPTY') && !hasCode(error, 'EEXIST')) {
      throw error;
    }
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function assertRegularFile(target: string, sizeBytes: number): Promise<void> {
  const stats = await lstat(target);

  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new StorageSecurityError('unexpected_entry', 'An artifact location holds something other than a file.');
  }

  if (stats.size !== sizeBytes) {
    throw new StorageSecurityError('size_mismatch', 'A stored artifact does not have its recorded size.');
  }
}

function keyOf(path: string): StorageKey | null {
  try {
    return parseStorageKey(path);
  } catch {
    return null;
  }
}
