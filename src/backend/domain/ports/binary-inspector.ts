import type { Abi, BuildMode } from '../entities/release-artifact.js';
import type { ReceivedFile } from './artifact-storage.js';

/** Kinds of artifact whose content states which app and which build they are. */
export const INSPECTABLE_KINDS = ['apk', 'aab', 'ipa'] as const;

export type InspectableKind = (typeof INSPECTABLE_KINDS)[number];

/**
 * What an installable binary says about itself: Android reads it from `AndroidManifest.xml`, iOS from the
 * `Info.plist` of the app bundle. Values are reported as found; the caller validates them.
 */
export interface BinaryIdentity {
  readonly kind: InspectableKind;
  /** Android package name or iOS bundle identifier. */
  readonly identifier: string;
  /** `versionName` or `CFBundleShortVersionString`. */
  readonly version: string;
  /** `versionCode` or `CFBundleVersion`. */
  readonly buildNumber: string;
  /** Native code of an APK built for a single ABI; `null` for other kinds. */
  readonly abi: Abi | null;
  readonly buildMode: BuildMode;
}

export interface BinaryInspector {
  /** Detects the kind from the content, never from the file name. Fails with `unreadable_binary`. */
  inspect(file: ReceivedFile): Promise<BinaryIdentity>;
}
