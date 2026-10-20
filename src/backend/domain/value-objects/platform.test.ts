import { describe, expect, it } from 'vitest';

import { parsePlatform } from './platform.js';

describe('parsePlatform', (): void => {
  it('accepts the supported platforms', (): void => {
    expect(parsePlatform('android')).toBe('android');
    expect(parsePlatform('ios')).toBe('ios');
  });

  it('rejects anything else', (): void => {
    expect((): string => parsePlatform('windows')).toThrow(expect.objectContaining({ code: 'invalid_platform' }));
  });
});
