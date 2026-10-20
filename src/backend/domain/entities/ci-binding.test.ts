import { describe, expect, it } from 'vitest';

import { parseId } from '../value-objects/identifier.js';
import {
  acceptsJob,
  createCiBinding,
  matchesRefPattern,
  revokeCiBinding,
  type CiBinding,
  type NewCiBinding,
} from './ci-binding.js';

const now = new Date('2026-10-18T10:00:00Z');
const admin = parseId<'User'>('0192f3a4-0000-7000-8000-000000000001');
const input: NewCiBinding = {
  id: parseId<'CiBinding'>('0192f3a4-0000-7000-8000-000000000300'),
  applicationId: parseId<'Application'>('0192f3a4-0000-7000-8000-000000000020'),
  repositoryId: 4711,
  repositoryName: ' medifox/pflege-mobil ',
  refPattern: 'refs/heads/main',
  environment: ' ',
};
const job = { repositoryId: 4711, repository: 'medifox/pflege-mobil', ref: 'refs/heads/main', environment: null };
const errorCode = (code: string): unknown => expect.objectContaining({ code });

describe('CI binding', (): void => {
  it('normalises its input', (): void => {
    expect(createCiBinding(input, now, admin)).toMatchObject({
      repositoryName: 'medifox/pflege-mobil',
      environment: null,
      createdAt: now,
      revokedAt: null,
    });
  });

  it.each([
    ['repository id', { repositoryId: 0 }],
    ['repository name', { repositoryName: 'pflege-mobil' }],
    ['ref outside branches and tags', { refPattern: 'refs/pull/1/merge' }],
    ['ref with other wildcards', { refPattern: 'refs/heads/release-?' }],
    ['ref with three stars', { refPattern: 'refs/heads/***' }],
  ])('rejects an invalid %s', (_name, change): void => {
    expect((): CiBinding => createCiBinding({ ...input, ...change }, now, admin)).toThrow(
      errorCode('invalid_ci_binding'),
    );
  });

  it('matches refs with * inside one segment and ** across segments', (): void => {
    expect(matchesRefPattern('refs/heads/main', 'refs/heads/main')).toBe(true);
    expect(matchesRefPattern('refs/heads/main', 'refs/heads/main-old')).toBe(false);
    expect(matchesRefPattern('refs/tags/v*', 'refs/tags/v4.13.0')).toBe(true);
    expect(matchesRefPattern('refs/heads/release/*', 'refs/heads/release/4.13')).toBe(true);
    expect(matchesRefPattern('refs/heads/release/*', 'refs/heads/release/4.13/hotfix')).toBe(false);
    expect(matchesRefPattern('refs/heads/release/**', 'refs/heads/release/4.13/hotfix')).toBe(true);
    // A dot in the pattern is a dot, not any character.
    expect(matchesRefPattern('refs/tags/v4.13', 'refs/tags/v4x13')).toBe(false);
  });

  it('accepts only jobs of its repository, ref and environment while active', (): void => {
    const binding = createCiBinding(input, now, admin);
    const production = createCiBinding({ ...input, environment: 'production' }, now, admin);

    expect(acceptsJob(binding, job)).toBe(true);
    expect(acceptsJob(binding, { ...job, repositoryId: 4712 })).toBe(false);
    expect(acceptsJob(binding, { ...job, ref: 'refs/heads/feature' })).toBe(false);
    expect(acceptsJob(production, job)).toBe(false);
    expect(acceptsJob(production, { ...job, environment: 'production' })).toBe(true);
    expect(acceptsJob(revokeCiBinding(binding, now, admin), job)).toBe(false);
  });

  it('can be revoked once', (): void => {
    const revoked = revokeCiBinding(createCiBinding(input, now, admin), now, admin);

    expect(revoked).toMatchObject({ revokedAt: now, revokedBy: admin });
    expect((): CiBinding => revokeCiBinding(revoked, now, admin)).toThrow(errorCode('ci_binding_not_found'));
  });
});
