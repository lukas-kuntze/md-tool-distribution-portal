import type { Application, ApplicationFlavor } from '../domain/entities/application.js';
import {
  createReleaseArtifact,
  markArtifactStored,
  type ReleaseArtifact,
  type UploadSource,
} from '../domain/entities/release-artifact.js';
import {
  assertArtifactAcceptable,
  createRelease,
  type ArtifactOrigin,
  type Release,
  type ReleaseMetadata,
} from '../domain/entities/release.js';
import type { ArtifactStorage, ReceivedUpload } from '../domain/ports/artifact-storage.js';
import type { AuditEntry } from '../domain/ports/audit-log.js';
import type { BinaryIdentity, BinaryInspector } from '../domain/ports/binary-inspector.js';
import type { Repositories } from '../domain/ports/unit-of-work.js';
import { artifactKindSpec, type ArtifactKind } from '../domain/value-objects/artifact-kind.js';
import { parseBuildNumber, type BuildNumber } from '../domain/value-objects/build-number.js';
import { parseCommitSha } from '../domain/value-objects/commit-sha.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type {
  ApplicationId,
  ArtifactId,
  FlavorId,
  ReleaseId,
  UploadId,
  UserId,
} from '../domain/value-objects/identifier.js';
import type { Target } from '../domain/value-objects/scope.js';
import { artifactStorageKey } from '../domain/value-objects/storage-key.js';
import { parseVersion } from '../domain/value-objects/version.js';
import {
  applicationTarget,
  auditChange,
  authorizedRead,
  authorizedTransaction,
  type Denial,
  type Guard,
} from './authorization.js';
import { requireApplication, requireRelease } from './lookups.js';
import { visibleApplication } from './manage-applications.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';

export interface UploadDependencies extends UseCaseDependencies {
  readonly storage: ArtifactStorage;
  readonly inspector: BinaryInspector;
  readonly maxUploadBytes: number;
}

/** Files without an identity of their own; they are attached to an existing release as they are. */
export const SUPPLEMENTARY_KINDS = ['dsym', 'mapping', 'metadata'] as const;

export type SupplementaryKind = (typeof SUPPLEMENTARY_KINDS)[number];

export interface UploadResult {
  readonly releaseId: ReleaseId;
  readonly artifactId: ArtifactId;
  readonly releaseCreated: boolean;
}

/** The part of a guard the upload needs: refusing what the uploader may not do. */
export type UploadGuard = Pick<Guard, 'require'>;

/**
 * Who uploads: a signed-in user with their permissions, or a CI job bound to the application. Everything the
 * upload checks about files and releases is the same for both; only access, audit and origin differ.
 */
export interface Uploader {
  readonly source: UploadSource;
  /** Recorded as creator of releases and uploader of artifacts; `null` for CI jobs. */
  readonly userId: UserId | null;
  /** Git and workflow data of releases this uploader creates. */
  readonly origin: Pick<ReleaseMetadata, 'gitRepository' | 'gitBranch' | 'gitTag' | 'workflowRun'>;
  read<Result>(work: (repositories: Repositories, guard: UploadGuard) => Result): Result;
  transaction<Result>(work: (repositories: Repositories, guard: UploadGuard, now: Date) => Result): Result;
  /** The application, if the uploader may see it at all. */
  application(repositories: Repositories, applicationId: ApplicationId): Application;
  audit(
    now: Date,
    action: string,
    target: Target,
    subject: Denial['subject'],
    details: Readonly<Record<string, unknown>>,
  ): AuditEntry;
}

