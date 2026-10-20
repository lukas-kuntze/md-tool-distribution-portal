import type { ShareLink } from '../entities/share-link.js';
import type { ApplicationId, ProjectId, ShareLinkId } from '../value-objects/identifier.js';

export interface ShareLinkRepository {
  /** Stores the link with the hash of its secret; the secret itself is never stored. */
  insert(link: ShareLink, tokenHash: string): void;
  /** Persists the revocation; nothing else about a link changes. */
  update(link: ShareLink): void;
  findById(id: ShareLinkId): ShareLink | null;
  findByTokenHash(tokenHash: string): ShareLink | null;
  /** Links of the project and of all its applications, newest first. */
  listByProject(projectId: ProjectId): readonly ShareLink[];
  /** Links of the application only, newest first. */
  listByApplication(applicationId: ApplicationId): readonly ShareLink[];
}
