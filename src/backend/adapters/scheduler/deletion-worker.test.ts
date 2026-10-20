import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DeletionWorkerDependencies } from '../../application/process-next-deletion-job.js';
import {
  createDeletionScenario,
  RETENTION_MS,
  type DeletionScenario,
} from '../../application/testing/deletion-scenario.js';
import { submitReleaseDeletion } from '../../application/submit-release-deletion.js';
import type { Logger } from '../../domain/ports/logger.js';
import { runDeletionWorker } from './deletion-worker.js';

describe('runDeletionWorker', (): void => {
  let scenario: DeletionScenario;

  beforeEach(async (): Promise<void> => {
    scenario = await createDeletionScenario();
  });

  afterEach(async (): Promise<void> => {
    await scenario.cleanup();
  });

  function recordingLogger(): { logger: Logger; lines: string[] } {
    const lines: string[] = [];
    const record =
      (level: string) =>
      (message: string, context?: Readonly<Record<string, unknown>>): void => {
        const outcome = context?.['outcome'];
        lines.push(`${level}:${message}:${typeof outcome === 'string' ? outcome : ''}`);
      };

    return { logger: { info: record('info'), warn: record('warn'), error: record('error') }, lines };
  }

  function dependencies(overrides: Partial<DeletionWorkerDependencies> = {}): DeletionWorkerDependencies {
    return {
      unitOfWork: scenario.test.unitOfWork,
      storage: scenario.storage,
      clock: scenario.clock,
      workerId: 'worker-1',
      leaseMs: 60_000,
      quarantineRetentionMs: RETENTION_MS,
      ...overrides,
    };
  }

  it('processes due jobs, then waits until it is stopped', async (): Promise<void> => {
    submitReleaseDeletion(
      { unitOfWork: scenario.test.unitOfWork, clock: scenario.clock, ids: scenario.ids },
      {
        actor: scenario.actor,
        request: scenario.request,
        releaseId: scenario.release.id,
        expectedRowVersion: 1,
        confirmation: scenario.confirmation,
        reason: 'Absturz',
      },
    );
    const { logger, lines } = recordingLogger();
    const stop = new AbortController();
    const running = runDeletionWorker(dependencies(), { pollMs: 5, signal: stop.signal, logger });

    await vitestWaitFor(() => lines.some((line) => line.includes('quarantined')));
    stop.abort();
    await running;

    expect(lines).toEqual([
      'info:deletion worker started:',
      'info:deletion step:quarantined',
      'info:deletion worker stopped:',
    ]);
  });

  it('logs a crashing step as an error and keeps running', async (): Promise<void> => {
    const { logger, lines } = recordingLogger();
    const stop = new AbortController();
    const broken = dependencies({
      unitOfWork: {
        transaction: (): never => {
          throw new Error('database unavailable');
        },
        read: (): never => {
          throw new Error('database unavailable');
        },
      },
    });
    const running = runDeletionWorker(broken, { pollMs: 5, signal: stop.signal, logger });

    await vitestWaitFor(() => lines.filter((line) => line.startsWith('error:deletion step crashed')).length >= 2);
    stop.abort();
    await running;

    expect(lines.at(-1)).toBe('info:deletion worker stopped:');
  });
});

async function vitestWaitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  expect(condition()).toBe(true);
}
