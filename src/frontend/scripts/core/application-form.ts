import type { PlatformDto } from '../../../shared/types/api.js';
import { BUNDLE_IDENTIFIER_PATTERNS } from '../../../shared/constants/formats.js';
import { checkedValues, value, type Validation } from './forms.js';

/** Fields shared by "Anwendung anlegen" and the settings of an application: platforms and identifiers. */
export function platformsOf(form: HTMLFormElement): PlatformDto[] {
  return checkedValues(form, 'platforms').filter(
    (platform): platform is PlatformDto => platform === 'android' || platform === 'ios',
  );
}

/** Identifiers of the enabled platforms; empty fields are left out. */
export function bundleIdentifiersOf(form: HTMLFormElement): Partial<Record<PlatformDto, string>> {
  const result: Partial<Record<PlatformDto, string>> = {};

  for (const platform of platformsOf(form)) {
    const identifier = value(form, `bundleIdentifier.${platform}`);

    if (identifier !== '') {
      result[platform] = identifier;
    }
  }

  return result;
}

export function validatePlatforms(form: HTMLFormElement, options: { readonly identifiers: boolean }): Validation {
  const platforms = platformsOf(form);
  const result: Record<string, string | null> = {
    platforms: platforms.length === 0 ? 'Mindestens eine Plattform muss aktiviert sein.' : null,
  };

  if (options.identifiers) {
    for (const platform of ['android', 'ios'] as const) {
      const identifier = value(form, `bundleIdentifier.${platform}`);
      result[`bundleIdentifier.${platform}`] =
        platforms.includes(platform) && identifier !== '' && !BUNDLE_IDENTIFIER_PATTERNS[platform].test(identifier)
          ? 'Ungültiges Format, z. B. de.firma.app.'
          : null;
    }
  }

  return result;
}

/** Shows the identifier field of a platform only while the platform is checked. */
export function bindPlatformToggles(form: HTMLFormElement): void {
  const sync = (): void => {
    const platforms = platformsOf(form);

    for (const group of form.querySelectorAll<HTMLElement>('[data-identifier-for]')) {
      group.hidden = !platforms.includes(group.dataset['identifierFor'] as PlatformDto);
    }
  };

  form.addEventListener('change', sync);
  form.addEventListener('reset', () => window.setTimeout(sync));
  sync();
}
