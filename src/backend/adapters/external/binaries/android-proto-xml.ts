import type { ManifestElement, ManifestValue } from './android-binary-xml.js';
import { unreadable } from './zip-archive.js';

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;
const MAX_DEPTH = 64;

/**
 * Reads `base/manifest/AndroidManifest.xml` of an Android App Bundle, which aapt2 stores as protocol buffer
 * (`aapt.pb.XmlNode` from Resources.proto) instead of binary XML. Only the fields needed here are decoded:
 *
 * - XmlNode: 1 element
 * - XmlElement: 3 name, 4 attribute, 5 child
 * - XmlAttribute: 2 name, 3 value, 6 compiled_item
 * - Item: 7 prim; Primitive: 6 int_decimal_value, 7 int_hexadecimal_value, 8 boolean_value
 */
export function parseProtoManifest(bytes: Buffer): ManifestElement[] {
  const elements: ManifestElement[] = [];
  const root = fieldsOf(bytes).find((field) => field.number === 1 && field.bytes !== null);

  if (root?.bytes === undefined || root.bytes === null) {
    throw unreadable('AndroidManifest.xml of the bundle has no root element.');
  }

  collectElements(root.bytes, 0, elements);
  return elements;
}

function collectElements(element: Buffer, depth: number, elements: ManifestElement[]): void {
  if (depth > MAX_DEPTH) {
    throw unreadable('AndroidManifest.xml of the bundle is nested too deeply.');
  }

  const fields = fieldsOf(element);
  const attributes = new Map<string, ManifestValue>();
  let name = '';

  for (const field of fields) {
    if (field.number === 3 && field.bytes !== null) {
      name = field.bytes.toString('utf8');
    } else if (field.number === 4 && field.bytes !== null) {
      const [attributeName, value] = attributeOf(field.bytes);
      attributes.set(attributeName, value);
    }
  }

  elements.push({ name, depth, attributes });

  for (const child of fields) {
    if (child.number === 5 && child.bytes !== null) {
      const nested = fieldsOf(child.bytes).find((field) => field.number === 1 && field.bytes !== null);

      if (nested?.bytes !== undefined && nested.bytes !== null) {
        collectElements(nested.bytes, depth + 1, elements);
      }
    }
  }
}

function attributeOf(bytes: Buffer): [string, ManifestValue] {
  let name = '';
  let text: string | null = null;
  let compiled: ManifestValue | null = null;

  for (const field of fieldsOf(bytes)) {
    if (field.number === 2 && field.bytes !== null) {
      name = field.bytes.toString('utf8');
    } else if (field.number === 3 && field.bytes !== null) {
      text = field.bytes.toString('utf8');
    } else if (field.number === 6 && field.bytes !== null) {
      compiled = primitiveOf(field.bytes);
    }
  }

  // aapt2 keeps the source text next to the compiled value; the compiled value wins for numbers and booleans.
  return [name, compiled ?? text ?? ''];
}

function primitiveOf(item: Buffer): ManifestValue | null {
  const primitive = fieldsOf(item).find((field) => field.number === 7 && field.bytes !== null);

  if (primitive?.bytes === undefined || primitive.bytes === null) {
    return null;
  }

  for (const field of fieldsOf(primitive.bytes)) {
    if ((field.number === 6 || field.number === 7) && field.varint !== null) {
      return Number(BigInt.asIntN(32, field.varint));
    }

    if (field.number === 8 && field.varint !== null) {
      return field.varint !== 0n;
    }
  }

  return null;
}

interface Field {
  readonly number: number;
  readonly varint: bigint | null;
  readonly bytes: Buffer | null;
}

function fieldsOf(bytes: Buffer): Field[] {
  const fields: Field[] = [];
  let position = 0;

  while (position < bytes.length) {
    const [key, afterKey] = readVarint(bytes, position);
    const number = Number(key >> 3n);
    const wireType = Number(key & 0x7n);
    position = afterKey;

    if (wireType === WIRE_VARINT) {
      const [value, next] = readVarint(bytes, position);
      fields.push({ number, varint: value, bytes: null });
      position = next;
    } else if (wireType === WIRE_LENGTH_DELIMITED) {
      const [length, next] = readVarint(bytes, position);
      const end = next + Number(length);

      if (length > BigInt(bytes.length) || end > bytes.length) {
        throw unreadable('AndroidManifest.xml of the bundle is truncated.');
      }

      fields.push({ number, varint: null, bytes: bytes.subarray(next, end) });
      position = end;
    } else if (wireType === WIRE_FIXED64 || wireType === WIRE_FIXED32) {
      position += wireType === WIRE_FIXED64 ? 8 : 4;
    } else {
      throw unreadable('AndroidManifest.xml of the bundle is not a valid protocol buffer.');
    }
  }

  if (position > bytes.length) {
    throw unreadable('AndroidManifest.xml of the bundle is truncated.');
  }

  return fields;
}

function readVarint(bytes: Buffer, start: number): [bigint, number] {
  let value = 0n;

  for (let position = start, shift = 0n; position < bytes.length && shift < 64n; position += 1, shift += 7n) {
    const byte = bytes[position]!;
    value |= BigInt(byte & 0x7f) << shift;

    if ((byte & 0x80) === 0) {
      return [value, position + 1];
    }
  }

  throw unreadable('AndroidManifest.xml of the bundle is not a valid protocol buffer.');
}
