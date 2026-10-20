import { unreadable } from './zip-archive.js';

/** Value of a manifest attribute; `reference` marks a value that only resources.arsc could resolve. */
export type ManifestValue = string | number | boolean | { readonly reference: number };

export interface ManifestElement {
  readonly name: string;
  /** 0 for `<manifest>`, 1 for its children such as `<application>`. */
  readonly depth: number;
  readonly attributes: ReadonlyMap<string, ManifestValue>;
}

const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const RES_XML_END_ELEMENT_TYPE = 0x0103;
const UTF8_FLAG = 0x100;
const NO_ENTRY = 0xffffffff;

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

/** Attribute names by resource id, for manifests whose attribute names were stripped by an obfuscator. */
const ANDROID_ATTRIBUTES: Readonly<Record<number, string>> = {
  0x0101000f: 'debuggable',
  0x0101021b: 'versionCode',
  0x0101021c: 'versionName',
};

/**
 * Reads the compiled binary XML of an APK's `AndroidManifest.xml` (aapt format): a string pool, a map of
 * attribute resource ids and a flat sequence of element chunks. Only element names and attributes are kept.
 */
export function parseBinaryManifest(bytes: Buffer): ManifestElement[] {
  if (bytes.length < 8 || bytes.readUInt16LE(0) !== RES_XML_TYPE) {
    throw unreadable('AndroidManifest.xml is not compiled binary XML.');
  }

  const end = Math.min(bytes.length, bytes.readUInt32LE(4));
  let strings: readonly string[] = [];
  let resourceIds: readonly number[] = [];
  const elements: ManifestElement[] = [];
  let depth = 0;

  for (let position = bytes.readUInt16LE(2); position + 8 <= end;) {
    const type = bytes.readUInt16LE(position);
    const size = bytes.readUInt32LE(position + 4);

    if (size < 8 || position + size > end) {
      throw unreadable('AndroidManifest.xml contains a malformed chunk.');
    }

    const chunk = bytes.subarray(position, position + size);

    if (type === RES_STRING_POOL_TYPE) {
      strings = parseStringPool(chunk);
    } else if (type === RES_XML_RESOURCE_MAP_TYPE) {
      resourceIds = Array.from({ length: Math.floor((size - 8) / 4) }, (_, index) => chunk.readUInt32LE(8 + index * 4));
    } else if (type === RES_XML_START_ELEMENT_TYPE) {
      elements.push(parseStartElement(chunk, strings, resourceIds, depth));
      depth += 1;
    } else if (type === RES_XML_END_ELEMENT_TYPE) {
      depth = Math.max(0, depth - 1);
    }

    position += size;
  }

  return elements;
}

function parseStringPool(chunk: Buffer): string[] {
  const count = chunk.readUInt32LE(8);
  const utf8 = (chunk.readUInt32LE(16) & UTF8_FLAG) !== 0;
  const stringsStart = chunk.readUInt32LE(20);
  const headerSize = chunk.readUInt16LE(2);

  if (headerSize + count * 4 > chunk.length) {
    throw unreadable('AndroidManifest.xml has a malformed string pool.');
  }

  return Array.from({ length: count }, (_, index) => {
    const offset = stringsStart + chunk.readUInt32LE(headerSize + index * 4);
    return utf8 ? readUtf8(chunk, offset) : readUtf16(chunk, offset);
  });
}

function readUtf8(chunk: Buffer, offset: number): string {
  // Two lengths precede the bytes: in UTF-16 units, then in bytes; each takes two bytes if its high bit is set.
  let position = offset + (chunk[offset]! & 0x80 ? 2 : 1);
  let length = chunk[position]!;

  if (length & 0x80) {
    length = ((length & 0x7f) << 8) | chunk[position + 1]!;
    position += 1;
  }

  position += 1;
  return chunk.toString('utf8', position, Math.min(chunk.length, position + length));
}

function readUtf16(chunk: Buffer, offset: number): string {
  let length = chunk.readUInt16LE(offset);
  let position = offset + 2;

  if (length & 0x8000) {
    length = ((length & 0x7fff) << 16) | chunk.readUInt16LE(position);
    position += 2;
  }

  return chunk.toString('utf16le', position, Math.min(chunk.length, position + length * 2));
}

function parseStartElement(
  chunk: Buffer,
  strings: readonly string[],
  resourceIds: readonly number[],
  depth: number,
): ManifestElement {
  // The chunk header (16 bytes, including line number and comment) is followed by the element extension.
  const extension = chunk.readUInt16LE(2);
  const nameIndex = chunk.readUInt32LE(extension + 4);
  const attributeStart = chunk.readUInt16LE(extension + 8);
  const attributeSize = chunk.readUInt16LE(extension + 10);
  const attributeCount = chunk.readUInt16LE(extension + 12);
  const attributes = new Map<string, ManifestValue>();

  for (let index = 0; index < attributeCount; index += 1) {
    const position = extension + attributeStart + index * attributeSize;

    if (position + 20 > chunk.length) {
      throw unreadable('AndroidManifest.xml has a truncated attribute.');
    }

    const nameReference = chunk.readUInt32LE(position + 4);
    const name = ANDROID_ATTRIBUTES[resourceIds[nameReference] ?? -1] ?? strings[nameReference] ?? `#${nameReference}`;
    attributes.set(name, attributeValue(chunk, position, strings));
  }

  return { name: strings[nameIndex] ?? '', depth, attributes };
}

function attributeValue(chunk: Buffer, position: number, strings: readonly string[]): ManifestValue {
  const rawValue = chunk.readUInt32LE(position + 8);
  const dataType = chunk[position + 15]!;
  const data = chunk.readUInt32LE(position + 16);

  if (rawValue !== NO_ENTRY) {
    return strings[rawValue] ?? '';
  }

  switch (dataType) {
    case TYPE_STRING:
      return strings[data] ?? '';
    case TYPE_INT_DEC:
    case TYPE_INT_HEX:
      return chunk.readInt32LE(position + 16);
    case TYPE_INT_BOOLEAN:
      return data !== 0;
    case TYPE_REFERENCE:
      return { reference: data };
    default:
      return data;
  }
}
