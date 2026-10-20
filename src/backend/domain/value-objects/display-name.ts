import { DomainError } from './domain-error.js';

declare const displayNameBrand: unique symbol;

/** Human-readable name of a project, application, flavor or channel. */
export type DisplayName = string & { readonly [displayNameBrand]: 'DisplayName' };

export const DISPLAY_NAME_MAX_LENGTH = 200;

// eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function parseDisplayName(value: string): DisplayName {
  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > DISPLAY_NAME_MAX_LENGTH || CONTROL_CHARACTERS.test(trimmed)) {
    throw new DomainError(
      'invalid_name',
      `Name must contain between 1 and ${DISPLAY_NAME_MAX_LENGTH} characters and no control characters.`,
    );
  }

  return trimmed as DisplayName;
}
