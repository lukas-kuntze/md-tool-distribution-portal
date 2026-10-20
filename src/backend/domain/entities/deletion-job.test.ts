import { describe, expect, it } from 'vitest';

import { parseId } from '../value-objects/identifier.js';
import {
  cancelDeletionJob,
  completePurge,
  completeQuarantine,
  completeRestore,
  createDeletionJob,
  expediteQuarantine,
  failAttempt,
  failRestore,
  isDue,
  MAX_ATTEMPTS,
  retryFailedJob,
  RETRY_DELAYS_MS,
  startPurge,
  startQuarantine,
  startRestore,
  type DeletionJob,
} from './deletion-job.js';

const start = new Date('2026-10-17T10:00:00Z');
const retention = 14 * 24 * 60 * 60_000;
const transient = { errorCode: 'file_locked', securityViolation: false };

const at = (offsetMs: number): Date => new Date(start.getTime() + offsetMs);
const errorCode = (code: string): unknown => expect.objectContaining({ code });

const request = {
  id: parseId<'DeletionJob'>('0192f3a4-0000-7000-8000-000000000200'),
  releaseId: parseId<'Release'>('0192f3a4-0000-7000-8000-000000000100'),
  requestedBy: parseId<'User'>('0192f3a4-0000-7000-8000-000000000001'),
  reason: 'Build crashes on start',
  artifactSnapshot: [],
};

function requested(): DeletionJob {
  return createDeletionJob(request, start);
}

function quarantined(): DeletionJob {
  return completeQuarantine(startQuarantine(requested()), start, retention);
}

describe('deletion job', (): void => {
  it('is due immediately after it was requested', (): void => {
    expect(requested()).toMatchObject({ state: 'requested', requestedAt: start, reason: 'Build crashes on start' });
    expect(isDue(requested(), start)).toBe(true);
  });

  it('requires a reason', (): void => {
    expect((): DeletionJob => createDeletionJob({ ...request, reason: ' ' }, start)).toThrow(
      errorCode('reason_required'),
    );
  });

  it('holds the release in quarantine until the retention period ends', (): void => {
    const job = quarantined();

    expect(job).toMatchObject({ state: 'quarantined', purgeAfter: at(retention), attempts: 0 });
    expect(isDue(job, at(retention - 1))).toBe(false);
    expect((): DeletionJob => startPurge(job, at(retention - 1))).toThrow(errorCode('purge_not_due'));
    expect(isDue(job, at(retention))).toBe(true);
  });

  it('completes only after the purge has run', (): void => {
    const job = completePurge(startPurge(quarantined(), at(retention)), at(retention));

    expect(job).toMatchObject({ state: 'completed', completedAt: at(retention) });
    expect(isDue(job, at(retention))).toBe(false);
  });

  it('ends the quarantine early when explicitly requested, leaving the purge to the worker', (): void => {
    const job = expediteQuarantine(quarantined(), at(60_000));

    expect(job).toMatchObject({ state: 'quarantined', purgeAfter: at(60_000), nextAttemptAt: at(60_000) });
    expect(isDue(job, at(60_000))).toBe(true);
    expect(startPurge(job, at(60_000)).state).toBe('purging');
    expect((): DeletionJob => expediteQuarantine(requested(), start)).toThrow(errorCode('invalid_deletion_job_state'));
  });

  it('restores from quarantine and keeps the job in quarantine when a restore fails', (): void => {
    expect(completeRestore(startRestore(quarantined()), start).state).toBe('restored');
    expect(failRestore(startRestore(quarantined()), 'target_exists')).toMatchObject({
      state: 'quarantined',
      lastErrorCode: 'target_exists',
      nextAttemptAt: at(retention),
    });
  });

  it('can be cancelled before the worker picked it up', (): void => {
    expect(cancelDeletionJob(requested(), start).state).toBe('cancelled');
    expect((): DeletionJob => cancelDeletionJob(startQuarantine(requested()), start)).toThrow(
      errorCode('invalid_deletion_job_state'),
    );
  });

  it('rejects transitions from the wrong state', (): void => {
    expect((): DeletionJob => startRestore(requested())).toThrow(errorCode('invalid_deletion_job_state'));
    expect((): DeletionJob => completePurge(quarantined(), start)).toThrow(errorCode('invalid_deletion_job_state'));
    expect((): DeletionJob => failAttempt(requested(), start, transient)).toThrow(
      errorCode('invalid_deletion_job_state'),
    );
  });
});

describe('failures', (): void => {
  it('retries a failed quarantine with increasing delays', (): void => {
    const job = failAttempt(startQuarantine(requested()), start, transient);

    expect(job).toMatchObject({ state: 'requested', attempts: 1, lastErrorCode: 'file_locked' });
    expect(job.nextAttemptAt).toEqual(at(RETRY_DELAYS_MS[0] ?? 0));
  });

  it('returns a failed purge to quarantine', (): void => {
    const job = failAttempt(startPurge(quarantined(), at(retention)), at(retention), transient);

    expect(job).toMatchObject({ state: 'quarantined', attempts: 1 });
  });

  it('fails the job after the last attempt and never reports it as completed', (): void => {
    let job = requested();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      job = failAttempt(startQuarantine({ ...job, state: 'requested' }), start, transient);
    }

    expect(job).toMatchObject({
      state: 'failed',
      attempts: MAX_ATTEMPTS,
      failedPhase: 'quarantine',
      requiresManualReview: false,
      completedAt: null,
    });
    expect(isDue(job, at(retention))).toBe(false);
  });

  it('stops at once on a safety violation and asks for a manual review', (): void => {
    const job = failAttempt(startQuarantine(requested()), start, {
      errorCode: 'reparse_point',
      securityViolation: true,
    });

    expect(job).toMatchObject({ state: 'failed', attempts: 1, requiresManualReview: true });
  });

  it('resumes the failed phase on manual retry', (): void => {
    const failedQuarantine = failAttempt(startQuarantine(requested()), start, {
      errorCode: 'reparse_point',
      securityViolation: true,
    });
    const failedPurge = failAttempt(startPurge(quarantined(), at(retention)), at(retention), {
      errorCode: 'unexpected_file',
      securityViolation: true,
    });

    expect(retryFailedJob(failedQuarantine, start)).toMatchObject({
      state: 'requested',
      attempts: 0,
      requiresManualReview: false,
      nextAttemptAt: start,
    });
    expect(retryFailedJob(failedPurge, start).state).toBe('quarantined');
    expect((): DeletionJob => retryFailedJob(requested(), start)).toThrow(errorCode('invalid_deletion_job_state'));
  });
});
