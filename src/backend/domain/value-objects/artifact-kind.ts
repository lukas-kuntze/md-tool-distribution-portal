import { DomainError } from './domain-error.js';
import type { Platform } from './platform.js';

export const ARTIFACT_KINDS = ['apk', 'aab', 'ipa', 'dsym', 'mapping', 'metadata'] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface ArtifactKindSpec {
  /** Platform the artifact belongs to; `null` for platform-independent files. */
  readonly platform: Platform | null;
  /** The only file extension used in storage for this kind. */
  readonly extension: string;
  /** Whether a device can install the file directly, so that an installation link is offered. */
  readonly installable: boolean;
  /** Whether the file counts as the build of its platform when checking a release for completeness. */
  readonly providesPlatformBuild: boolean;
}

const SPECS: Readonly<Record<ArtifactKind, ArtifactKindSpec>> = {
  apk: { platform: 'android', extension: 'apk', installable: true, providesPlatformBuild: true },
  aab: { platform: 'android', extension: 'aab', installable: false, providesPlatformBuild: true },
  ipa: { platform: 'ios', extension: 'ipa', installable: true, providesPlatformBuild: true },
  dsym: { platform: 'ios', extension: 'zip', installable: false, providesPlatformBuild: false },
  mapping: { platform: 'android', extension: 'txt', installable: false, providesPlatformBuild: false },
  metadata: { platform: null, extension: 'json', installable: false, providesPlatformBuild: false },
};

export function isArtifactKind(value: string): value is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(value);
}

export function parseArtifactKind(value: string): ArtifactKind {
  if (!isArtifactKind(value)) {
    throw new DomainError('invalid_artifact_kind', `Artifact kind must be one of: ${ARTIFACT_KINDS.join(', ')}.`);
  }

  return value;
}

export function artifactKindSpec(kind: ArtifactKind): ArtifactKindSpec {
  return SPECS[kind];
}
