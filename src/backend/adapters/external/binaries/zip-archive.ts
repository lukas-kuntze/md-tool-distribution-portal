import { inflateRawSync } from 'node:zlib';

import type { ReceivedFile } from '../../../domain/ports/artifact-storage.js';
import { DomainError } from '../../../domain/value-objects/domain-error.js';

/** APK, AAB and IPA are ZIP archives; every limit here guards against crafted archives. */
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const MAX_UINT32 = 0xffffffff;
const MAX_UINT16 = 0xffff;
const END_RECORD_SIZE = 22;
const MAX_COMMENT_LENGTH = 0xffff;

/** Large IPAs hold tens of thousands of files; their central directory still stays far below this. */
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly flags: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

/** Reads the central directory of a ZIP archive and single entries from it, without loading the whole file. */
export class ZipArchive {
  private constructor(
    private readonly file: ReceivedFile,
    public readonly entries: readonly ZipEntry[],
  ) {}

  public static async open(file: ReceivedFile): Promise<ZipArchive> {
    const directory = await locateCentralDirectory(file);

    if (directory.size > MAX_CENTRAL_DIRECTORY_BYTES || directory.offset + directory.size > file.sizeBytes) {
      throw unreadable('The archive has an implausible central directory.');
    }

    const bytes = await readExactly(file, directory.offset, directory.size);
    return new ZipArchive(file, parseCentralDirectory(bytes, directory.count));
  }

  public find(name: string): ZipEntry | undefined {
    return this.entries.find((entry) => entry.name === name);
  }

  /** Content of a small entry such as a manifest; larger entries are refused instead of being inflated. */
  public async read(entry: ZipEntry, maxBytes: number): Promise<Buffer> {
    if (entry.uncompressedSize > maxBytes) {
      throw unreadable('An archive entry is larger than expected.');
    }

    if ((entry.flags & 0x1) !== 0) {
      throw unreadable('Encrypted archives are not supported.');
    }

    const header = await readExactly(this.file, entry.localHeaderOffset, 30);

    if (header.readUInt32LE(0) !== LOCAL_FILE_HEADER) {
      throw unreadable('An archive entry has no valid local header.');
    }

    const dataOffset = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const data = await readExactly(this.file, dataOffset, entry.compressedSize);
    const content = inflate(entry, data, maxBytes);

    if (content.length !== entry.uncompressedSize) {
      throw unreadable('An archive entry does not have its declared size.');
    }

    return content;
  }
}

interface CentralDirectory {
  readonly offset: number;
  readonly size: number;
  readonly count: number;
}

async function locateCentralDirectory(file: ReceivedFile): Promise<CentralDirectory> {
  const tailLength = Math.min(file.sizeBytes, END_RECORD_SIZE + MAX_COMMENT_LENGTH);
  const tailStart = file.sizeBytes - tailLength;
  const tail = Buffer.from(await file.read(tailStart, tailLength));

  for (let position = tail.length - END_RECORD_SIZE; position >= 0; position -= 1) {
    if (tail.readUInt32LE(position) !== END_OF_CENTRAL_DIRECTORY) {
      continue;
    }

    const count = tail.readUInt16LE(position + 10);
    const size = tail.readUInt32LE(position + 12);
    const offset = tail.readUInt32LE(position + 16);

    if (count !== MAX_UINT16 && size !== MAX_UINT32 && offset !== MAX_UINT32) {
      return { offset, size, count };
    }

    return locateZip64CentralDirectory(file, tailStart + position);
  }

  throw unreadable('The file is not a ZIP archive.');
}

