import { parseDisplayName } from '../value-objects/display-name.js';
import { DomainError } from '../value-objects/domain-error.js';
import type { ApplicationId, ProjectId, ShareLinkId, UserId } from '../value-objects/identifier.js';

/** What a share link opens: a whole project (including applications added later) or one application. */
export type ShareScope =
  | { readonly type: 'project'; readonly projectId: ProjectId }
  | { readonly type: 'application'; readonly applicationId: ApplicationId };

/** Which releases a link shows: every published one, or only the newest per flavor (always replaced by the next). */
export const RELEASE_SELECTIONS = ['all', 'latest'] as const;

export type ReleaseSelection = (typeof RELEASE_SELECTIONS)[number];

/**
 * Access for people without an account, typically customers: whoever holds the link may see the published
 * releases in its scope and download or install them, nothing else. The link itself is a random secret of
 * which only the hash is stored; it ends when it expires or is revoked.
 */
export interface ShareLink {
  readonly id: ShareLinkId;
  readonly scope: ShareScope;
  /** Recipient or purpose, e.g. "Pflegedienst Meyer"; shown on the shared page and in the audit log. */
  readonly label: string;
  readonly releases: ReleaseSelection;
  readonly createdAt: Date;
  readonly createdBy: UserId;
  /** `null` for a link that lasts until it is revoked. */
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly revokedBy: UserId | null;
}

export interface NewShareLink {
  readonly id: ShareLinkId;
  readonly scope: ShareScope;
  readonly label: string;
  readonly releases: ReleaseSelection;
  readonly expiresAt: Date | null;
}

export function createShareLink(input: NewShareLink, now: Date, actor: UserId): ShareLink {
  if (input.expiresAt !== null && input.expiresAt.getTime() <= now.getTime()) {
    throw new DomainError('invalid_share_link', 'The expiry of a share link must lie in the future.');
  }

  return {
    id: input.id,
    scope: input.scope,
    label: parseDisplayName(input.label),
    releases: input.releases,
    createdAt: now,
    createdBy: actor,
    expiresAt: input.expiresAt,
    revokedAt: null,
    revokedBy: null,
  };
}

export function isShareLinkActive(link: ShareLink, now: Date): boolean {
  return link.revokedAt === null && (link.expiresAt === null || link.expiresAt.getTime() > now.getTime());
}

export function revokeShareLink(link: ShareLink, now: Date, actor: UserId): ShareLink {
  if (link.revokedAt !== null) {
    throw new DomainError('share_link_not_found', 'The share link does not exist or was already revoked.');
  }

  return { ...link, revokedAt: now, revokedBy: actor };
}
