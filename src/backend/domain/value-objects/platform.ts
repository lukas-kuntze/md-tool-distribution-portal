import { DomainError } from './domain-error.js';

export const PLATFORMS = ['android', 'ios'] as const;

export type Platform = (typeof PLATFORMS)[number];

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

export function parsePlatform(value: string): Platform {
  if (!isPlatform(value)) {
    throw new DomainError('invalid_platform', `Platform must be one of: ${PLATFORMS.join(', ')}.`);
  }

  return value;
}
