import { describe, expect, it } from 'vitest';

import { DEFAULT_FLAVOR_KEY, parseFlavorKey } from './flavor-key.js';

describe('parseFlavorKey', (): void => {
  it.each(['production', 'unterstuetzung', 'stagingEu2', DEFAULT_FLAVOR_KEY])('accepts %s', (value): void => {
    expect(parseFlavorKey(value)).toBe(value);
  });

  it.each(['Production', '1st', 'with-hyphen', 'unterstützung', ''])('rejects %s', (value): void => {
    expect((): string => parseFlavorKey(value)).toThrow(expect.objectContaining({ code: 'invalid_flavor_key' }));
  });
});
