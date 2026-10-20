import { unreadable } from './zip-archive.js';

export type PlistValue = string | number | boolean | null | Buffer | Date | PlistValue[] | PlistDictionary;

export interface PlistDictionary {
  readonly [key: string]: PlistValue;
}

const BINARY_MAGIC = 'bplist00';
const MAX_DEPTH = 64;

/** Reads an `Info.plist`, which Xcode ships in binary form (`bplist00`); XML property lists are accepted too. */
export function parsePropertyList(bytes: Buffer): PlistDictionary {
  const root = bytes.toString('latin1', 0, BINARY_MAGIC.length) === BINARY_MAGIC ? parseBinary(bytes) : parseXml(bytes);

  if (!isDictionary(root)) {
    throw unreadable('Info.plist does not contain a dictionary.');
  }

  return root;
}

function isDictionary(value: PlistValue): value is PlistDictionary {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !Buffer.isBuffer(value) &&
    !(value instanceof Date)
  );
}

/* -- Binary property list ---------------------------------------------------------------------------------- */

function parseBinary(bytes: Buffer): PlistValue {
  if (bytes.length < BINARY_MAGIC.length + 32) {
    throw unreadable('Info.plist is truncated.');
  }

  const trailer = bytes.subarray(bytes.length - 32);
  const offsetSize = trailer[6]!;
  const referenceSize = trailer[7]!;
  const objectCount = safe(trailer.readBigUInt64BE(8));
  const topObject = safe(trailer.readBigUInt64BE(16));
  const offsetTable = safe(trailer.readBigUInt64BE(24));

  if (
    ![1, 2, 4, 8].includes(offsetSize) ||
    ![1, 2, 4, 8].includes(referenceSize) ||
    offsetTable + objectCount * offsetSize > bytes.length - 32 ||
    topObject >= objectCount
  ) {
    throw unreadable('Info.plist has an invalid trailer.');
  }

  const offsetOf = (index: number): number => readUnsigned(bytes, offsetTable + index * offsetSize, offsetSize);

  const readObject = (index: number, depth: number): PlistValue => {
    if (index >= objectCount || depth > MAX_DEPTH) {
      throw unreadable('Info.plist references an invalid object.');
    }

    const offset = offsetOf(index);
    const marker = bytes[offset];

    if (marker === undefined) {
      throw unreadable('Info.plist references an invalid object.');
    }

    const type = marker >> 4;
    const info = marker & 0x0f;

    switch (type) {
      case 0x0:
        return info === 0x8 ? false : info === 0x9 ? true : null;
      case 0x1:
        return readSigned(bytes, offset + 1, 1 << info);
      case 0x2:
        return info === 2 ? bytes.readFloatBE(offset + 1) : bytes.readDoubleBE(offset + 1);
      case 0x3:
        return new Date(Date.UTC(2001, 0, 1) + bytes.readDoubleBE(offset + 1) * 1000);
      case 0x4: {
        const [length, start] = lengthOf(info, offset);
        return Buffer.from(slice(start, length));
      }
      case 0x5: {
        const [length, start] = lengthOf(info, offset);
        return slice(start, length).toString('latin1');
      }
      case 0x6: {
        const [length, start] = lengthOf(info, offset);
        return utf16be(slice(start, length * 2));
      }
      case 0x8:
        return readUnsigned(bytes, offset + 1, info + 1);
      case 0xa: {
        const [length, start] = lengthOf(info, offset);
        return Array.from({ length }, (_, item) =>
          readObject(readUnsigned(bytes, start + item * referenceSize, referenceSize), depth + 1),
        );
      }
      case 0xd: {
        const [length, start] = lengthOf(info, offset);
        const dictionary: Record<string, PlistValue> = {};

        for (let item = 0; item < length; item += 1) {
          const key = readObject(readUnsigned(bytes, start + item * referenceSize, referenceSize), depth + 1);
          const value = readUnsigned(bytes, start + (length + item) * referenceSize, referenceSize);

          if (typeof key === 'string') {
            dictionary[key] = readObject(value, depth + 1);
          }
        }

        return dictionary;
      }
      default:
        throw unreadable('Info.plist contains an unsupported object type.');
    }
  };

  /** Counts below 15 sit in the marker; larger ones follow as an integer object. */
  const lengthOf = (info: number, offset: number): [number, number] => {
    if (info !== 0x0f) {
      return [info, offset + 1];
    }

    const intMarker = bytes[offset + 1];

    if (intMarker === undefined || intMarker >> 4 !== 0x1) {
      throw unreadable('Info.plist has an invalid length.');
    }

    const size = 1 << (intMarker & 0x0f);
    return [readUnsigned(bytes, offset + 2, size), offset + 2 + size];
  };

  const slice = (start: number, length: number): Buffer => {
    if (start + length > bytes.length) {
      throw unreadable('Info.plist is truncated.');
    }

    return bytes.subarray(start, start + length);
  };

  return readObject(topObject, 0);
}