/** A signed-in user uploading from the administration. */
export function userUploader(
  dependencies: Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>,
  actor: Actor,
  request: RequestContext,
): Uploader {
  let permissions: Guard['permissions'] | null = null;
  const remember = (guard: Guard): Guard => {
    permissions = guard.permissions;
    return guard;
  };

  return {
    source: 'ui',
    userId: actor.userId,
    origin: { gitRepository: null, gitBranch: null, gitTag: null, workflowRun: null },
    read: (work) =>
      authorizedRead(contextOf(dependencies, actor, request), (repositories, guard) =>
        work(repositories, remember(guard)),
      ),
    transaction: <Result>(work: (repositories: Repositories, guard: UploadGuard, now: Date) => Result): Result => {
      const context = contextOf(dependencies, actor, request);
      return authorizedTransaction(context, (repositories, guard) => work(repositories, remember(guard), context.now));
    },
    application: (repositories, applicationId): Application => {
      if (permissions === null) {
        throw new Error('The application is looked up outside of a guarded unit of work.');
      }

      return visibleApplication(repositories, applicationId, permissions);
    },
    audit: (now, action, target, subject, details) =>
      auditChange({ ...contextOf(dependencies, actor, request), now }, action, target, subject, details),
  };
}

export interface UploadBuildInput {
  readonly applicationId: ApplicationId;
  /** Optional: without it, the flavor is found by the identifier in the binary. */
  readonly flavorId: FlavorId | null;
  /** Optional: the key the uploader expects the flavor to have; checked, never used to choose it. */
  readonly flavorKey?: string | null;
  readonly fileName: string;
  /** Required when the upload starts a new release; otherwise it must match the release, if given. */
  readonly commitSha: string | null;
  readonly content: AsyncIterable<Uint8Array>;
}

/**
 * Uploads an APK, AAB or IPA (concept 5.5). Identifier, version and build number are read from the binary.
 * The release is found by flavor and build number, so that the Android and the iOS build attach to the same
 * release; the first build of a build number creates the release as a draft.
 */
export function uploadBuild(
  dependencies: UploadDependencies,
  actor: Actor,
  request: RequestContext,
  input: UploadBuildInput,
): Promise<UploadResult> {
  return uploadBuildAs(dependencies, userUploader(dependencies, actor, request), input);
}

export function uploadBuildAs(
  dependencies: UploadDependencies,
  uploader: Uploader,
  input: UploadBuildInput,
): Promise<UploadResult> {
  return upload(dependencies, uploader, input.content, {
    preflight: (repositories, guard) => {
      const application = uploader.application(repositories, input.applicationId);
      guard.require('artifacts.upload', applicationTarget(application), { type: 'application', id: application.id });
    },
    inspect: true,
    record: ({ repositories, guard, identity, received, now }) => {
      const application = requireApplication(repositories, input.applicationId).value;
      const target = applicationTarget(application);
      const binary = required(identity);
      const flavor = flavorFor(repositories, application, binary, input.flavorId);
      const origin = originOf(binary);
      const existing = repositories.releases.findByBuildNumber(flavor.id, origin.buildNumber);
      let release: Release;

      guard.require('artifacts.upload', target, { type: 'application', id: application.id });

      if (input.flavorKey !== undefined && input.flavorKey !== null && input.flavorKey !== flavor.key) {
        throw new DomainError('flavor_mismatch', 'The file belongs to another flavor than the one given.');
      }

      if (existing === null) {
        guard.require('releases.create', target, { type: 'application', id: application.id });
        release = startRelease(dependencies, uploader, application, flavor, origin, input.commitSha);
        repositories.releases.insert(release, { actor: uploader.userId, at: now });
        repositories.auditLog.append(
          uploader.audit(
            now,
            'release.created',
            target,
            { type: 'release', id: release.id },
            {
              flavorKey: flavor.key,
              version: release.version.value,
              buildNumber: release.buildNumber,
              source: uploader.source,
            },
          ),
        );
      } else {
        release = existing.value;
      }

      const commit = input.commitSha === null ? release.gitCommitSha : parseCommitSha(input.commitSha.toLowerCase());
      assertArtifactAcceptable(release, { ...origin, gitCommitSha: commit });

      return {
        release,
        application,
        flavorKey: flavor.key,
        releaseCreated: existing === null,
        artifact: newArtifact(dependencies, uploader, release, binary.kind, input.fileName, received, now, binary),
      };
    },
  });
}

