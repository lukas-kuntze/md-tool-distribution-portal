import { setTimeout as delay } from 'node:timers/promises';

import {
  processNextDeletionJob,
  type DeletionWorkerDependencies,
} from '../../application/process-next-deletion-job.js';
import { isReconciliationDue, reconcileStorage } from '../../application/reconcile-storage.js';
import type { IdGenerator } from '../../domain/ports/id-generator.js';
import type { Logger } from '../../domain/ports/logger.js';

export interface WorkerLoopOptions {
  readonly pollMs: number;
  readonly signal: AbortSignal;
  readonly logger: Logger;
  /** Runs the storage reconciliation whenever the last report is older than `intervalMs`; off when absent. */
  readonly reconciliation?: { readonly intervalMs: number; readonly ids: IdGenerator };
}

/**
 * Drives the deletion workflow: processes due jobs one after another and sleeps when none is due. A crash
 * in one step is logged and the loop carries on; the job's lease runs out and it is picked up again. Between
 * jobs it also runs the daily storage reconciliation.
 */
export async function runDeletionWorker(
  dependencies: DeletionWorkerDependencies,
  options: WorkerLoopOptions,
): Promise<void> {
  const { pollMs, signal, logger } = options;

  logger.info('deletion worker started', { workerId: dependencies.workerId, pollMs });

  while (!signal.aborted) {
    try {
      const result = await processNextDeletionJob(dependencies);

      if (result !== null) {
        // A failed job needs a human: it is logged as an error so that monitoring raises an alert.
        const log = result.outcome === 'failed' ? logger.error.bind(logger) : logger.info.bind(logger);
        log('deletion step', { deletionJobId: result.jobId, outcome: result.outcome });
        continue;
      }

      await reconcileWhenDue(dependencies, options);
    } catch (error) {
      logger.error('deletion step crashed', {
        error: error instanceof Error ? error.name : 'unknown',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    await delay(pollMs, undefined, { signal }).catch(() => undefined);
  }

  logger.info('deletion worker stopped', { workerId: dependencies.workerId });
}

async function reconcileWhenDue(dependencies: DeletionWorkerDependencies, options: WorkerLoopOptions): Promise<void> {
  const { reconciliation, logger } = options;

  if (
    reconciliation === undefined ||
    !dependencies.unitOfWork.read((repositories) =>
      isReconciliationDue(repositories, dependencies.clock.now(), reconciliation.intervalMs),
    )
  ) {
    return;
  }

  const report = await reconcileStorage({ ...dependencies, ids: reconciliation.ids }, { type: 'schedule' });
  // Missing files mean lost builds: logged as an error so that monitoring raises an alert.
  const log = report.missing.length > 0 ? logger.error.bind(logger) : logger.info.bind(logger);
  log('storage reconciled', {
    storageReportId: report.id,
    filesChecked: report.filesChecked,
    missing: report.missing.length,
    recovered: report.recovered.length,
    orphaned: report.orphaned.length,
  });
}
