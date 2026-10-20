import { DomainError } from '../value-objects/domain-error.js';
import { DEFAULT_FLAVOR_KEY, type FlavorKey } from '../value-objects/flavor-key.js';
import type { BundleIdentifier } from '../value-objects/bundle-identifier.js';
import type { ApplicationId, FlavorId, ProjectId } from '../value-objects/identifier.js';
import { PLATFORMS, type Platform } from '../value-objects/platform.js';
import type { Slug } from '../value-objects/slug.js';

export const APPLICATION_VISIBILITIES = ['private', 'organization'] as const;

export type ApplicationVisibility = (typeof APPLICATION_VISIBILITIES)[number];

export const FRAMEWORKS = ['flutter', 'dotnet_maui'] as const;

export type Framework = (typeof FRAMEWORKS)[number];

export const FLAVOR_STATUSES = ['active', 'disabled', 'archived'] as const;

export type FlavorStatus = (typeof FLAVOR_STATUSES)[number];

export interface Application {
  readonly id: ApplicationId;
  readonly projectId: ProjectId;
  readonly slug: Slug;
  readonly name: string;
  readonly description: string;
  /** Platforms the application is built for; the order follows `PLATFORMS`. */
  readonly platforms: readonly Platform[];
  /** Informational: Flutter or .NET MAUI. Both ship APK/AAB and IPA, so it does not change how releases work. */
  readonly framework: Framework;
  readonly flavorsEnabled: boolean;
  readonly visibility: ApplicationVisibility;
  readonly status: 'active' | 'archived';
}

/**
 * A Flutter flavor of an application. Every application has exactly one default flavor, so that releases
 * always belong to a flavor; while flavors are disabled the default flavor is simply not shown.
 */
export interface ApplicationFlavor {
  readonly id: FlavorId;
  readonly applicationId: ApplicationId;
  readonly key: FlavorKey;
  readonly name: string;
  readonly isDefault: boolean;
  readonly status: FlavorStatus;
  /** Android package name and iOS bundle identifier; checked against every uploaded binary. */
  readonly bundleIdentifiers: Readonly<Partial<Record<Platform, BundleIdentifier>>>;
  readonly hasReleases: boolean;
}

export function createDefaultFlavor(id: FlavorId, application: Application): ApplicationFlavor {
  return {
    id,
    applicationId: application.id,
    key: DEFAULT_FLAVOR_KEY,
    name: application.name,
    isDefault: true,
    status: 'active',
    bundleIdentifiers: {},
    hasReleases: false,
  };
}

export function configurePlatforms(application: Application, platforms: readonly Platform[]): Application {
  return { ...application, platforms: PLATFORMS.filter((platform) => platforms.includes(platform)) };
}

/** Identifiers are frozen once a release exists, because installed apps are only updated under the same identifier. */
export function setFlavorBundleIdentifier(
  flavor: ApplicationFlavor,
  platform: Platform,
  identifier: BundleIdentifier | null,
): ApplicationFlavor {
  if (flavor.hasReleases && flavor.bundleIdentifiers[platform] !== identifier) {
    throw new DomainError('bundle_identifier_locked', 'Identifiers cannot change once the flavor has releases.');
  }

  const { [platform]: _removed, ...others } = flavor.bundleIdentifiers;
  return { ...flavor, bundleIdentifiers: identifier === null ? others : { ...others, [platform]: identifier } };
}

/** The platforms a new release of this flavor has to cover: enabled for the application and identified for the flavor. */
export function releasePlatformsFor(application: Application, flavor: ApplicationFlavor): readonly Platform[] {
  const platforms = application.platforms.filter((platform) => flavor.bundleIdentifiers[platform] !== undefined);

  if (platforms.length === 0) {
    throw new DomainError(
      'no_release_platforms',
      'Enable a platform for the application and set its identifier for the flavor before creating releases.',
    );
  }

  return platforms;
}

export function enableFlavors(application: Application): Application {
  return { ...application, flavorsEnabled: true };
}

/** Flavors can only be switched off again once nothing but the default flavor is left in use. */
export function disableFlavors(application: Application, flavors: readonly ApplicationFlavor[]): Application {
  if (flavors.some((flavor) => !flavor.isDefault && flavor.status !== 'archived')) {
    throw new DomainError(
      'too_many_active_flavors',
      'Archive every flavor except the default flavor before disabling flavor support.',
    );
  }

  return { ...application, flavorsEnabled: false };
}

export function createFlavor(
  id: FlavorId,
  application: Application,
  siblings: readonly ApplicationFlavor[],
  key: FlavorKey,
  name: string,
): ApplicationFlavor {
  if (!application.flavorsEnabled) {
    throw new DomainError('flavors_not_enabled', 'Enable flavor support before adding flavors.');
  }

  assertKeyAvailable(siblings, key);
  return {
    id,
    applicationId: application.id,
    key,
    name,
    isDefault: false,
    status: 'active',
    bundleIdentifiers: {},
    hasReleases: false,
  };
}

/** The key must keep matching the Flutter project, so it is frozen as soon as a release refers to it. */
export function changeFlavorKey(
  flavor: ApplicationFlavor,
  siblings: readonly ApplicationFlavor[],
  key: FlavorKey,
): ApplicationFlavor {
  if (flavor.hasReleases) {
    throw new DomainError('flavor_key_locked', 'The flavor key cannot change once the flavor has releases.');
  }

  assertKeyAvailable(
    siblings.filter((sibling) => sibling.id !== flavor.id),
    key,
  );
  return { ...flavor, key };
}

export function disableFlavor(flavor: ApplicationFlavor): ApplicationFlavor {
  return { ...flavor, status: 'disabled' };
}

export function activateFlavor(flavor: ApplicationFlavor): ApplicationFlavor {
  return { ...flavor, status: 'active' };
}

export function archiveFlavor(flavor: ApplicationFlavor): ApplicationFlavor {
  if (flavor.isDefault) {
    throw new DomainError('default_flavor_not_archivable', 'The default flavor cannot be archived.');
  }

  return { ...flavor, status: 'archived' };
}

export function assertFlavorAcceptsReleases(flavor: ApplicationFlavor): void {
  if (flavor.status !== 'active') {
    throw new DomainError('flavor_not_active', 'New releases can only be created for active flavors.');
  }
}

function assertKeyAvailable(siblings: readonly ApplicationFlavor[], key: FlavorKey): void {
  // Archived flavors keep their key: it identifies their releases and stays unique per application.
  if (siblings.some((sibling) => sibling.key === key)) {
    throw new DomainError('flavor_key_taken', 'Another flavor of this application already uses this key.');
  }
}
