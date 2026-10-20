import { describe, expect, it } from 'vitest';

import { MAX_BUILD_NUMBER, parseBuildNumber } from './build-number.js';

describe('parseBuildNumber', (): void => {
  it.each([1, 125, MAX_BUILD_NUMBER])('accepts %d', (value): void => {
    expect(parseBuildNumber(value)).toBe(value);
  });

  it.each([0, -1, 1.5, MAX_BUILD_NUMBER + 1, Number.NaN])('rejects %d', (value): void => {
    expect((): number => parseBuildNumber(value)).toThrow(expect.objectContaining({ code: 'invalid_build_number' }));
  });
});
