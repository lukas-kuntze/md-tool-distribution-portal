import { describe, expect, it } from 'vitest';

import { aab, apk, binaryManifest, inMemoryFile, ipa, zip, type ManifestFields } from './testing/binary-fixtures.js';
import { ZipBinaryInspector } from './zip-binary-inspector.js';

const android: ManifestFields = { packageName: 'de.example.app', versionCode: 125, versionName: '4.13.0' };
const inspector = new ZipBinaryInspector();
const inspect = (bytes: Buffer): ReturnType<ZipBinaryInspector['inspect']> => inspector.inspect(inMemoryFile(bytes));

describe('ZipBinaryInspector', (): void => {
  it('reads package name, version and build number of an APK', async (): Promise<void> => {
    await expect(inspect(apk(android))).resolves.toEqual({
      kind: 'apk',
      identifier: 'de.example.app',
      version: '4.13.0',
      buildNumber: '125',
      abi: 'universal',
      buildMode: 'release',
    });
  });

  it('reads UTF-8 string pools and attribute names known only by resource id', async (): Promise<void> => {
    for (const options of [{ utf8: true }, { stripNames: true }, { utf8: true, stripNames: true }]) {
      const bytes = zip([{ name: 'AndroidManifest.xml', data: binaryManifest(android, options) }]);
      await expect(inspect(bytes)).resolves.toMatchObject({ identifier: 'de.example.app', buildNumber: '125' });
    }
  });

  it('recognises debug builds and APKs split per ABI', async (): Promise<void> => {
    await expect(inspect(apk({ ...android, debuggable: true }))).resolves.toMatchObject({ buildMode: 'debug' });
    await expect(inspect(apk({ ...android, debuggable: false }))).resolves.toMatchObject({ buildMode: 'release' });
    await expect(inspect(apk(android, ['arm64-v8a']))).resolves.toMatchObject({ abi: 'arm64-v8a' });
    await expect(inspect(apk(android, ['arm64-v8a', 'armeabi-v7a', 'x86_64']))).resolves.toMatchObject({
      abi: 'universal',
    });
  });

  it('reads the protocol buffer manifest of an Android App Bundle', async (): Promise<void> => {
    await expect(inspect(aab({ ...android, debuggable: true }))).resolves.toEqual({
      kind: 'aab',
      identifier: 'de.example.app',
      version: '4.13.0',
      buildNumber: '125',
      abi: null,
      buildMode: 'debug',
    });
  });

  it('reads the Info.plist of an IPA in binary and XML form', async (): Promise<void> => {
    const fields = { bundleIdentifier: 'de.example.app', version: '4.13.0', buildNumber: '125' };
    const expected = { kind: 'ipa', identifier: 'de.example.app', version: '4.13.0', buildNumber: '125', abi: null };

    await expect(inspect(ipa(fields))).resolves.toMatchObject(expected);
    await expect(inspect(ipa(fields, { xml: true }))).resolves.toMatchObject(expected);
    await expect(inspect(ipa({ ...fields, bundleIdentifier: 'de.example.äpp' }))).resolves.toMatchObject({
      identifier: 'de.example.äpp',
    });
  });

  it('reads ZIP64 archives and archives with a comment', async (): Promise<void> => {
    const files = [{ name: 'AndroidManifest.xml', data: binaryManifest(android) }];

    await expect(inspect(zip(files, { zip64: true }))).resolves.toMatchObject({ kind: 'apk' });
    await expect(inspect(zip(files, { comment: 'signed by apksigner' }))).resolves.toMatchObject({ kind: 'apk' });
  });

  it('refuses files that are not one of the three kinds', async (): Promise<void> => {
    const refused = { code: 'unreadable_binary' };

    await expect(inspect(Buffer.from('definitely not a zip archive'))).rejects.toMatchObject(refused);
    await expect(inspect(zip([{ name: 'README.md', data: '# hi' }]))).rejects.toMatchObject(refused);
    await expect(inspect(apk(android).subarray(0, 200))).rejects.toMatchObject(refused);
    await expect(inspect(zip([{ name: 'AndroidManifest.xml', data: '<manifest/>' }]))).rejects.toMatchObject(refused);
    await expect(
      inspect(zip([{ name: 'base/manifest/AndroidManifest.xml', data: Buffer.from([0x0a, 0xff]) }])),
    ).rejects.toMatchObject(refused);
  });

  it('refuses IPAs that do not state their identity and oversized manifests', async (): Promise<void> => {
    const incomplete = zip([{ name: 'Payload/Runner.app/Info.plist', data: '<plist><dict></dict></plist>' }]);
    const huge = zip([{ name: 'AndroidManifest.xml', data: Buffer.alloc(5 * 1024 * 1024) }]);

    await expect(inspect(incomplete)).rejects.toThrow('CFBundleIdentifier');
    await expect(inspect(huge)).rejects.toMatchObject({ code: 'unreadable_binary' });
  });
});
