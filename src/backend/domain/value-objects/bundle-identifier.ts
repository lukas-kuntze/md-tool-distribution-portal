import { DomainError } from './domain-error.js';
import type { Platform } from './platform.js';

declare const bundleIdentifierBrand: unique symbol;

/** Android package name or iOS bundle identifier of one flavor on one platform. */
export type BundleIdentifier = string & { readonly [bundleIdentifierBrand]: 'BundleIdentifier' };

export const BUNDLE_IDENTIFIER_MAX_LENGTH = 255;

const PATTERNS: Readonly<Record<Platform, RegExp>> = {
  android: /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/,
  ios: /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/,
};

export function parseBundleIdentifier(platform: Platform, value: string): BundleIdentifier {
  if (value.length > BUNDLE_IDENTIFIER_MAX_LENGTH || !PATTERNS[platform].test(value)) {
    throw new DomainError(
      'invalid_bundle_identifier',
      platform === 'android'
        ? 'Package name must consist of at least two dot-separated segments that start with a letter and contain only letters, digits and underscores.'
        : 'Bundle identifier must consist of at least two dot-separated segments of letters, digits and hyphens.',
    );
  }

  return value as BundleIdentifier;
}