async function locateZip64CentralDirectory(file: ReceivedFile, endRecordOffset: number): Promise<CentralDirectory> {
  if (endRecordOffset < 20) {
    throw unreadable('The archive lacks its ZIP64 locator.');
  }

  const locator = await readExactly(file, endRecordOffset - 20, 20);

  if (locator.readUInt32LE(0) !== ZIP64_LOCATOR) {
    throw unreadable('The archive lacks its ZIP64 locator.');
  }

  const record = await readExactly(file, toSafeNumber(locator.readBigUInt64LE(8)), 56);

  if (record.readUInt32LE(0) !== ZIP64_END_OF_CENTRAL_DIRECTORY) {
    throw unreadable('The archive has an invalid ZIP64 end record.');
  }

  return {
    count: toSafeNumber(record.readBigUInt64LE(32)),
    size: toSafeNumber(record.readBigUInt64LE(40)),
    offset: toSafeNumber(record.readBigUInt64LE(48)),
  };
}

function parseCentralDirectory(bytes: Buffer, count: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let position = 0;

  // The declared count may be truncated to 16 bits in non-ZIP64 archives, so the bytes decide.
  while (position + 46 <= bytes.length && bytes.readUInt32LE(position) === CENTRAL_DIRECTORY_HEADER) {
    const nameLength = bytes.readUInt16LE(position + 28);
    const extraLength = bytes.readUInt16LE(position + 30);
    const commentLength = bytes.readUInt16LE(position + 32);
    const end = position + 46 + nameLength + extraLength + commentLength;

    if (end > bytes.length) {
      throw unreadable('The central directory is truncated.');
    }

    const sizes = {
      uncompressedSize: bytes.readUInt32LE(position + 24),
      compressedSize: bytes.readUInt32LE(position + 20),
      localHeaderOffset: bytes.readUInt32LE(position + 42),
    };
    const extra = bytes.subarray(position + 46 + nameLength, position + 46 + nameLength + extraLength);

    entries.push({
      name: bytes.toString('utf8', position + 46, position + 46 + nameLength),
      flags: bytes.readUInt16LE(position + 8),
      method: bytes.readUInt16LE(position + 10),
      ...applyZip64Extra(sizes, extra),
    });
    position = end;
  }

  if (entries.length === 0 || (count !== MAX_UINT16 && entries.length < count)) {
    throw unreadable('The central directory is incomplete.');
  }

  return entries;
}

type EntrySizes = Pick<ZipEntry, 'uncompressedSize' | 'compressedSize' | 'localHeaderOffset'>;

/** ZIP64 stores the 64-bit values in an extra field, in this order, for each 32-bit field that is saturated. */
function applyZip64Extra(sizes: EntrySizes, extra: Buffer): EntrySizes {
  const saturated = (Object.keys(sizes) as (keyof EntrySizes)[]).filter((key) => sizes[key] === MAX_UINT32);

  if (saturated.length === 0) {
    return sizes;
  }

  for (let position = 0; position + 4 <= extra.length;) {
    const id = extra.readUInt16LE(position);
    const length = extra.readUInt16LE(position + 2);

    if (id === ZIP64_EXTRA_FIELD && length >= saturated.length * 8 && position + 4 + length <= extra.length) {
      const result = { ...sizes };
      saturated.forEach((key, index) => {
        result[key] = toSafeNumber(extra.readBigUInt64LE(position + 4 + index * 8));
      });
      return result;
    }

    position += 4 + length;
  }

  throw unreadable('An archive entry lacks its ZIP64 sizes.');
}

function inflate(entry: ZipEntry, data: Buffer, maxBytes: number): Buffer {
  if (entry.method === 0) {
    return data;
  }

  if (entry.method !== 8) {
    throw unreadable('An archive entry uses an unsupported compression method.');
  }

  try {
    return inflateRawSync(data, { maxOutputLength: Math.max(1, maxBytes) });
  } catch {
    throw unreadable('An archive entry could not be decompressed.');
  }
}

async function readExactly(file: ReceivedFile, offset: number, length: number): Promise<Buffer> {
  const bytes = offset >= 0 && offset + length <= file.sizeBytes ? Buffer.from(await file.read(offset, length)) : null;

  if (bytes === null || bytes.length !== length) {
    throw unreadable('The archive is truncated.');
  }

  return bytes;
}

function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw unreadable('The archive declares an implausible size.');
  }

  return Number(value);
}

export function unreadable(message: string): DomainError {
  return new DomainError('unreadable_binary', message);
}
