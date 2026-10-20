/**
 * Input formats for immediate feedback in the user interface. The server validates authoritatively in the
 * domain; these mirror its rules and must change together with them.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 63;

/** Flutter `--flavor` / Gradle product flavor. */
export const FLAVOR_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
export const FLAVOR_KEY_MAX_LENGTH = 64;

export const BUNDLE_IDENTIFIER_PATTERNS = {
  android: /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/,
  ios: /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/,
} as const;

export const NAME_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 2000;
export const REASON_MAX_LENGTH = 2000;
