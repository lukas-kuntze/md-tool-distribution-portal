import { describe, expect, it } from 'vitest';

import {
  archiveFlavor,
  configurePlatforms,
  createFlavor,
  enableFlavors,
  setFlavorBundleIdentifier,
} from '../../domain/entities/application.js';
import { parseBundleIdentifier } from '../../domain/value-objects/bundle-identifier.js';
import { parseFlavorKey } from '../../domain/value-objects/flavor-key.js';
import {
  buildApplication,
  buildDefaultFlavor,
  buildRelease,
  createTestDatabase,
  nextId,
  seedApplication,
} from './testing/sqlite-fixtures.js';

const errorCode = (code: string): unknown => expect.objectContaining({ code });

describe('SqliteApplicationRepository', (): void => {
  it('stores an application together with its platforms and default flavor', (): void => {
    const test = createTestDatabase();
    const { project, application, flavor } = seedApplication(test);

    const loaded = test.unitOfWork.read(({ applications }) => ({
      byId: applications.findById(application.id),
      bySlug: applications.findBySlug(project.id, application.slug),
      list: applications.listByProject(project.id),
      flavors: applications.listFlavors(application.id),
    }));

    expect(loaded.byId).toEqual({ value: application, rowVersion: 1 });
    expect(loaded.bySlug?.value).toEqual(application);
    expect(loaded.list).toHaveLength(1);
    expect(loaded.flavors).toEqual([{ value: flavor, rowVersion: 1 }]);
  });

  it('rejects duplicate slugs within a project', (): void => {
    const test = createTestDatabase();
    const { project, application } = seedApplication(test);
    const duplicate = { ...buildApplication(project), slug: application.slug };

    expect(() =>
      test.unitOfWork.transaction(({ applications }) =>
        applications.insert(duplicate, buildDefaultFlavor(duplicate), test.context),
      ),
    ).toThrow(errorCode('slug_taken'));
  });

  it('replaces platforms on update', (): void => {
    const test = createTestDatabase();
    const { application } = seedApplication(test);
    const iosOnly = enableFlavors(configurePlatforms(application, ['ios']));

    test.unitOfWork.transaction(({ applications }) => applications.update(iosOnly, 1, test.context));

    expect(test.unitOfWork.read(({ applications }) => applications.findById(application.id))).toEqual({
      value: iosOnly,
      rowVersion: 2,
    });
  });

  it('adds flavors and keeps their keys and identifiers unique', (): void => {
    const test = createTestDatabase();
    const { application, flavor } = seedApplication(test);
    const enabled = enableFlavors(application);
    const support = setFlavorBundleIdentifier(
      createFlavor(nextId(), enabled, [flavor], parseFlavorKey('unterstuetzung'), 'Unterstützung'),
      'android',
      parseBundleIdentifier('android', 'de.md.kmobile.support'),
    );

    test.unitOfWork.transaction(({ applications }) => applications.insertFlavor(support, test.context));

    expect(test.unitOfWork.read(({ applications }) => applications.findFlavor(support.id))?.value).toEqual(support);
    expect(() =>
      test.unitOfWork.transaction(({ applications }) =>
        applications.insertFlavor({ ...support, id: nextId(), bundleIdentifiers: {} }, test.context),
      ),
    ).toThrow(errorCode('flavor_key_taken'));
    expect(() =>
      test.unitOfWork.transaction(({ applications }) =>
        applications.insertFlavor({ ...support, id: nextId(), key: parseFlavorKey('other') }, test.context),
      ),
    ).toThrow(errorCode('bundle_identifier_taken'));
  });

  it('updates flavors with optimistic locking and derives whether they have releases', (): void => {
    const test = createTestDatabase();
    const seeded = seedApplication(test);
    const support = createFlavor(
      nextId(),
      enableFlavors(seeded.application),
      [seeded.flavor],
      parseFlavorKey('support'),
      'Support',
    );

    test.unitOfWork.transaction(({ applications }) => applications.insertFlavor(support, test.context));
    test.unitOfWork.transaction(({ applications }) =>
      applications.updateFlavor(archiveFlavor(support), 1, test.context),
    );
    test.unitOfWork.transaction(({ releases }) => releases.insert(buildRelease(seeded), test.context));

    const flavors = test.unitOfWork.read(({ applications }) => applications.listFlavors(seeded.application.id));

    expect(flavors.map((stored) => [stored.value.key, stored.value.status, stored.value.hasReleases])).toEqual([
      ['default', 'active', true],
      ['support', 'archived', false],
    ]);
    expect(() =>
      test.unitOfWork.transaction(({ applications }) => applications.updateFlavor(support, 1, test.context)),
    ).toThrow(errorCode('concurrent_modification'));
  });
});
