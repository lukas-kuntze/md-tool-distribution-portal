import type { Migration } from '../migration.js';

/** Personal settings of each account on the "Mein Konto" page: colour mode and the page shown after sign-in. */
export const accountPreferences: Migration = {
  version: 10,
  name: 'account-preferences',
  sql: `
ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark'));
ALTER TABLE users ADD COLUMN start_page TEXT NOT NULL DEFAULT 'dashboard' CHECK (start_page IN ('dashboard', 'apps'));
`,
};
