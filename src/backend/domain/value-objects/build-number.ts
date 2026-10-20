import { DomainError } from './domain-error.js';

declare const buildNumberBrand: unique symbol;

/** Flutter `--build-number`, Android `versionCode` and iOS `CFBundleVersion` of a release. */
export type BuildNumber = number & { readonly [buildNumberBrand]: 'BuildNumber' };

/** Upper bound Google Play and the Android platform accept for `versionCode`. */
export const MAX_BUILD_NUMBER = 2_100_000_000;

export function parseBuildNumber(value: number): BuildNumber {
  if (!Number.isInteger(value) || value < 1 || value > MAX_BUILD_NUMBER) {
    throw new DomainError('invalid_build_number', `Build number must be an integer between 1 and ${MAX_BUILD_NUMBER}.`);
  }

  return value as BuildNumber;
}
