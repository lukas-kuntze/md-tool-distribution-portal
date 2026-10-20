import { describe, expect, it } from 'vitest';

import { artifactKindSpec, parseArtifactKind } from './artifact-kind.js';

describe('artifact kinds', (): void => {
  it('marks only APK and IPA as installable', (): void => {
    expect(artifactKindSpec('apk').installable).toBe(true);
    expect(artifactKindSpec('ipa').installable).toBe(true);
    expect(artifactKindSpec('aab').installable).toBe(false);
  });

  it('lets an AAB provide the Android build of a release', (): void => {
    expect(artifactKindSpec('aab')).toMatchObject({ platform: 'android', providesPlatformBuild: true });
  });

  it('accepts known kinds and rejects unknown ones', (): void => {
    expect(parseArtifactKind('ipa')).toBe('ipa');
    expect((): string => parseArtifactKind('exe')).toThrow(expect.objectContaining({ code: 'invalid_artifact_kind' }));
  });
});
