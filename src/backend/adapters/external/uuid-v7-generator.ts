import { randomBytes } from 'node:crypto';

import type { Clock } from '../../domain/ports/clock.js';
import type { IdGenerator } from '../../domain/ports/id-generator.js';
import { parseId, type Id } from '../../domain/value-objects/identifier.js';

/** RFC 9562 UUIDv7: 48 bits of Unix milliseconds followed by random bits, so identifiers sort by creation time. */
export class UuidV7Generator implements IdGenerator {
  public constructor(private readonly clock: Clock) {}

  public next<Entity extends string>(): Id<Entity> {
    const bytes = randomBytes(16);

    bytes.writeUIntBE(this.clock.now().getTime(), 0, 6);
    bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);
    bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);

    const hex = bytes.toString('hex');
    return parseId(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
  }
}
