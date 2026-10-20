import { crc32, deflateRawSync } from 'node:zlib';

import type { ReceivedFile } from '../../../../domain/ports/artifact-storage.js';

/** Builders for the file formats the inspector reads, so that tests do not depend on checked-in binaries. */

export interface ZipFile {
  readonly name: string;
  readonly data: Buffer | string;
  readonly stored?: boolean;
}

/** A ZIP archive; `zip64` writes the end records and size fields the way tools do for archives beyond 4 GB. */
export function zip(
  files: readonly ZipFile[],
  options: { readonly zip64?: boolean; readonly comment?: string } = {},
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const compressed = file.stored === true ? data : deflateRawSync(data);
    const method = file.stored === true ? 0 : 8;
    const name = Buffer.from(file.name);
    const local = Buffer.alloc(30);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const extra = options.zip64 === true ? Buffer.alloc(4 + 24) : Buffer.alloc(0);

    if (options.zip64 === true) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(data.length), 4);
      extra.writeBigUInt64LE(BigInt(compressed.length), 12);
      extra.writeBigUInt64LE(BigInt(offset), 20);
    }

    const central = Buffer.alloc(46);
    const saturated = options.zip64 === true;
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(45, 4);
    central.writeUInt16LE(45, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(saturated ? 0xffffffff : compressed.length, 20);
    central.writeUInt32LE(saturated ? 0xffffffff : data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(saturated ? 0xffffffff : offset, 42);
    centrals.push(central, name, extra);

    offset += local.length + name.length + compressed.length;
  }

  const directory = Buffer.concat(centrals);
  const comment = Buffer.from(options.comment ?? '');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(comment.length, 20);

  if (options.zip64 !== true) {
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end, comment]);
  }

  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeBigUInt64LE(BigInt(files.length), 24);
  record.writeBigUInt64LE(BigInt(files.length), 32);
  record.writeBigUInt64LE(BigInt(directory.length), 40);
  record.writeBigUInt64LE(BigInt(offset), 48);

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
  locator.writeUInt32LE(1, 16);

  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([...locals, directory, record, locator, end, comment]);
}

/* -- Android binary XML (aapt) --------------------------------------------------------------------------- */

export interface ManifestFields {
  readonly packageName: string;
  readonly versionCode: number;
  readonly versionName: string;
  readonly debuggable?: boolean;
}

const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_BOOLEAN = 0x12;

/**
 * `AndroidManifest.xml` as aapt compiles it. `stripNames` empties the attribute names, as obfuscators do, so
 * that only the resource map identifies them; `utf8` switches the string pool encoding.
 */
export function binaryManifest(
  fields: ManifestFields,
  options: { readonly utf8?: boolean; readonly stripNames?: boolean } = {},
): Buffer {
  // Attributes with resource ids come first in the pool, matching the resource map.
  const strings = [
    options.stripNames === true ? '' : 'versionCode',
    options.stripNames === true ? '' : 'versionName',
    options.stripNames === true ? '' : 'debuggable',
    ANDROID_NS,
    'android',
    'manifest',
    'package',
    fields.packageName,
    fields.versionName,
    'application',
  ];
  const index = (value: string, from = 3): number => strings.indexOf(value, from);
  const resourceMap = chunk(0x0180, 8, uint32s([0x0101021b, 0x0101021c, 0x0101000f]));

  const manifest = startElement(index('manifest'), [
    attribute(index(ANDROID_NS), 0, NO_ENTRY, TYPE_INT_DEC, fields.versionCode),
    attribute(index(ANDROID_NS), 1, index(fields.versionName), TYPE_STRING, index(fields.versionName)),
    attribute(NO_ENTRY, index('package'), index(fields.packageName), TYPE_STRING, index(fields.packageName)),
  ]);
  const application = startElement(
    index('application'),
    fields.debuggable === undefined
      ? []
      : [attribute(index(ANDROID_NS), 2, NO_ENTRY, TYPE_INT_BOOLEAN, fields.debuggable ? 0xffffffff : 0)],
  );

  const body = Buffer.concat([
    stringPool(strings, options.utf8 === true),
    resourceMap,
    manifest,
    application,
    endElement(index('application')),
    endElement(index('manifest')),
  ]);

  return chunk(0x0003, 8, body);
}

const NO_ENTRY = 0xffffffff;

