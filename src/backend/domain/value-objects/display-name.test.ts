import { describe, expect, it } from 'vitest';

import { DISPLAY_NAME_MAX_LENGTH, parseDisplayName } from './display-name.js';

describe('parseDisplayName', (): void => {
  it('trims surrounding whitespace', (): void => {
    expect(parseDisplayName('  K Mobile  ')).toBe('K Mobile');
  });

  it.each(['', '   ', 'a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1), 'Line\nBreak'])('rejects %j', (value): void => {
    expect((): string => parseDisplayName(value)).toThrow(expect.objectContaining({ code: 'invalid_name' }));
  });
});