export interface UploadReleaseFileInput {
  readonly releaseId: ReleaseId;
  /** `binary` reads APK, AAB or IPA from the content; the other kinds are taken as declared. */
  readonly kind: 'binary' | SupplementaryKind;
  readonly fileName: string;
  readonly content: AsyncIterable<Uint8Array>;
}

/** Adds a file to an existing release: the missing platform build, dSYM, mapping file or build metadata. */
export function uploadReleaseFile(
  dependencies: UploadDependencies,
  actor: Actor,
  request: RequestContext,
  input: UploadReleaseFileInput,
): Promise<UploadResult> {
  return uploadReleaseFileAs(dependencies, userUploader(dependencies, actor, request), input);
}

export function uploadReleaseFileAs(
  dependencies: UploadDependencies,
  uploader: Uploader,
  input: UploadReleaseFileInput,
): Promise<UploadResult> {
  const subject = { type: 'release', id: input.releaseId };

  return upload(dependencies, uploader, input.content, {
    preflight: (repositories, guard) => {
      const { application, stored } = requireRelease(repositories, input.releaseId);
      guard.require('artifacts.upload', applicationTarget(application), subject);
      assertArtifactAcceptable(stored.value, originOfRelease(stored.value, 'metadata'));
    },
    inspect: input.kind === 'binary',
    record: ({ repositories, guard, identity, received, now }) => {
      const { stored, application, flavor } = requireRelease(repositories, input.releaseId);
      const release = stored.value;

      guard.require('artifacts.upload', applicationTarget(application), subject);

      if (identity === null) {
        const kind = input.kind as SupplementaryKind;
        assertArtifactAcceptable(release, originOfRelease(release, kind));
        return {
          release,
          application,
          flavorKey: flavor.key,
          releaseCreated: false,
          artifact: newArtifact(dependencies, uploader, release, kind, input.fileName, received, now, null),
        };
      }

      assertIdentifier(flavor, identity);
      assertArtifactAcceptable(release, { ...originOf(identity), gitCommitSha: release.gitCommitSha });

      return {
        release,
        application,
        flavorKey: flavor.key,
        releaseCreated: false,
        artifact: newArtifact(dependencies, uploader, release, identity.kind, input.fileName, received, now, identity),
      };
    },
  });
}

/* -- Pipeline ---------------------------------------------------------------------------------------------- */

interface RecordArguments {
  readonly repositories: Repositories;
  readonly guard: UploadGuard;
  readonly identity: BinaryIdentity | null;
  readonly received: ReceivedUpload;
  readonly now: Date;
}

interface Recorded {
  readonly release: Release;
  readonly application: Application;
  readonly flavorKey: string;
  readonly releaseCreated: boolean;
  readonly artifact: ReleaseArtifact;
}

interface UploadSteps {
  /** Runs before the body is read, so that refused uploads are not transferred in full. */
  readonly preflight: (repositories: Repositories, guard: UploadGuard) => void;
  readonly inspect: boolean;
  /** Validates and records the upload in one transaction; the artifact starts as `uploading`. */
  readonly record: (args: RecordArguments) => Recorded;
}

/**
 * Receive, inspect, record, commit (concept 5.5). No transaction is open while bytes move: the file is
 * streamed to `incoming/` with size and SHA-256, checked, recorded as `uploading`, moved into place
 * atomically and only then marked `stored`. A failed upload leaves no file behind.
 */