function chunk(type: number, headerSize: number, body: Buffer, header: Buffer = Buffer.alloc(0)): Buffer {
  const start = Buffer.alloc(8);
  start.writeUInt16LE(type, 0);
  start.writeUInt16LE(headerSize, 2);
  start.writeUInt32LE(8 + header.length + body.length, 4);
  return Buffer.concat([start, header, body]);
}

function uint32s(values: readonly number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, position) => buffer.writeUInt32LE(value >>> 0, position * 4));
  return buffer;
}

function stringPool(strings: readonly string[], utf8: boolean): Buffer {
  const encoded = strings.map((value) => {
    if (utf8) {
      const bytes = Buffer.from(value, 'utf8');
      return Buffer.concat([Buffer.from([value.length, bytes.length]), bytes, Buffer.from([0])]);
    }

    const length = Buffer.alloc(2);
    length.writeUInt16LE(value.length);
    return Buffer.concat([length, Buffer.from(value, 'utf16le'), Buffer.alloc(2)]);
  });
  const offsets: number[] = [];
  let position = 0;

  for (const entry of encoded) {
    offsets.push(position);
    position += entry.length;
  }

  const data = Buffer.concat(encoded);
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(strings.length, 0);
  header.writeUInt32LE(0, 4);
  header.writeUInt32LE(utf8 ? 0x100 : 0, 8);
  header.writeUInt32LE(28 + strings.length * 4, 12);
  header.writeUInt32LE(0, 16);

  return chunk(0x0001, 28, Buffer.concat([uint32s(offsets), padded]), header);
}

function attribute(namespace: number, name: number, rawValue: number, dataType: number, data: number): Buffer {
  const buffer = Buffer.alloc(20);
  buffer.writeUInt32LE(namespace >>> 0, 0);
  buffer.writeUInt32LE(name >>> 0, 4);
  buffer.writeUInt32LE(rawValue >>> 0, 8);
  buffer.writeUInt16LE(8, 12);
  buffer[15] = dataType;
  buffer.writeUInt32LE(data >>> 0, 16);
  return buffer;
}

function startElement(name: number, attributes: readonly Buffer[]): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(1, 0);
  header.writeUInt32LE(NO_ENTRY, 4);

  const extension = Buffer.alloc(20);
  extension.writeUInt32LE(NO_ENTRY, 0);
  extension.writeUInt32LE(name, 4);
  extension.writeUInt16LE(20, 8);
  extension.writeUInt16LE(20, 10);
  extension.writeUInt16LE(attributes.length, 12);

  return chunk(0x0102, 16, Buffer.concat([extension, ...attributes]), header);
}

function endElement(name: number): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(1, 0);
  header.writeUInt32LE(NO_ENTRY, 4);
  return chunk(0x0103, 16, uint32s([NO_ENTRY, name]), header);
}

/* -- Android App Bundle manifest (aapt2 protocol buffer) ------------------------------------------------- */

export function protoManifest(fields: ManifestFields): Buffer {
  const versionCode = message([
    field(2, 'versionCode'),
    field(3, String(fields.versionCode)),
    field(6, message([field(7, message([varintField(6, fields.versionCode)]))])),
  ]);
  const versionName = message([field(2, 'versionName'), field(3, fields.versionName)]);
  const packageName = message([field(2, 'package'), field(3, fields.packageName)]);
  const applicationAttributes =
    fields.debuggable === undefined
      ? []
      : [
          field(
            4,
            message([
              field(2, 'debuggable'),
              field(3, String(fields.debuggable)),
              field(6, message([field(7, message([varintField(8, fields.debuggable ? 1 : 0)]))])),
            ]),
          ),
        ];
  const application = message([field(1, message([field(3, 'application'), ...applicationAttributes]))]);
  const manifest = message([
    field(3, 'manifest'),
    field(4, versionCode),
    field(4, versionName),
    field(4, packageName),
    field(5, application),
  ]);

  return message([field(1, manifest)]);
}

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let rest = BigInt(value);

  do {
    const byte = Number(rest & 0x7fn);
    rest >>= 7n;
    bytes.push(rest === 0n ? byte : byte | 0x80);
  } while (rest !== 0n);

  return Buffer.from(bytes);
}

function field(number: number, value: Buffer | string): Buffer {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([varint((number << 3) | 2), varint(bytes.length), bytes]);
}

function varintField(number: number, value: number): Buffer {
  return Buffer.concat([varint(number << 3), varint(value)]);
}

function message(fields: readonly Buffer[]): Buffer {
  return Buffer.concat(fields);
}

/* -- Property lists -------------------------------------------------------------------------------------- */

