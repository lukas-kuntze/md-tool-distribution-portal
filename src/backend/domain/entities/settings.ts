import { DomainError } from '../value-objects/domain-error.js';

/**
 * Behaviour of the platform that administrators adjust at runtime (settings page). Everything the service needs
 * to start — secrets, paths, network, GitHub — stays in environment variables; those values here only seed the
 * settings on the first start.
 */
export interface Settings {
  /** Days a deleted release or artifact stays restorable before it is purged (decision E5). */
  readonly quarantineDays: number;
  readonly sessionAbsoluteHours: number;
  readonly sessionIdleMinutes: number;
  readonly installLinkMinutes: number;
  /** Preset expiry of new share links in days; `null` presets "no expiry". */
  readonly shareLinkDefaultDays: number | null;
  /** Longest allowed lifetime of a share link in days; `null` allows links without expiry. */
  readonly shareLinkMaxDays: number | null;
  readonly shareLinkDefaultReleases: 'all' | 'latest';
  readonly defaultVisibility: 'private' | 'organization';
  readonly reconcileHours: number;
  readonly dashboardDownloadDays: number;
  readonly dashboardQuarantineDays: number;
  readonly dashboardShareExpiryDays: number;
  readonly portalName: string;
  /** Who to contact about installations, shown on download and share pages. */
  readonly supportContact: string;
  /** Notice shown on download and share pages, e.g. about supported devices. */
  readonly publicNotice: string;
  readonly footerText: string;
}

export const DEFAULT_SETTINGS: Settings = {
  quarantineDays: 7,
  sessionAbsoluteHours: 12,
  sessionIdleMinutes: 120,
  installLinkMinutes: 10,
  shareLinkDefaultDays: null,
  shareLinkMaxDays: null,
  shareLinkDefaultReleases: 'all',
  defaultVisibility: 'private',
  reconcileHours: 24,
  dashboardDownloadDays: 30,
  dashboardQuarantineDays: 7,
  dashboardShareExpiryDays: 14,
  portalName: 'App-Distribution',
  supportContact: '',
  publicNotice: '',
  footerText: 'Bereitgestellt über die App-Distribution',
};

/** Accepted range per numeric setting; shared with the settings page for immediate feedback. */
export const SETTING_RANGES = {
  quarantineDays: [1, 90],
  sessionAbsoluteHours: [1, 168],
  sessionIdleMinutes: [5, 1440],
  installLinkMinutes: [1, 60],
  shareLinkDefaultDays: [1, 365],
  shareLinkMaxDays: [1, 730],
  reconcileHours: [1, 168],
  dashboardDownloadDays: [1, 365],
  dashboardQuarantineDays: [1, 90],
  dashboardShareExpiryDays: [1, 90],
} as const satisfies Partial<Record<keyof Settings, readonly [number, number]>>;

export const SETTING_TEXT_LIMITS = {
  portalName: [1, 60],
  supportContact: [0, 200],
  publicNotice: [0, 1000],
  footerText: [0, 200],
} as const satisfies Partial<Record<keyof Settings, readonly [number, number]>>;

/** Checks every value and the rules between them; text is trimmed. Fails with `invalid_settings`. */
export function validateSettings(candidate: Settings): Settings {
  for (const [name, [min, max]] of Object.entries(SETTING_RANGES) as [
    keyof typeof SETTING_RANGES,
    readonly [number, number],
  ][]) {
    const value = candidate[name];

    if (value === null && (name === 'shareLinkDefaultDays' || name === 'shareLinkMaxDays')) {
      continue;
    }

    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw invalid(`${name} must be a whole number between ${min} and ${max}.`);
    }
  }

  const texts = Object.fromEntries(
    (Object.keys(SETTING_TEXT_LIMITS) as (keyof typeof SETTING_TEXT_LIMITS)[]).map((name) => {
      const [min, max] = SETTING_TEXT_LIMITS[name];
      const value = candidate[name].trim();

      if (value.length < min || value.length > max) {
        throw invalid(`${name} must have between ${min} and ${max} characters.`);
      }

      return [name, value];
    }),
  ) as Pick<Settings, keyof typeof SETTING_TEXT_LIMITS>;

  if (candidate.sessionIdleMinutes > candidate.sessionAbsoluteHours * 60) {
    throw invalid('The idle timeout cannot be longer than the absolute session lifetime.');
  }

  if (candidate.shareLinkMaxDays !== null) {
    if (candidate.shareLinkDefaultDays === null) {
      throw invalid('With a maximum lifetime, new share links need a preset expiry.');
    }

    if (candidate.shareLinkDefaultDays > candidate.shareLinkMaxDays) {
      throw invalid('The preset expiry of share links cannot exceed their maximum lifetime.');
    }
  }

  return { ...candidate, ...texts };
}

/** Stored settings over the defaults, so that settings added later get their default. */
export function withDefaults(stored: Partial<Settings>, defaults: Settings = DEFAULT_SETTINGS): Settings {
  return { ...defaults, ...stored };
}

const DAY_MS = 24 * 60 * 60_000;

export function quarantineRetentionMs(settings: Settings): number {
  return settings.quarantineDays * DAY_MS;
}

export function sessionPolicyOf(settings: Settings): { readonly absoluteMs: number; readonly idleMs: number } {
  return { absoluteMs: settings.sessionAbsoluteHours * 60 * 60_000, idleMs: settings.sessionIdleMinutes * 60_000 };
}

/**
 * Latest allowed expiry of a share link created at `now`, `null` without limit. Links expire at the end of a
 * calendar day in the creator's time zone, so the last allowed day counts in full: one day of tolerance.
 */
export function latestShareExpiry(settings: Settings, now: Date): Date | null {
  return settings.shareLinkMaxDays === null ? null : new Date(now.getTime() + (settings.shareLinkMaxDays + 1) * DAY_MS);
}

function invalid(message: string): DomainError {
  return new DomainError('invalid_settings', message);
}
