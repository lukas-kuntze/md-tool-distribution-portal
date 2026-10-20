import { describe, expect, it } from 'vitest';

import { compareVersions, parseVersion, type Version } from './version.js';

describe('parseVersion', (): void => {
  it('parses a release version', (): void => {
    expect(parseVersion('4.13.0')).toEqual({ value: '4.13.0', major: 4, minor: 13, patch: 0, preRelease: null });
  });

  it('parses a pre-release version', (): void => {
    expect(parseVersion('4.13.0-beta.1').preRelease).toBe('beta.1');
  });

  it.each(['4.13', '04.13.0', '4.13.0+125', '4.13.0-', '4.13.0-01', 'v4.13.0', '99999999999999999999.0.0'])(
    'rejects %s',
    (value): void => {
      expect((): Version => parseVersion(value)).toThrow(expect.objectContaining({ code: 'invalid_version' }));
    },
  );
});

describe('compareVersions', (): void => {
  const ordered = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
    '1.0.1',
    '1.2.0',
    '2.0.0',
  ];

  it('orders versions by semantic versioning precedence', (): void => {
    const shuffled = [...ordered].reverse().map(parseVersion);

    expect(shuffled.sort(compareVersions).map((version) => version.value)).toEqual(ordered);
  });

  it('treats identical versions as equal', (): void => {
    expect(compareVersions(parseVersion('4.13.0-rc.1'), parseVersion('4.13.0-rc.1'))).toBe(0);
  });
});
