import { describe, expect, it } from 'vitest';

import type { ProjectId, ShareLinkId, UserId } from '../value-objects/identifier.js';
import { createShareLink, isShareLinkActive, revokeShareLink } from './share-link.js';

const NOW = new Date('2026-10-17T08:00:00.000Z');
const LATER = new Date('2026-11-17T08:00:00.000Z');
const ADMIN = '0192f3a4-0000-7000-8000-000000000001' as UserId;
const input = {
  releases: 'all' as const,
  id: '0192f3a4-0000-7000-8000-000000000002' as ShareLinkId,
  scope: { type: 'project', projectId: '0192f3a4-0000-7000-8000-000000000003' as ProjectId } as const,
  label: '  Pflegedienst Meyer ',
};

describe('share link', (): void => {
  it('is active until it expires or is revoked', (): void => {
    const link = createShareLink({ ...input, expiresAt: LATER }, NOW, ADMIN);

    expect(link.label).toBe('Pflegedienst Meyer');
    expect(isShareLinkActive(link, NOW)).toBe(true);
    expect(isShareLinkActive(link, LATER)).toBe(false);

    const revoked = revokeShareLink(link, NOW, ADMIN);
    expect(isShareLinkActive(revoked, NOW)).toBe(false);
    expect(revoked).toMatchObject({ revokedAt: NOW, revokedBy: ADMIN });
    expect(() => revokeShareLink(revoked, NOW, ADMIN)).toThrow(
      expect.objectContaining({ code: 'share_link_not_found' }),
    );
  });

  it('may last until it is revoked, but never start expired or without a label', (): void => {
    expect(isShareLinkActive(createShareLink({ ...input, expiresAt: null }, NOW, ADMIN), LATER)).toBe(true);
    expect(() => createShareLink({ ...input, expiresAt: NOW }, NOW, ADMIN)).toThrow(
      expect.objectContaining({ code: 'invalid_share_link' }),
    );
    expect(() => createShareLink({ ...input, label: ' ', expiresAt: null }, NOW, ADMIN)).toThrow(
      expect.objectContaining({ code: 'invalid_name' }),
    );
  });
});
