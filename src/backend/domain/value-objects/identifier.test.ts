import { describe, expect, it } from 'vitest';

import { isId, parseId } from './identifier.js';

describe('parseId', (): void => {
  it('accepts a canonical lowercase UUIDv7', (): void => {
    expect(parseId('0192f3a4-5b6c-7d8e-9f01-23456789abcd')).toBe('0192f3a4-5b6c-7d8e-9f01-23456789abcd');
  });

  it.each([
    ['uppercase', '0192F3A4-5B6C-7D8E-9F01-23456789ABCD'],
    ['version 4', '0192f3a4-5b6c-4d8e-9f01-23456789abcd'],
    ['invalid variant', '0192f3a4-5b6c-7d8e-cf01-23456789abcd'],
    ['path traversal', '../0192f3a4-5b6c-7d8e-9f01-23456789abcd'],
    ['empty', ''],
  ])('rejects an identifier that is %s', (_case, value): void => {
    expect(isId(value)).toBe(false);
    expect((): string => parseId(value)).toThrow(expect.objectContaining({ code: 'invalid_id' }));
  });
});
