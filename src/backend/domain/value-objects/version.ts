import { DomainError } from './domain-error.js';

/** Version name of a build (`4.13.0`, `4.13.0-beta.1`). The build number is kept separately. */
export interface Version {
  readonly value: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly preRelease: string | null;
}

export const VERSION_MAX_LENGTH = 64;

const NUMERIC = '0|[1-9]\\d*';
const PRE_RELEASE_IDENTIFIER = `(?:${NUMERIC}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`;
const VERSION = new RegExp(
  `^(${NUMERIC})\\.(${NUMERIC})\\.(${NUMERIC})(?:-(${PRE_RELEASE_IDENTIFIER}(?:\\.${PRE_RELEASE_IDENTIFIER})*))?$`,
);

export function parseVersion(value: string): Version {
  const match = value.length <= VERSION_MAX_LENGTH ? VERSION.exec(value) : null;
  const major = Number(match?.[1]);
  const minor = Number(match?.[2]);
  const patch = Number(match?.[3]);

  if (match === null || ![major, minor, patch].every((part) => Number.isSafeInteger(part))) {
    throw new DomainError(
      'invalid_version',
      'Version must have the form MAJOR.MINOR.PATCH with an optional pre-release suffix and no build metadata.',
    );
  }

  return { value, major, minor, patch, preRelease: match[4] ?? null };
}

/** Orders versions by semantic versioning precedence. */
export function compareVersions(left: Version, right: Version): number {
  return (
    Math.sign(left.major - right.major) ||
    Math.sign(left.minor - right.minor) ||
    Math.sign(left.patch - right.patch) ||
    comparePreRelease(left.preRelease, right.preRelease)
  );
}

function comparePreRelease(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  const leftIdentifiers = left.split('.');
  const rightIdentifiers = right.split('.');
  const length = Math.min(leftIdentifiers.length, rightIdentifiers.length);

  for (let index = 0; index < length; index += 1) {
    const result = compareIdentifier(leftIdentifiers[index] ?? '', rightIdentifiers[index] ?? '');

    if (result !== 0) {
      return result;
    }
  }

  return Math.sign(leftIdentifiers.length - rightIdentifiers.length);
}

function compareIdentifier(left: string, right: string): number {
  const leftIsNumeric = /^\d+$/.test(left);
  const rightIsNumeric = /^\d+$/.test(right);

  if (leftIsNumeric && rightIsNumeric) {
    // Numeric identifiers carry no leading zeros, so length decides before the digits do.
    return Math.sign(left.length - right.length) || compareText(left, right);
  }

  if (leftIsNumeric !== rightIsNumeric) {
    return leftIsNumeric ? -1 : 1;
  }

  return compareText(left, right);
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}
