import { describe, expect, it } from 'vitest';

import { isId } from '../../domain/value-objects/identifier.js';
import { UuidV7Generator } from './uuid-v7-generator.js';

describe('UuidV7Generator', (): void => {
  it('produces canonical UUIDv7 values that encode the current time', (): void => {
    const now = new Date('2026-10-17T10:00:00.000Z');
    const id = new UuidV7Generator({ now: (): Date => now }).next();

    expect(isId(id)).toBe(true);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(now.getTime());
  });

  it('sorts identifiers by creation time and never repeats them', (): void => {
    let time = Date.parse('2026-10-17T10:00:00.000Z');
    const generator = new UuidV7Generator({ now: (): Date => new Date((time += 1)) });
    const ids = Array.from({ length: 100 }, () => generator.next());

    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
