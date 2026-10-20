import { describe, expect, it } from 'vitest';

import { formatBytes, formatDate, formatDateTime, releaseLabel, shortSha, suggestSlug } from './format.js';

describe('format', (): void => {
  it('formats sizes with German decimals', (): void => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(327_772_160)).toBe('312,6 MB');
  });

  it('names releases and shortens commits like the rest of the platform', (): void => {
    expect(releaseLabel({ version: '4.13.0', buildNumber: 125 })).toBe('4.13.0 (125)');
    expect(shortSha('0123456789abcdef')).toBe('0123456');
  });

  it('shows a dash for missing timestamps', (): void => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('2026-10-17T08:15:30.000Z')).toContain('2026');
  });

  it('suggests slugs from display names', (): void => {
    expect(suggestSlug('MD Ambulant')).toBe('md-ambulant');
    expect(suggestSlug('  Größe & Übersicht!  ')).toBe('groesse-uebersicht');
    expect(suggestSlug('a'.repeat(70))).toHaveLength(63);
  });
});

describe('role order', (): void => {
  it('lists roles with more permissions first', async (): Promise<void> => {
    const { byPermissions } = await import('./labels.js');
    const roles = [
      { key: 'viewer', permissions: ['projects.read', 'artifacts.download'] },
      { key: 'platform-admin', permissions: ['a', 'b', 'c', 'd'] },
      { key: 'tester', permissions: ['releases.read', 'artifacts.download'] },
      { key: 'developer', permissions: ['a', 'b', 'c'] },
    ];

    expect(byPermissions(roles).map((role) => role.key)).toEqual(['platform-admin', 'developer', 'viewer', 'tester']);
  });
});

describe('page numbers', (): void => {
  it('keeps first and last page and shortens gaps with an ellipsis', async (): Promise<void> => {
    const { pageNumbers } = await import('./dom.js');

    expect(pageNumbers(0, 1)).toEqual([0]);
    expect(pageNumbers(0, 12)).toEqual([0, 1, null, 11]);
    expect(pageNumbers(5, 12)).toEqual([0, null, 4, 5, 6, null, 11]);
    expect(pageNumbers(2, 12)).toEqual([0, 1, 2, 3, null, 11]);
    expect(pageNumbers(11, 12)).toEqual([0, null, 10, 11]);
  });
});