export type PlistInput = Readonly<Record<string, string | number | boolean>>;

/** A `bplist00` with one-byte offsets and references, as Xcode writes small property lists. */
export function binaryPlist(values: PlistInput): Buffer {
  const objects: Buffer[] = [];
  const add = (object: Buffer): number => objects.push(object) - 1;
  const entries = Object.entries(values);
  const dictionary = add(Buffer.alloc(0));
  const keys = entries.map(([key]) => add(plistString(key)));
  const items = entries.map(([, value]) =>
    add(
      typeof value === 'string'
        ? plistString(value)
        : typeof value === 'boolean'
          ? Buffer.from([value ? 0x09 : 0x08])
          : Buffer.from([0x12, ...uint32be(value)]),
    ),
  );
  objects[dictionary] = Buffer.concat([lengthMarker(0xd, entries.length), Buffer.from([...keys, ...items])]);

  const magic = Buffer.from('bplist00');
  const offsets: number[] = [];
  let position = magic.length;

  for (const object of objects) {
    offsets.push(position);
    position += object.length;
  }

  const trailer = Buffer.alloc(32);
  trailer[6] = 1;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(BigInt(dictionary), 16);
  trailer.writeBigUInt64BE(BigInt(position), 24);

  return Buffer.concat([magic, ...objects, Buffer.from(offsets), trailer]);
}

function plistString(value: string): Buffer {
  const ascii = [...value].every((character) => character.charCodeAt(0) < 0x80);

  if (ascii) {
    return Buffer.concat([lengthMarker(0x5, value.length), Buffer.from(value, 'latin1')]);
  }

  const utf16 = Buffer.from(value, 'utf16le');
  utf16.swap16();
  return Buffer.concat([lengthMarker(0x6, value.length), utf16]);
}

function lengthMarker(type: number, length: number): Buffer {
  return length < 15 ? Buffer.from([(type << 4) | length]) : Buffer.from([(type << 4) | 0x0f, 0x10, length]);
}

function uint32be(value: number): number[] {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return [...buffer];
}

export function xmlPlist(values: PlistInput): Buffer {
  const items = Object.entries(values).map(([key, value]) => {
    const element =
      typeof value === 'string'
        ? `<string>${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</string>`
        : typeof value === 'boolean'
          ? `<${String(value)}/>`
          : `<integer>${value}</integer>`;
    return `  <key>${key}</key>\n  ${element}`;
  });

  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${items.join('\n')}\n  <key>UIDeviceFamily</key>\n  <array><integer>1</integer><integer>2</integer></array>\n</dict>\n</plist>\n`,
  );
}

/* -- Complete binaries ------------------------------------------------------------------------------------ */

export function apk(fields: ManifestFields, abis: readonly string[] = []): Buffer {
  return zip([
    { name: 'AndroidManifest.xml', data: binaryManifest(fields) },
    { name: 'classes.dex', data: 'dex\n035' },
    ...abis.map((abi) => ({ name: `lib/${abi}/libapp.so`, data: 'ELF' })),
  ]);
}

export function aab(fields: ManifestFields): Buffer {
  return zip([
    { name: 'BundleConfig.pb', data: '' },
    { name: 'base/manifest/AndroidManifest.xml', data: protoManifest(fields) },
    { name: 'base/dex/classes.dex', data: 'dex\n035' },
  ]);
}

export interface IpaFields {
  readonly bundleIdentifier: string;
  readonly version: string;
  readonly buildNumber: string;
}

export function ipa(fields: IpaFields, options: { readonly xml?: boolean } = {}): Buffer {
  const plist: PlistInput = {
    CFBundleIdentifier: fields.bundleIdentifier,
    CFBundleShortVersionString: fields.version,
    CFBundleVersion: fields.buildNumber,
    CFBundleName: 'Runner',
    LSRequiresIPhoneOS: true,
  };

  return zip([
    { name: 'Payload/', data: '', stored: true },
    { name: 'Payload/Runner.app/Info.plist', data: options.xml === true ? xmlPlist(plist) : binaryPlist(plist) },
    { name: 'Payload/Runner.app/Runner', data: 'Mach-O' },
    { name: 'Payload/Runner.app/Frameworks/App.framework/Info.plist', data: binaryPlist({ CFBundleName: 'App' }) },
  ]);
}

/** A received upload held in memory. */
export function inMemoryFile(bytes: Buffer): ReceivedFile {
  return {
    sizeBytes: bytes.length,
    read: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)),
    close: () => Promise.resolve(),
  };
}
