import type { Migration } from '../migration.js';

/** A share link shows either every published release or only the newest one per flavor. */
export const shareLinkReleases: Migration = {
  version: 4,
  name: 'share-link-releases',
  sql: `
ALTER TABLE share_links ADD COLUMN release_selection TEXT NOT NULL DEFAULT 'all'
  CHECK (release_selection IN ('all', 'latest'));
`,
};
