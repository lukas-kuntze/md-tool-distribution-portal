import { describe, expect, it } from 'vitest';

import { parseBundleIdentifier } from './bundle-identifier.js';

describe('parseBundleIdentifier', (): void => {
  it('accepts an Android package name', (): void => {
    expect(parseBundleIdentifier('android', 'de.md.kmobile.support_app')).toBe('de.md.kmobile.support_app');
  });

  it('accepts an iOS bundle identifier with hyphens', (): void => {
    expect(parseBundleIdentifier('ios', 'de.md.k-mobile')).toBe('de.md.k-mobile');
  });

  it.each([
    ['android', 'de.md.k-mobile'],
    ['android', 'single'],
    ['android', 'de.1md'],
    ['ios', 'de..md'],
    ['ios', 'de.md/../x'],
  ] as const)('rejects %s identifier %s', (platform, value): void => {
    expect((): string => parseBundleIdentifier(platform, value)).toThrow(
      expect.objectContaining({ code: 'invalid_bundle_identifier' }),
    );
  });
});
