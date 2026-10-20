import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import { isId, type UploadId } from '../../domain/value-objects/identifier.js';
import { storageKeySegments, type StorageKey } from '../../domain/value-objects/storage-key.js';

/** A safety check failed: the storage area does not look the way the platform left it. Never retried automatically. */
export class StorageSecurityError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StorageSecurityError';
  }
}

/**
 * The only place where storage keys become file system paths. Paths are built from validated key segments,
 * must stay below the root, and must not pass through symbolic links or junctions.
 */
export class StoragePathResolver {
  public readonly root: string;

  public constructor(
    root: string,
    private readonly paths: typeof path = path,
  ) {
    if (!paths.isAbsolute(root)) {
      throw new Error('Storage root must be an absolute path.');
    }

    this.root = paths.resolve(root);
  }

  public resolve(key: StorageKey): string {
    return this.within(this.paths.resolve(this.root, ...storageKeySegments(key)));
  }

  public resolveIncoming(uploadId: UploadId): string {
    if (!isId(uploadId)) {
      throw new StorageSecurityError('invalid_upload_id', 'Upload identifiers must be canonical identifiers.');
    }

    return this.within(this.paths.resolve(this.root, 'incoming', `${uploadId}.part`));
  }

  public dirname(target: string): string {
    return this.within(this.paths.dirname(target));
  }

  public join(directory: string, name: string): string {
    return this.within(this.paths.join(directory, name));
  }

  /** The root and every path from it down to the target, outermost first. */
  public chain(target: string): readonly string[] {
    const relative = this.paths.relative(this.root, this.within(target));
    const segments = relative === '' ? [] : relative.split(this.paths.sep);

    return segments.reduce<string[]>(
      (chain, segment) => [...chain, this.paths.join(chain.at(-1) ?? this.root, segment)],
      [this.root],
    );
  }

  /**
   * Fails if any existing component between root and target is a symbolic link or a junction. Node reports
   * both as symbolic links on Windows. Components below the first missing one cannot exist and are skipped.
   */
  public async assertNoReparsePoints(target: string): Promise<void> {
    for (const candidate of this.chain(target)) {
      const stats = await lstat(candidate).catch(ignoreMissing);

      if (stats === null) {
        return;
      }

      if (stats.isSymbolicLink()) {
        throw new StorageSecurityError(
          'reparse_point',
          'A symbolic link or junction was found inside the storage area.',
        );
      }
    }
  }

  /**
   * Startup check: the root must be an existing, real directory, and must neither lie inside nor contain
   * an area served by the web server, so that artifacts can only be reached through the access checks.
   */
  public async assertUsableRoot(servedAreas: readonly string[]): Promise<void> {
    const stats = await lstat(this.root).catch(ignoreMissing);

    if (stats === null || stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new StorageSecurityError('invalid_root', 'The storage root must be an existing directory, not a link.');
    }

    // Also rejects roots given as 8.3 short names or through linked parent directories: configure the full path.
    if (!this.samePath(await realpath(this.root), this.root)) {
      throw new StorageSecurityError('invalid_root', 'The storage root must not be reached through a link.');
    }

    for (const area of servedAreas) {
      const served = this.paths.resolve(area);

      if (this.isInside(this.root, served) || this.isInside(served, this.root)) {
        throw new StorageSecurityError(
          'root_in_served_area',
          'The storage root overlaps with an area served by the web server.',
        );
      }
    }
  }

  private isInside(candidate: string, area: string): boolean {
    const prefix = area.endsWith(this.paths.sep) ? area : `${area}${this.paths.sep}`;
    return this.samePath(candidate, area) || this.normalise(candidate).startsWith(this.normalise(prefix));
  }

  private within(target: string): string {
    if (!this.isInside(target, this.root)) {
      throw new StorageSecurityError('path_outside_root', 'A storage path left the storage root.');
    }

    return target;
  }

  private samePath(left: string, right: string): boolean {
    return this.normalise(this.paths.resolve(left)) === this.normalise(this.paths.resolve(right));
  }

  /** Windows paths compare case-insensitively. */
  private normalise(value: string): string {
    return this.paths.sep === '\\' ? value.toLowerCase() : value;
  }
}

export function ignoreMissing(error: unknown): null {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    return null;
  }

  throw error;
}
