import { DomainError } from './domain-error.js';

declare const flavorKeyBrand: unique symbol;

/** Technical flavor name as passed to `flutter build --flavor`. */
export type FlavorKey = string & { readonly [flavorKeyBrand]: 'FlavorKey' };

export const FLAVOR_KEY_MAX_LENGTH = 64;

export const DEFAULT_FLAVOR_KEY = 'default' as FlavorKey;

const FLAVOR_KEY = /^[a-z][a-zA-Z0-9]*$/;

export function parseFlavorKey(value: string): FlavorKey {
  if (value.length > FLAVOR_KEY_MAX_LENGTH || !FLAVOR_KEY.test(value)) {
    throw new DomainError(
      'invalid_flavor_key',
      `Flavor key must start with a lowercase letter, contain only letters and digits and be at most ${FLAVOR_KEY_MAX_LENGTH} characters long.`,
    );
  }

  return value as FlavorKey;
}
