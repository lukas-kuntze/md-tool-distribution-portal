import type { ReleaseArtifact } from '../domain/entities/release-artifact.js';
import type { ByteRange } from '../domain/ports/artifact-storage.js';
import type { TokenSigner } from '../domain/ports/token-signer.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import { isId, type ArtifactId, type UserId } from '../domain/value-objects/identifier.js';
import { auditChange, authorizedRead } from './authorization.js';
import {
  openArtifactDownload,
  requireReadableArtifact,
  type Download,
  type DownloadDependencies,
} from './download-artifact.js';
import type { ReleaseContext } from './lookups.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf } from './use-case.js';

export interface InstallDependencies extends DownloadDependencies {
  readonly signer: TokenSigner;
  /** How long an installation link stays usable; the device fetches manifest and IPA right after the tap. */
  readonly installLinkLifetimeMs: number;
}

export interface InstallLink {
  readonly token: string;
  readonly expiresAt: Date;
}

/** What iOS needs for the `itms-services` manifest. */
export interface InstallManifest {
  readonly artifactId: ArtifactId;
  readonly title: string;
  readonly bundleIdentifier: string;
  readonly version: string;
}

interface TokenPayload {
  readonly artifactId: ArtifactId;
  readonly actor: Actor;
  readonly expiresAt: number;
}

/**
 * Issues a short-lived link for installing an IPA over `itms-services`. iOS fetches manifest and IPA without
 * the browser's cookies, so the link carries the user in a signed token. Every use checks the token, the user
 * and the current permissions and release state again; a deletion or a revoked role ends it at once.
 */
export function issueInstallLink(
  dependencies: InstallDependencies,
  actor: Actor,
  request: RequestContext,
  input: { readonly artifactId: ArtifactId },
): InstallLink {
  const context = contextOf(dependencies, actor, request);
  const readable = authorizedRead(context, (repositories, guard) => {
    const found = requireReadableArtifact(repositories, guard, input.artifactId);
    installManifest(found);
    return found;
  });
  const expiresAt = new Date(context.now.getTime() + dependencies.installLinkLifetimeMs);
  const payload = { a: readable.artifact.id, u: actor.userId, l: actor.label, e: expiresAt.getTime() };

  dependencies.unitOfWork.transaction(({ auditLog }) =>
    auditLog.append(
      auditChange(
        context,
        'artifact.install_link.issued',
        readable.target,
        { type: 'artifact', id: readable.artifact.id },
        { releaseId: readable.artifact.releaseId, expiresAt: expiresAt.toISOString() },
      ),
    ),
  );

  return { token: dependencies.signer.sign(JSON.stringify(payload)), expiresAt };
}

export function describeInstall(
  dependencies: InstallDependencies,
  token: string,
  request: RequestContext,
): InstallManifest {
  const payload = resolveToken(dependencies, token);

  return authorizedRead(contextOf(dependencies, payload.actor, request), (repositories, guard) =>
    installManifest(requireReadableArtifact(repositories, guard, payload.artifactId)),
  );
}

export function openInstallDownload(
  dependencies: InstallDependencies,
  token: string,
  request: RequestContext,
  selectRange?: (sizeBytes: number) => ByteRange | null,
): Promise<Download> {
  const payload = resolveToken(dependencies, token);

  return openArtifactDownload(dependencies, payload.actor, request, {
    artifactId: payload.artifactId,
    ...(selectRange === undefined ? {} : { selectRange }),
  });
}

/** Manifest data of an IPA; refuses anything iOS cannot install from it. */
export function installManifest({
  artifact,
  application,
  flavor,
  stored,
}: ReleaseContext & { readonly artifact: ReleaseArtifact }): InstallManifest {
  const bundleIdentifier = flavor.bundleIdentifiers.ios;

  if (artifact.kind !== 'ipa' || bundleIdentifier === undefined) {
    throw new DomainError(
      'invalid_artifact',
      'Only IPA files of flavors with an iOS bundle identifier can be installed.',
    );
  }

  return {
    artifactId: artifact.id,
    title: application.flavorsEnabled ? `${application.name} ${flavor.name}` : application.name,
    bundleIdentifier,
    version: stored.value.version.value,
  };
}

function resolveToken(dependencies: InstallDependencies, token: string): TokenPayload {
  const payload = parsePayload(dependencies.signer.verify(token));
  const now = dependencies.clock.now().getTime();
  const userActive =
    payload !== null &&
    dependencies.unitOfWork.read(({ users }) => users.findById(payload.actor.userId)?.status === 'active');

  if (payload === null || payload.expiresAt <= now || !userActive) {
    throw new DomainError('install_link_invalid', 'The installation link is invalid or has expired.');
  }

  return payload;
}

function parsePayload(raw: string | null): TokenPayload | null {
  if (raw === null) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(raw);

    if (
      typeof value === 'object' &&
      value !== null &&
      'a' in value &&
      'u' in value &&
      'l' in value &&
      'e' in value &&
      typeof value.a === 'string' &&
      typeof value.u === 'string' &&
      typeof value.l === 'string' &&
      typeof value.e === 'number' &&
      isId(value.a) &&
      isId(value.u)
    ) {
      return {
        artifactId: value.a as ArtifactId,
        actor: { userId: value.u as UserId, label: value.l },
        expiresAt: value.e,
      };
    }
  } catch {
    // A token with a valid signature always holds JSON; anything else is treated as invalid.
  }

  return null;
}
