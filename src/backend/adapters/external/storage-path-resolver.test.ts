import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseId, type UploadId } from '../../domain/value-objects/identifier.js';
import { releaseDirectoryKey } from '../../domain/value-objects/storage-key.js';
import { StoragePathResolver } from './storage-path-resolver.js';

const applicationId = parseId<'Application'>('0192f3a4-0000-7000-8000-000000000020');
const releaseId = parseId<'Release'>('0192f3a4-0000-7000-8000-000000000100');
const errorCode = (code: string): unknown => expect.objectContaining({ code });

describe('StoragePathResolver on Windows paths', (): void => {
  const resolver = new StoragePathResolver('D:\\AppDistribution\\storage', path.win32);

  it('maps storage keys below the root', (): void => {
    expect(resolver.resolve(releaseDirectoryKey(applicationId, releaseId))).toBe(
      `D:\\AppDistribution\\storage\\objects\\${applicationId}\\${releaseId}`,
    );
  });

  it('places uploads in the incoming area', (): void => {
    expect(resolver.resolveIncoming(parseId('0192f3a4-0000-7000-8000-000000000300'))).toBe(
      'D:\\AppDistribution\\storage\\incoming\\0192f3a4-0000-7000-8000-000000000300.part',
    );
  });

  it('compares paths case-insensitively and rejects everything outside the root', (): void => {
    expect(resolver.join('d:\\appdistribution\\STORAGE\\objects', 'x')).toBe(
      'd:\\appdistribution\\STORAGE\\objects\\x',
    );
    expect(() => resolver.join('D:\\AppDistribution\\storage', '..\\secrets')).toThrow(errorCode('path_outside_root'));
    expect(() => resolver.join('D:\\AppDistribution\\storage-other', 'x')).toThrow(errorCode('path_outside_root'));
    expect(() => resolver.dirname('D:\\AppDistribution\\storage')).toThrow(errorCode('path_outside_root'));
  });

  it('rejects forged upload identifiers', (): void => {
    expect(() => resolver.resolveIncoming('..\\..\\evil' as UploadId)).toThrow(errorCode('invalid_upload_id'));
  });

  it('lists the chain of components from the root to a target', (): void => {
    expect(resolver.chain('D:\\AppDistribution\\storage\\objects\\a')).toEqual([
      'D:\\AppDistribution\\storage',
      'D:\\AppDistribution\\storage\\objects',
      'D:\\AppDistribution\\storage\\objects\\a',
    ]);
  });

  it('requires an absolute root', (): void => {
    expect(() => new StoragePathResolver('storage', path.win32)).toThrow('absolute');
  });
});

describe('StoragePathResolver on disk', (): void => {
  let base: string;
  let resolver: StoragePathResolver;

  beforeEach(async (): Promise<void> => {
    base = await mkdtemp(path.join(tmpdir(), 'storage-resolver-'));
    await mkdir(path.join(base, 'storage', 'objects'), { recursive: true });
    resolver = new StoragePathResolver(path.join(base, 'storage'));
  });

  afterEach(async (): Promise<void> => {
    await rm(base, { recursive: true, force: true });
  });

  it('accepts plain directories and paths that do not exist yet', async (): Promise<void> => {
    await expect(
      resolver.assertNoReparsePoints(resolver.resolve(releaseDirectoryKey(applicationId, releaseId))),
    ).resolves.toBeUndefined();
  });

  it('detects a directory link inside the storage area', async (): Promise<void> => {
    await mkdir(path.join(base, 'elsewhere'));
    await symlink(path.join(base, 'elsewhere'), path.join(base, 'storage', 'objects', applicationId), 'junction');

    await expect(
      resolver.assertNoReparsePoints(resolver.resolve(releaseDirectoryKey(applicationId, releaseId))),
    ).rejects.toThrow(errorCode('reparse_point'));
  });

  it('accepts a real root outside the served areas', async (): Promise<void> => {
    await expect(resolver.assertUsableRoot([path.join(base, 'wwwroot')])).resolves.toBeUndefined();
  });

  it('rejects roots inside or around a served area, missing roots and linked roots', async (): Promise<void> => {
    await symlink(path.join(base, 'storage'), path.join(base, 'linked'), 'junction');

    await expect(resolver.assertUsableRoot([base])).rejects.toThrow(errorCode('root_in_served_area'));
    await expect(resolver.assertUsableRoot([path.join(base, 'storage', 'objects')])).rejects.toThrow(
      errorCode('root_in_served_area'),
    );
    await expect(new StoragePathResolver(path.join(base, 'missing')).assertUsableRoot([])).rejects.toThrow(
      errorCode('invalid_root'),
    );
    await expect(new StoragePathResolver(path.join(base, 'linked')).assertUsableRoot([])).rejects.toThrow(
      errorCode('invalid_root'),
    );
    await expect(new StoragePathResolver(path.join(base, 'linked', 'objects')).assertUsableRoot([])).rejects.toThrow(
      errorCode('invalid_root'),
    );
  });
});
