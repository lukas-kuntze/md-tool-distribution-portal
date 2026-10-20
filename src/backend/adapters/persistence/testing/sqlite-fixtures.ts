import type { Database } from 'better-sqlite3';

import { migrate } from '../../../db/migrate.js';
import {
  configurePlatforms,
  createDefaultFlavor,
  setFlavorBundleIdentifier,
  type Application,
  type ApplicationFlavor,
} from '../../../domain/entities/application.js';
import { createProject, type Project } from '../../../domain/entities/project.js';
import {
  createReleaseArtifact,
  markArtifactStored,
  type ReleaseArtifact,
} from '../../../domain/entities/release-artifact.js';
import { createRelease, type NewRelease, type Release } from '../../../domain/entities/release.js';
import type { ChangeContext } from '../../../domain/ports/stored.js';
import { artifactKindSpec, type ArtifactKind } from '../../../domain/value-objects/artifact-kind.js';
import { parseBuildNumber } from '../../../domain/value-objects/build-number.js';
import { parseBundleIdentifier } from '../../../domain/value-objects/bundle-identifier.js';
import { parseCommitSha } from '../../../domain/value-objects/commit-sha.js';
import { parseDisplayName } from '../../../domain/value-objects/display-name.js';
import { parseId, type Id, type UserId } from '../../../domain/value-objects/identifier.js';
import { parseSlug } from '../../../domain/value-objects/slug.js';
import { artifactStorageKey } from '../../../domain/value-objects/storage-key.js';
import { parseVersion } from '../../../domain/value-objects/version.js';
import { openDatabase } from '../sqlite-database.js';
import { SqliteUnitOfWork } from '../sqlite-unit-of-work.js';

export const NOW = new Date('2026-10-17T10:00:00.000Z');
export const COMMIT = parseCommitSha('a'.repeat(40));

let sequence = 0;

/** A fresh, valid UUIDv7 per call, so tests never collide on identifiers. */
export function nextId<Entity extends string>(): Id<Entity> {
  sequence += 1;
  return parseId(`0192f3a4-0000-7000-8000-${sequence.toString(16).padStart(12, '0')}`);
}

export interface TestDatabase {
  readonly database: Database;
  readonly unitOfWork: SqliteUnitOfWork;
  readonly userId: UserId;
  readonly context: ChangeContext;
}

export function createTestDatabase(): TestDatabase {
  const database = openDatabase(':memory:');
  migrate(database, NOW);

  const unitOfWork = new SqliteUnitOfWork(database);
  const userId = nextId<'User'>();
  unitOfWork.transaction(({ users }) =>
    users.insert({ id: userId, displayName: 'Release Manager', email: null, avatarUrl: null, status: 'active' }, NOW),
  );

  return { database, unitOfWork, userId, context: { actor: userId, at: NOW } };
}

export function buildProject(slug = `project-${sequence + 1}`): Project {
  return createProject(nextId(), parseSlug(slug), parseDisplayName('MD Ambulant'), '');
}

export function buildApplication(project: Project, slug = `app-${sequence + 1}`): Application {
  return configurePlatforms(
    {
      id: nextId(),
      projectId: project.id,
      slug: parseSlug(slug),
      name: 'K Mobile',
      description: '',
      platforms: [],
      framework: 'flutter',
      flavorsEnabled: false,
      visibility: 'private',
      status: 'active',
    },
    ['android', 'ios'],
  );
}

/** A default flavor with unique identifiers on both platforms. */
export function buildDefaultFlavor(application: Application): ApplicationFlavor {
  const suffix = application.id.slice(-12);
  const flavor = createDefaultFlavor(nextId(), application);

  return setFlavorBundleIdentifier(
    setFlavorBundleIdentifier(flavor, 'android', parseBundleIdentifier('android', `de.md.app${suffix}`)),
    'ios',
    parseBundleIdentifier('ios', `de.md.app${suffix}`),
  );
}

export interface SeededApplication {
  readonly project: Project;
  readonly application: Application;
  readonly flavor: ApplicationFlavor;
}

export function seedApplication(test: TestDatabase): SeededApplication {
  const project = buildProject();
  const application = buildApplication(project);
  const flavor = buildDefaultFlavor(application);

  test.unitOfWork.transaction(({ projects, applications }) => {
    projects.insert(project, test.context);
    applications.insert(application, flavor, test.context);
  });

  return { project, application, flavor };
}

export function buildRelease(seeded: SeededApplication, overrides: Partial<NewRelease> = {}): Release {
  return createRelease({
    id: nextId(),
    applicationId: seeded.application.id,
    flavorId: seeded.flavor.id,
    version: parseVersion('4.13.0'),
    buildNumber: parseBuildNumber(125),
    requiredPlatforms: ['android', 'ios'],
    gitCommitSha: COMMIT,
    metadata: {
      releaseNotes: '',
      changelog: '',
      gitRepository: 'md/k-mobile',
      gitBranch: 'main',
      gitTag: null,
      workflowRun: { id: 4711, attempt: 1, url: 'https://github.example.com/md/k-mobile/actions/runs/4711' },
      importedFrom: null,
    },
    ...overrides,
  });
}

export function buildStoredArtifact(release: Release, kind: ArtifactKind = 'apk'): ReleaseArtifact {
  const id = nextId<'Artifact'>();

  return markArtifactStored(
    createReleaseArtifact({
      id,
      releaseId: release.id,
      kind,
      abi: null,
      buildMode: 'release',
      originalFileName: `app.${artifactKindSpec(kind).extension}`,
      contentType: 'application/octet-stream',
      sizeBytes: 1024,
      sha256: 'c'.repeat(64),
      storageKey: artifactStorageKey(release.applicationId, release.id, id, kind),
      gitCommitSha: release.gitCommitSha,
      workflowRunId: 4711,
      workflowRunAttempt: 1,
      uploadSource: 'ci',
      uploadedAt: NOW,
      uploadedBy: null,
    }),
  );
}
