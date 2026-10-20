import { DomainError } from './domain-error.js';

declare const slugBrand: unique symbol;

/** URL and display key of a project or application. Never used to build file system paths. */
export type Slug = string & { readonly [slugBrand]: 'Slug' };

export const SLUG_MAX_LENGTH = 63;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const TRANSLITERATIONS: Readonly<Record<string, string>> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

export function parseSlug(value: string): Slug {
  if (value.length > SLUG_MAX_LENGTH || !SLUG.test(value)) {
    throw new DomainError(
      'invalid_slug',
      `Slug must consist of lowercase letters, digits and single hyphens and be at most ${SLUG_MAX_LENGTH} characters long.`,
    );
  }

  return value as Slug;
}

/** Proposes a slug for a display name. The result may be empty and must still pass `parseSlug`. */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äöüß]/g, (character) => TRANSLITERATIONS[character] ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}
