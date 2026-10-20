import { describe, expect, it } from 'vitest';

import { parseBundleIdentifier } from '../value-objects/bundle-identifier.js';
import { DEFAULT_FLAVOR_KEY, parseFlavorKey } from '../value-objects/flavor-key.js';
import { parseId } from '../value-objects/identifier.js';
import { parseSlug } from '../value-objects/slug.js';
import {
  activateFlavor,
  archiveFlavor,
  assertFlavorAcceptsReleases,
  changeFlavorKey,
  configurePlatforms,
  createDefaultFlavor,
  createFlavor,
  disableFlavor,
  disableFlavors,
  enableFlavors,
  releasePlatformsFor,
  setFlavorBundleIdentifier,
  type Application,
  type ApplicationFlavor,
} from './application.js';

const application: Application = {
  id: parseId('0192f3a4-0000-7000-8000-000000000020'),
  projectId: parseId('0192f3a4-0000-7000-8000-000000000010'),
  slug: parseSlug('k-mobile'),
  name: 'K Mobile',
  description: '',
  platforms: ['android', 'ios'],
  framework: 'flutter',
  flavorsEnabled: false,
  visibility: 'private',
  status: 'active',
};

const defaultFlavor = createDefaultFlavor(parseId('0192f3a4-0000-7000-8000-000000000030'), application);
const errorCode = (code: string): unknown => expect.objectContaining({ code });

function supportFlavor(): ApplicationFlavor {
  return createFlavor(
    parseId('0192f3a4-0000-7000-8000-000000000031'),
    enableFlavors(application),
    [defaultFlavor],
    parseFlavorKey('unterstuetzung'),
    'Unterstützung',
  );
}

describe('default flavor', (): void => {
  it('exists for every application under the fixed key and the application name', (): void => {
    expect(defaultFlavor).toMatchObject({
      key: DEFAULT_FLAVOR_KEY,
      name: 'K Mobile',
      isDefault: true,
      status: 'active',
    });
  });

  it('cannot be archived', (): void => {
    expect((): ApplicationFlavor => archiveFlavor(defaultFlavor)).toThrow(errorCode('default_flavor_not_archivable'));
  });

  it('can be renamed to a real flavor key until it has releases', (): void => {
    expect(changeFlavorKey(defaultFlavor, [defaultFlavor], parseFlavorKey('production')).key).toBe('production');
    expect((): ApplicationFlavor =>
      changeFlavorKey({ ...defaultFlavor, hasReleases: true }, [], parseFlavorKey('production')),
    ).toThrow(errorCode('flavor_key_locked'));
  });
});

describe('flavor support', (): void => {
  it('requires flavor support before adding flavors', (): void => {
    expect((): ApplicationFlavor =>
      createFlavor(
        parseId('0192f3a4-0000-7000-8000-000000000031'),
        application,
        [defaultFlavor],
        parseFlavorKey('x'),
        'X',
      ),
    ).toThrow(errorCode('flavors_not_enabled'));
  });

  it('adds flavors with unique keys only', (): void => {
    expect(supportFlavor()).toMatchObject({ key: 'unterstuetzung', isDefault: false, status: 'active' });
    expect((): ApplicationFlavor =>
      createFlavor(
        parseId('0192f3a4-0000-7000-8000-000000000032'),
        enableFlavors(application),
        [defaultFlavor, archiveFlavor(supportFlavor())],
        parseFlavorKey('unterstuetzung'),
        'Again',
      ),
    ).toThrow(errorCode('flavor_key_taken'));
  });

  it('does not count a flavor as its own sibling when its key changes', (): void => {
    const flavor = supportFlavor();

    expect(changeFlavorKey(flavor, [defaultFlavor, flavor], parseFlavorKey('support')).key).toBe('support');
    expect((): ApplicationFlavor => changeFlavorKey(flavor, [defaultFlavor, flavor], DEFAULT_FLAVOR_KEY)).toThrow(
      errorCode('flavor_key_taken'),
    );
  });

  it('can only be disabled once all other flavors are archived', (): void => {
    const enabled = enableFlavors(application);

    expect((): Application => disableFlavors(enabled, [defaultFlavor, disableFlavor(supportFlavor())])).toThrow(
      errorCode('too_many_active_flavors'),
    );
    expect(disableFlavors(enabled, [defaultFlavor, archiveFlavor(supportFlavor())]).flavorsEnabled).toBe(false);
  });
});

describe('platforms and identifiers', (): void => {
  const androidId = parseBundleIdentifier('android', 'de.md.kmobile');
  const iosId = parseBundleIdentifier('ios', 'de.md.kmobile');

  it('keeps the configured platforms unique and in a fixed order', (): void => {
    expect(configurePlatforms(application, ['ios', 'android', 'ios']).platforms).toEqual(['android', 'ios']);
  });

  it('sets and removes identifiers until the flavor has releases', (): void => {
    const configured = setFlavorBundleIdentifier(
      setFlavorBundleIdentifier(defaultFlavor, 'android', androidId),
      'ios',
      iosId,
    );

    expect(configured.bundleIdentifiers).toEqual({ android: androidId, ios: iosId });
    expect(setFlavorBundleIdentifier(configured, 'ios', null).bundleIdentifiers).toEqual({ android: androidId });
    expect((): ApplicationFlavor =>
      setFlavorBundleIdentifier({ ...configured, hasReleases: true }, 'ios', null),
    ).toThrow(errorCode('bundle_identifier_locked'));
    expect(setFlavorBundleIdentifier({ ...configured, hasReleases: true }, 'ios', iosId)).toMatchObject({
      bundleIdentifiers: { ios: iosId },
    });
  });

  it('requires releases to cover every platform that is enabled and identified', (): void => {
    const androidOnly = setFlavorBundleIdentifier(defaultFlavor, 'android', androidId);

    expect(releasePlatformsFor(application, androidOnly)).toEqual(['android']);
    expect(
      releasePlatformsFor(
        configurePlatforms(application, ['ios']),
        setFlavorBundleIdentifier(androidOnly, 'ios', iosId),
      ),
    ).toEqual(['ios']);
    expect((): readonly string[] => releasePlatformsFor(application, defaultFlavor)).toThrow(
      errorCode('no_release_platforms'),
    );
  });
});

describe('flavor status', (): void => {
  it('accepts new releases for active flavors only', (): void => {
    expect((): void => assertFlavorAcceptsReleases(defaultFlavor)).not.toThrow();
    expect((): void => assertFlavorAcceptsReleases(disableFlavor(supportFlavor()))).toThrow(
      errorCode('flavor_not_active'),
    );
    expect((): void => assertFlavorAcceptsReleases(activateFlavor(disableFlavor(supportFlavor())))).not.toThrow();
  });
});
