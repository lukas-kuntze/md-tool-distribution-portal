import { describe, expect, it } from 'vitest';

import { parseId } from '../value-objects/identifier.js';
import { createSession, isSessionActive, needsActivityUpdate } from './session.js';

const start = new Date('2026-10-17T10:00:00.000Z');
const policy = { absoluteMs: 12 * 60 * 60_000, idleMs: 2 * 60 * 60_000 };
const at = (minutes: number): Date => new Date(start.getTime() + minutes * 60_000);
const session = createSession(
  parseId('0192f3a4-0000-7000-8000-000000000400'),
  parseId('0192f3a4-0000-7000-8000-000000000001'),
  'octocat',
  start,
  policy,
);

describe('session', (): void => {
  it('expires after the absolute lifetime even when used', (): void => {
    const recentlyUsed = { ...session, lastSeenAt: at(12 * 60 - 1) };

    expect(isSessionActive(recentlyUsed, at(12 * 60 - 1), policy)).toBe(true);
    expect(isSessionActive(recentlyUsed, at(12 * 60), policy)).toBe(false);
  });

  it('expires after being idle', (): void => {
    expect(isSessionActive(session, at(119), policy)).toBe(true);
    expect(isSessionActive(session, at(120), policy)).toBe(false);
  });

  it('ends when revoked', (): void => {
    expect(isSessionActive({ ...session, revokedAt: start }, start, policy)).toBe(false);
  });

  it('records activity at most once a minute', (): void => {
    expect(needsActivityUpdate(session, at(0.5))).toBe(false);
    expect(needsActivityUpdate(session, at(1))).toBe(true);
  });
});
