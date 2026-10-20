import { describe, expect, it } from 'vitest';

import { markArtifactPurged, markArtifactQuarantined } from '../../domain/entities/release-artifact.js';
import {
  markReleasePurged,
  markReleaseQuarantined,
  publishRelease,
  releaseBuildNumber,
  requestReleaseDeletion,
  type Release,
} from '../../domain/entities/release.js';
import type { ReleaseQuery } from '../../domain/ports/release-repository.js';
import { parseBuildNumber } from '../../domain/value-objects/build-number.js';
import { parseCommitSha } from '../../domain/value-objects/commit-sha.js';
import { parseVersion } from '../../domain/value-objects/version.js';
import {
  buildRelease,
  buildStoredArtifact,
  createTestDatabase,
  NOW,
  seedApplication,
  type SeededApplication,
  type TestDatabase,
} from './testing/sqlite-fixtures.js';

const errorCode = (code: string): unknown => expect.objectContaining({ code });

function purge(release: Release, test: TestDatabase): Release {
  return markReleasePurged(markReleaseQuarantined(requestReleaseDeletion(release, NOW, test.userId)), NOW);
}

describe('SqliteReleaseRepository', (): void => {
  it('round-trips a release with all of its metadata', (): void => {
    const test = createTestDatabase();
    const seeded = seedApplication(test);
    const release = buildRelease(seeded, { version: parseVersion('4.13.0-beta.1') });

    test.unitOfWork.transaction(({ releases }) => releases.insert(release, test.context));

    expect(test.unitOfWork.read(({ releases }) => releases.findById(release.id))).toEqual({
      value: release,
      rowVersion: 1,
    });
    expect(
      test.unitOfWork.read(({ releases }) => releases.findByBuildNumber(seeded.flavor.id, release.buildNumber))?.value,
    ).toEqual(release);
  });

  it('persists lifecycle changes including the release of a build number', (): void => {
    const test = createTestDatabase();
    const seeded = seedApplication(test);
    const release = buildRelease(seeded);
    test.unitOfWork.transaction(({ releases }) => releases.insert(release, test.context));

    const published = publishRelease(release, ['apk', 'ipa'], NOW, test.userId);
    const released = releaseBuildNumber(purge(published, test), { at: NOW, by: test.userId, reason: 'Ersetzt' });

    test.unitOfWork.transaction(({ releases }) => releases.update(released, 1, test.context));

    expect(test.unitOfWork.read(({ releases }) => releases.findById(release.id))).toEqual({
      value: released,
      rowVersion: 2,
    });
    expect(() => test.unitOfWork.transaction(({ releases }) => releases.update(released, 1, test.context))).toThrow(
      errorCode('concurrent_modification'),
    );
  });

  it('keeps a build number taken until it is released, tombstones included', (): void => {
    const test = createTestDatabase();
    const seeded = seedApplication(test);
    const first = buildRelease(seeded);
    test.unitOfWork.transaction(({ releases }) => releases.insert(first, test.context));

    const insertSecond = (): void =>
      test.unitOfWork.transaction(({ releases }) => releases.insert(buildRelease(seeded), test.context));

    expect(insertSecond).toThrow(errorCode('build_number_taken'));

    const tombstone = purge(first, test);
    test.unitOfWork.transaction(({ releases }) => releases.update(tombstone, 1, test.context));
    expect(insertSecond).toThrow(errorCode('build_number_taken'));

    test.unitOfWork.transaction(({ releases }) =>
      releases.update(releaseBuildNumber(tombstone, { at: NOW, by: test.userId, reason: 'Ersetzt' }), 2, test.context),
    );
    expect(insertSecond).not.toThrow();
    expect(
      test.unitOfWork.read(({ releases }) => releases.findByBuildNumber(seeded.flavor.id, first.buildNumber))?.value.id,
    ).not.toBe(first.id);
  });

  it('lists releases newest first with filters and search', (): void => {
    const test = createTestDatabase();
    const seeded = seedApplication(test);
    const create = (version: string, build: number, commit = 'a'): Release =>
      buildRelease(seeded, {
        version: parseVersion(version),
        buildNumber: parseBuildNumber(build),
        gitCommitSha: parseCommitSha(commit.repeat(40)),
      });
    const releases = [
      create('4.12.0', 120),
      create('4.13.0-rc.1', 124, 'b'),
      create('4.13.0', 125),
      create('3.9.0', 90),
    ];

    test.unitOfWork.transaction((repositories) => {
      for (const release of releases) {
        repositories.releases.insert(release, test.context);
      }
    });
    test.unitOfWork.transaction((repositories) =>
      repositories.releases.update(publishRelease(releases[2] as Release, ['apk', 'ipa'], NOW, null), 1, test.context),
    );

    const list = (query: Partial<ReleaseQuery> = {}): readonly string[] =>
      test.unitOfWork
        .read(({ releases: repository }) =>
          repository.list({ applicationId: seeded.application.id, limit: 10, offset: 0, ...query }),
        )
        .map((stored) => `${stored.value.version.value}+${stored.value.buildNumber}`);

    expect(list()).toEqual(['4.13.0+125', '4.13.0-rc.1+124', '4.12.0+120', '3.9.0+90']);
    expect(list({ publicationStatuses: ['published'] })).toEqual(['4.13.0+125']);
    expect(list({ lifecycleStates: ['pending_deletion'] })).toEqual([]);
    expect(list({ search: '4.13' })).toEqual(['4.13.0+125', '4.13.0-rc.1+124']);
    expect(list({ search: '90' })).toEqual(['3.9.0+90']);
    expect(list({ search: 'bbbb' })).toEqual(['4.13.0-rc.1+124']);
    expect(list({ search: '%' })).toEqual([]);
    expect(list({ limit: 1, offset: 1 })).toEqual(['4.13.0-rc.1+124']);
    expect(list({ flavorId: seeded.flavor.id })).toHaveLength(4);
  });

  describe('artifacts', (): void => {
    function seededRelease(): { test: TestDatabase; seeded: SeededApplication; release: Release } {
      const test = createTestDatabase();
      const seeded = seedApplication(test);
      const release = buildRelease(seeded);
      test.unitOfWork.transaction(({ releases }) => releases.insert(release, test.context));
      return { test, seeded, release };
    }

    it('stores artifacts and their state', (): void => {
      const { test, release } = seededRelease();
      const apk = buildStoredArtifact(release, 'apk');
      const ipa = buildStoredArtifact(release, 'ipa');

      test.unitOfWork.transaction(({ releases }) => {
        releases.insertArtifact(apk);
        releases.insertArtifact(ipa);
        releases.updateArtifactState(markArtifactQuarantined(apk));
      });

      expect(test.unitOfWork.read(({ releases }) => releases.listArtifacts(release.id))).toEqual([
        markArtifactQuarantined(apk),
        ipa,
      ]);
      expect(test.unitOfWork.read(({ releases }) => releases.findArtifact(ipa.id))).toEqual(ipa);
    });

    it('allows one file per kind, ABI and build mode until it is purged', (): void => {
      const { test, release } = seededRelease();
      const apk = buildStoredArtifact(release, 'apk');
      test.unitOfWork.transaction(({ releases }) => releases.insertArtifact(apk));

      const insertAgain = (): void =>
        test.unitOfWork.transaction(({ releases }) => releases.insertArtifact(buildStoredArtifact(release, 'apk')));

      expect(insertAgain).toThrow(errorCode('artifact_exists'));

      test.unitOfWork.transaction(({ releases }) =>
        releases.updateArtifactState(markArtifactPurged(markArtifactQuarantined(apk), NOW)),
      );
      expect(insertAgain).not.toThrow();
    });

    it('refuses storage keys that do not match the storage layout when reading', (): void => {
      const { test, release } = seededRelease();
      const apk = buildStoredArtifact(release, 'apk');
      test.unitOfWork.transaction(({ releases }) => releases.insertArtifact(apk));
      test.database
        .prepare("UPDATE release_artifacts SET storage_key = '../../windows/system32' WHERE id = ?")
        .run(apk.id);

      expect(() => test.unitOfWork.read(({ releases }) => releases.findArtifact(apk.id))).toThrow(
        errorCode('invalid_storage_key'),
      );
    });

    it('rejects state updates of unknown artifacts', (): void => {
      const { test, release } = seededRelease();

      expect(() =>
        test.unitOfWork.transaction(({ releases }) => releases.updateArtifactState(buildStoredArtifact(release))),
      ).toThrow(errorCode('concurrent_modification'));
    });
  });
});