function readUnsigned(bytes: Buffer, offset: number, size: number): number {
  if (offset + size > bytes.length) {
    throw unreadable('Info.plist is truncated.');
  }

  return size === 8 ? safe(bytes.readBigUInt64BE(offset)) : bytes.readUIntBE(offset, size);
}

function readSigned(bytes: Buffer, offset: number, size: number): number {
  if (offset + size > bytes.length || size > 16) {
    throw unreadable('Info.plist is truncated.');
  }

  // 8-byte integers are signed; 16-byte ones only occur for unsigned values beyond 2^63.
  return size >= 8 ? safe(bytes.readBigInt64BE(offset + size - 8)) : bytes.readUIntBE(offset, size);
}

function utf16be(bytes: Buffer): string {
  const swapped = Buffer.from(bytes);
  swapped.swap16();
  return swapped.toString('utf16le');
}

function safe(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw unreadable('Info.plist contains an implausible number.');
  }

  return Number(value);
}

/* -- XML property list --------------------------------------------------------------------------------------- */

const TOKEN = /<(\/?)([a-zA-Z]+)\s*(\/?)>|<\?[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g;
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function parseXml(bytes: Buffer): PlistValue {
  const text = bytes.toString('utf8');
  const tokens = [...text.matchAll(TOKEN)].filter((match) => match[2] !== undefined);
  let index = 0;

  const expectClose = (name: string): string => {
    const open = tokens[index - 1]!;
    const close = tokens[index];

    if (close === undefined || close[1] !== '/' || close[2] !== name) {
      throw unreadable('Info.plist is not a valid XML property list.');
    }

    index += 1;
    return decode(text.slice(open.index + open[0].length, close.index));
  };

  const readValue = (depth: number): PlistValue => {
    const token = tokens[index];

    if (token === undefined || token[1] === '/' || depth > MAX_DEPTH) {
      throw unreadable('Info.plist is not a valid XML property list.');
    }

    index += 1;
    const [, , name, selfClosing] = token;

    if (selfClosing === '/') {
      return name === 'true' ? true : name === 'false' ? false : name === 'array' ? [] : name === 'dict' ? {} : '';
    }

    switch (name) {
      case 'string':
        return expectClose('string');
      case 'integer':
      case 'real':
        return Number(expectClose(name ?? ''));
      case 'date':
        return new Date(expectClose('date'));
      case 'data':
        return Buffer.from(expectClose('data').replace(/\s+/g, ''), 'base64');
      case 'array': {
        const items: PlistValue[] = [];

        while (tokens[index] !== undefined && tokens[index]![1] !== '/') {
          items.push(readValue(depth + 1));
        }

        index += 1;
        return items;
      }
      case 'dict': {
        const dictionary: Record<string, PlistValue> = {};

        while (tokens[index] !== undefined && tokens[index]![1] !== '/') {
          if (tokens[index]![2] !== 'key') {
            throw unreadable('Info.plist is not a valid XML property list.');
          }

          index += 1;
          const key = expectClose('key');
          dictionary[key] = readValue(depth + 1);
        }

        index += 1;
        return dictionary;
      }
      case 'plist':
        return readValue(depth + 1);
      default:
        throw unreadable('Info.plist contains an unsupported element.');
    }
  };

  return readValue(0);
}

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }

    if (name.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    }

    return ENTITIES[name] ?? entity;
  });
}
