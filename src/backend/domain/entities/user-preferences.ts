export const THEMES = ['system', 'light', 'dark'] as const;
export const START_PAGES = ['dashboard', 'apps'] as const;

/** Personal settings of an account; they change nothing about what the person may do. */
export interface UserPreferences {
  /** `system` follows the colour mode of the device. */
  readonly theme: (typeof THEMES)[number];
  /** Page shown after signing in: the dashboard of the administration or the download page. */
  readonly startPage: (typeof START_PAGES)[number];
}

export const DEFAULT_PREFERENCES: UserPreferences = { theme: 'system', startPage: 'dashboard' };
