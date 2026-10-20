import { describe, expect, it } from 'vitest';

import { DomainError } from '../value-objects/domain-error.js';
import {
  DEFAULT_SETTINGS,
  latestShareExpiry,
  quarantineRetentionMs,
  sessionPolicyOf,
  validateSettings,
  withDefaults,
  type Settings,
} from './settings.js';

const valid = (changes: Partial<Settings>): Settings => validateSettings({ ...DEFAULT_SETTINGS, ...changes });
const codeOf = (work: () => unknown): string | undefined => {
  try {
    work();
    return undefined;
  } catch (error) {
    return error instanceof DomainError ? error.code : 'other';
  }
};

describe('settings', (): void => {
  it('accepts the defaults and trims texts', (): void => {
    expect(valid({})).toEqual(DEFAULT_SETTINGS);
    expect(valid({ portalName: '  Apps  ', supportContact: ' it@example.com ' })).toMatchObject({
      portalName: 'Apps',
      supportContact: 'it@example.com',
    });
  });

  it('refuses values outside their range and fractions', (): void => {
    expect(codeOf(() => valid({ quarantineDays: 0 }))).toBe('invalid_settings');
    expect(codeOf(() => valid({ quarantineDays: 91 }))).toBe('invalid_settings');
    expect(codeOf(() => valid({ installLinkMinutes: 2.5 }))).toBe('invalid_settings');
    expect(codeOf(() => valid({ portalName: '   ' }))).toBe('invalid_settings');
    expect(codeOf(() => valid({ publicNotice: 'x'.repeat(1001) }))).toBe('invalid_settings');
  });

  it('keeps the idle timeout within the session lifetime', (): void => {
    expect(codeOf(() => valid({ sessionAbsoluteHours: 1, sessionIdleMinutes: 61 }))).toBe('invalid_settings');
    expect(valid({ sessionAbsoluteHours: 1, sessionIdleMinutes: 60 }).sessionIdleMinutes).toBe(60);
  });

  it('requires a preset expiry within the maximum lifetime of share links', (): void => {
    expect(codeOf(() => valid({ shareLinkMaxDays: 30 }))).toBe('invalid_settings');
    expect(codeOf(() => valid({ shareLinkMaxDays: 30, shareLinkDefaultDays: 31 }))).toBe('invalid_settings');
    expect(valid({ shareLinkMaxDays: 30, shareLinkDefaultDays: 14 }).shareLinkMaxDays).toBe(30);
    expect(valid({ shareLinkDefaultDays: 14 }).shareLinkMaxDays).toBeNull();
  });

  it('derives durations and fills settings added later with defaults', (): void => {
    const now = new Date('2026-10-18T10:00:00.000Z');

    expect(quarantineRetentionMs(valid({ quarantineDays: 7 }))).toBe(7 * 24 * 60 * 60_000);
    expect(sessionPolicyOf(DEFAULT_SETTINGS)).toEqual({ absoluteMs: 12 * 60 * 60_000, idleMs: 120 * 60_000 });
    expect(latestShareExpiry(DEFAULT_SETTINGS, now)).toBeNull();
    expect(latestShareExpiry(valid({ shareLinkMaxDays: 2, shareLinkDefaultDays: 1 }), now)?.toISOString()).toBe(
      '2026-10-21T10:00:00.000Z',
    );
    expect(withDefaults({ quarantineDays: 3 })).toEqual({ ...DEFAULT_SETTINGS, quarantineDays: 3 });
  });
});