async function upload(
  dependencies: UploadDependencies,
  uploader: Uploader,
  content: AsyncIterable<Uint8Array>,
  steps: UploadSteps,
): Promise<UploadResult> {
  uploader.read(steps.preflight);

  const { storage } = dependencies;
  const uploadId = dependencies.ids.next<'Upload'>();
  let committed = false;

  try {
    const received = await storage.receive(uploadId, content, dependencies.maxUploadBytes);
    const identity = steps.inspect ? await inspect(dependencies, uploadId) : null;
    const recorded = uploader.transaction((repositories, guard, now): Recorded & { readonly repeated: boolean } => {
      const result = steps.record({ repositories, guard, identity, received, now });
      const { artifact, release } = result;
      const stored = repositories.releases
        .listArtifacts(release.id)
        .find((entry) => entry.storageState === 'stored' && sameFile(entry, artifact));

      // A retried request or a re-run workflow sends the same file again; it is already there.
      if (stored !== undefined) {
        return { ...result, artifact: stored, repeated: true };
      }

      repositories.releases.insertArtifact(artifact);
      repositories.auditLog.append(
        uploader.audit(
          now,
          'artifact.uploaded',
          applicationTarget(result.application),
          { type: 'artifact', id: artifact.id },
          {
            releaseId: release.id,
            flavorKey: result.flavorKey,
            version: release.version.value,
            buildNumber: release.buildNumber,
            kind: artifact.kind,
            abi: artifact.abi,
            sizeBytes: artifact.sizeBytes,
            sha256: artifact.sha256,
            source: artifact.uploadSource,
          },
        ),
      );
      return { ...result, repeated: false };
    });

    if (recorded.repeated) {
      return { releaseId: recorded.release.id, artifactId: recorded.artifact.id, releaseCreated: false };
    }

    await storage.commit(uploadId, recorded.artifact.storageKey);
    committed = true;
    dependencies.unitOfWork.transaction(({ releases }) =>
      releases.updateArtifactState(markArtifactStored(recorded.artifact)),
    );

    return {
      releaseId: recorded.release.id,
      artifactId: recorded.artifact.id,
      releaseCreated: recorded.releaseCreated,
    };
  } finally {
    if (!committed) {
      await storage.discard(uploadId).catch(() => undefined);
    }
  }
}

async function inspect(dependencies: UploadDependencies, uploadId: UploadId): Promise<BinaryIdentity> {
  const file = await dependencies.storage.openReceived(uploadId);

  try {
    return await dependencies.inspector.inspect(file);
  } finally {
    await file.close();
  }
}

/* -- Rules ------------------------------------------------------------------------------------------------- */

function flavorFor(
  repositories: Repositories,
  application: Application,
  identity: BinaryIdentity,
  flavorId: FlavorId | null,
): ApplicationFlavor {
  const platform = platformOf(identity.kind);
  const flavors = repositories.applications.listFlavors(application.id).map((stored) => stored.value);

  if (flavorId !== null) {
    const flavor = flavors.find((entry) => entry.id === flavorId);

    if (flavor === undefined) {
      throw new DomainError('flavor_not_found', 'The flavor does not exist.');
    }

    assertIdentifier(flavor, identity);
    return flavor;
  }

  const matching = flavors.find((flavor) => flavor.bundleIdentifiers[platform] === identity.identifier);

  if (matching !== undefined) {
    return matching;
  }

  if (flavors.every((flavor) => flavor.bundleIdentifiers[platform] === undefined)) {
    throw new DomainError(
      'bundle_identifier_missing',
      'The application has no identifier for this platform yet; set it before uploading.',
    );
  }

  throw new DomainError(
    'bundle_identifier_mismatch',
    'No flavor of the application uses the package name or bundle identifier of the file.',
  );
}

function assertIdentifier(flavor: ApplicationFlavor, identity: BinaryIdentity): void {
  const expected = flavor.bundleIdentifiers[platformOf(identity.kind)];

  if (expected === undefined) {
    throw new DomainError(
      'bundle_identifier_missing',
      'The flavor has no identifier for this platform yet; set it before uploading.',
    );
  }

  if (expected !== identity.identifier) {
    throw new DomainError(
      'bundle_identifier_mismatch',
      'The package name or bundle identifier of the file does not match the flavor.',
    );
  }
}

