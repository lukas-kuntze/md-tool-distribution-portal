import type { Abi } from '../../../domain/entities/release-artifact.js';
import type { ReceivedFile } from '../../../domain/ports/artifact-storage.js';
import type { BinaryIdentity, BinaryInspector } from '../../../domain/ports/binary-inspector.js';
import { parseBinaryManifest, type ManifestElement, type ManifestValue } from './android-binary-xml.js';
import { parseProtoManifest } from './android-proto-xml.js';
import { parsePropertyList, type PlistValue } from './property-list.js';
import { unreadable, ZipArchive } from './zip-archive.js';

/** Manifests and property lists are a few kilobytes; anything far larger is not what it claims to be. */
const MAX_METADATA_BYTES = 4 * 1024 * 1024;

const APK_MANIFEST = 'AndroidManifest.xml';
const BUNDLE_MANIFEST = 'base/manifest/AndroidManifest.xml';
const IPA_INFO_PLIST = /^Payload\/[^/]+\.app\/Info\.plist$/;
const SINGLE_ABIS: readonly Abi[] = ['arm64-v8a', 'armeabi-v7a', 'x86_64'];

/**
 * Reads the identity of APK, AAB and IPA files. All three are ZIP archives; the kind follows from which
 * manifest the archive contains, so a renamed file is still recognised for what it is.
 */
export class ZipBinaryInspector implements BinaryInspector {
  public async inspect(file: ReceivedFile): Promise<BinaryIdentity> {
    const archive = await ZipArchive.open(file);
    const apkManifest = archive.find(APK_MANIFEST);

    if (apkManifest !== undefined) {
      const manifest = parseBinaryManifest(await archive.read(apkManifest, MAX_METADATA_BYTES));
      return { kind: 'apk', ...androidIdentity(manifest), abi: abiOf(archive) };
    }

    const bundleManifest = archive.find(BUNDLE_MANIFEST);

    if (bundleManifest !== undefined) {
      const manifest = parseProtoManifest(await archive.read(bundleManifest, MAX_METADATA_BYTES));
      return { kind: 'aab', ...androidIdentity(manifest), abi: null };
    }

    const infoPlists = archive.entries.filter((entry) => IPA_INFO_PLIST.test(entry.name));

    if (infoPlists.length === 1) {
      const plist = parsePropertyList(await archive.read(infoPlists[0]!, MAX_METADATA_BYTES));
      return {
        kind: 'ipa',
        identifier: plistText(plist['CFBundleIdentifier'], 'CFBundleIdentifier'),
        version: plistText(plist['CFBundleShortVersionString'], 'CFBundleShortVersionString'),
        buildNumber: plistText(plist['CFBundleVersion'], 'CFBundleVersion'),
        abi: null,
        // An IPA does not say how it was built; distributable IPAs are release or profile builds.
        buildMode: 'release',
      };
    }

    throw unreadable('The file is neither an APK, an AAB nor an IPA.');
  }
}

function androidIdentity(elements: readonly ManifestElement[]): Omit<BinaryIdentity, 'kind' | 'abi'> {
  const manifest = elements.find((element) => element.depth === 0 && element.name === 'manifest');

  if (manifest === undefined) {
    throw unreadable('AndroidManifest.xml has no manifest element.');
  }

  const application = elements.find((element) => element.depth === 1 && element.name === 'application');

  return {
    identifier: manifestText(manifest.attributes.get('package'), 'package'),
    version: manifestText(manifest.attributes.get('versionName'), 'versionName'),
    buildNumber: manifestText(manifest.attributes.get('versionCode'), 'versionCode'),
    buildMode: application?.attributes.get('debuggable') === true ? 'debug' : 'release',
  };
}

function manifestText(value: ManifestValue | undefined, name: string): string {
  if (typeof value === 'string' && value !== '') {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  throw unreadable(
    typeof value === 'object'
      ? `AndroidManifest.xml refers to a resource for ${name}; a literal value is required.`
      : `AndroidManifest.xml does not state ${name}.`,
  );
}

function plistText(value: PlistValue | undefined, name: string): string {
  if (typeof value === 'string' && value !== '') {
    return value;
  }

  throw unreadable(`Info.plist does not state ${name}.`);
}

/** An APK built with `--split-per-abi` holds native code of one ABI only; everything else counts as universal. */
function abiOf(archive: ZipArchive): Abi {
  const abis = new Set(
    archive.entries.flatMap((entry) => {
      const match = /^lib\/([^/]+)\//.exec(entry.name);
      return match === null ? [] : [match[1]!];
    }),
  );
  const [only] = abis;

  return abis.size === 1 && SINGLE_ABIS.includes(only as Abi) ? (only as Abi) : 'universal';
}