function startRelease(
  dependencies: UploadDependencies,
  uploader: Uploader,
  application: Application,
  flavor: ApplicationFlavor,
  origin: Omit<ArtifactOrigin, 'gitCommitSha'>,
  commitSha: string | null,
): Release {
  if (commitSha === null || commitSha === '') {
    throw new DomainError('commit_sha_required', 'A new release needs the commit SHA it was built from.');
  }

  if (flavor.status !== 'active') {
    throw new DomainError('flavor_not_active', 'Only active flavors accept new releases.');
  }

  return createRelease({
    id: dependencies.ids.next<'Release'>(),
    applicationId: application.id,
    flavorId: flavor.id,
    version: origin.version,
    buildNumber: origin.buildNumber,
    requiredPlatforms: application.platforms,
    gitCommitSha: parseCommitSha(commitSha.toLowerCase()),
    metadata: { releaseNotes: '', changelog: '', ...uploader.origin, importedFrom: null },
  });
}

function originOf(identity: BinaryIdentity): Omit<ArtifactOrigin, 'gitCommitSha'> {
  return { kind: identity.kind, version: parseVersion(identity.version), buildNumber: buildNumberOf(identity) };
}

/** Supplementary files carry no identity; they are checked against the release they are attached to. */
function originOfRelease(release: Release, kind: ArtifactKind): ArtifactOrigin {
  return { kind, version: release.version, buildNumber: release.buildNumber, gitCommitSha: release.gitCommitSha };
}

function buildNumberOf(identity: BinaryIdentity): BuildNumber {
  if (!/^\d{1,10}$/.test(identity.buildNumber)) {
    throw new DomainError(
      'invalid_build_number',
      'The build number in the file (versionCode or CFBundleVersion) must be a whole number.',
    );
  }

  return parseBuildNumber(Number(identity.buildNumber));
}

function platformOf(kind: BinaryIdentity['kind']): 'android' | 'ios' {
  return artifactKindSpec(kind).platform === 'ios' ? 'ios' : 'android';
}

const CONTENT_TYPES: Readonly<Record<ArtifactKind, string>> = {
  apk: 'application/vnd.android.package-archive',
  aab: 'application/octet-stream',
  ipa: 'application/octet-stream',
  dsym: 'application/zip',
  mapping: 'text/plain',
  metadata: 'application/json',
};

function newArtifact(
  dependencies: UploadDependencies,
  uploader: Uploader,
  release: Release,
  kind: ArtifactKind,
  fileName: string,
  received: ReceivedUpload,
  now: Date,
  identity: BinaryIdentity | null,
): ReleaseArtifact {
  const id = dependencies.ids.next<'Artifact'>();

  return createReleaseArtifact({
    id,
    releaseId: release.id,
    kind,
    abi: identity?.abi ?? null,
    buildMode: identity?.buildMode ?? 'release',
    originalFileName: baseName(fileName),
    contentType: CONTENT_TYPES[kind],
    sizeBytes: received.sizeBytes,
    sha256: received.sha256,
    storageKey: artifactStorageKey(release.applicationId, release.id, id, kind),
    gitCommitSha: release.gitCommitSha,
    workflowRunId: uploader.origin.workflowRun?.id ?? null,
    workflowRunAttempt: uploader.origin.workflowRun?.attempt ?? null,
    uploadSource: uploader.source,
    uploadedAt: now,
    uploadedBy: uploader.userId,
  });
}

function sameFile(a: ReleaseArtifact, b: ReleaseArtifact): boolean {
  return a.kind === b.kind && a.abi === b.abi && a.buildMode === b.buildMode && a.sha256 === b.sha256;
}

/** Browsers send the bare name, but nothing guarantees it; only the last path segment is kept. */
function baseName(fileName: string): string {
  return fileName.split(/[\\/]/).pop()?.trim() ?? '';
}

function required(identity: BinaryIdentity | null): BinaryIdentity {
  if (identity === null) {
    throw new DomainError('unreadable_binary', 'The file could not be read.');
  }

  return identity;
}
