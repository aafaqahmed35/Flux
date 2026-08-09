import { JobStatus } from '../constants/job.constants.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { METRIC_NAMES } from '../observability/observability.constants.js';
import { prometheusRegistry } from '../observability/prometheus.js';
import { IQueueEngine } from '../queue/queue.interface.js';
import { redisQueue } from '../queue/redis.queue.js';
import { IJobRepository } from '../repositories/job.repository.interface.js';
import { jobRepository } from '../repositories/job.repository.js';
import { retryEngine as defaultRetryEngine, RetryEngine } from '../retry/retry.engine.js';
import { RECOVERY_DEFAULTS } from './recovery.constants.js';
import { RecoveryOptions, RecoveryResult } from './recovery.types.js';

export class RecoveryEngine {
  private readonly repository: IJobRepository;
  private readonly queueEngine: IQueueEngine;
  private readonly retryEngine: RetryEngine;
  private readonly options: Required<RecoveryOptions>;

  constructor(
    repository: IJobRepository = jobRepository,
    queueEngine: IQueueEngine = redisQueue,
    retryEngine: RetryEngine = defaultRetryEngine,
    options?: RecoveryOptions,
  ) {
    this.repository = repository;
    this.queueEngine = queueEngine;
    this.retryEngine = retryEngine;
    this.options = {
      leaseTimeoutMs: options?.leaseTimeoutMs ?? RECOVERY_DEFAULTS.leaseTimeoutMs,
      recoveryIntervalMs: options?.recoveryIntervalMs ?? RECOVERY_DEFAULTS.recoveryIntervalMs,
      batchSize: options?.batchSize ?? RECOVERY_DEFAULTS.batchSize,
      reconciliationIntervalMs:
        options?.reconciliationIntervalMs ?? RECOVERY_DEFAULTS.reconciliationIntervalMs,
      maxRecoveryAttempts: options?.maxRecoveryAttempts ?? RECOVERY_DEFAULTS.maxRecoveryAttempts,
    };
  }

  async runRecovery(): Promise<RecoveryResult> {
    const start = Date.now();
    prometheusRegistry.incrementCounter(METRIC_NAMES.RECOVERY_SCANS_TOTAL, 1);

    const result: RecoveryResult = {
      scannedCount: 0,
      recoveredCount: 0,
      failedCount: 0,
      skippedCount: 0,
      recoveredJobIds: [],
      failedJobIds: [],
      errors: [],
    };

    try {
      const pathA = await this.recoverStaleRunningJobs();
      const pathB = await this.recoverStaleClaimedJobs();
      const pathC = await this.recoverPendingJobs();
      const pathD = await this.recoverRetryingJobs();

      result.scannedCount = pathA.scanned + pathB.scanned + pathC.scanned + pathD.scanned;
      result.recoveredCount = pathA.recovered + pathB.recovered + pathC.recovered + pathD.recovered;
      result.failedCount = pathA.failed + pathB.failed + pathC.failed + pathD.failed;
      result.skippedCount = pathA.skipped + pathB.skipped + pathC.skipped + pathD.skipped;
      result.recoveredJobIds = [
        ...pathA.recoveredIds,
        ...pathB.recoveredIds,
        ...pathC.recoveredIds,
        ...pathD.recoveredIds,
      ];
      result.failedJobIds = [
        ...pathA.failedIds,
        ...pathB.failedIds,
        ...pathC.failedIds,
        ...pathD.failedIds,
      ];
      result.errors = [...pathA.errors, ...pathB.errors, ...pathC.errors, ...pathD.errors];

      const durationMs = Date.now() - start;
      prometheusRegistry.recordHistogram(METRIC_NAMES.RECOVERY_DURATION_MS, durationMs);
      prometheusRegistry.setGauge(METRIC_NAMES.JOBS_STALE_TOTAL, result.scannedCount);

      if (result.recoveredCount > 0) {
        prometheusRegistry.incrementCounter(
          METRIC_NAMES.JOBS_RECOVERED_TOTAL,
          result.recoveredCount,
        );
      }
      if (result.failedCount > 0) {
        prometheusRegistry.incrementCounter(
          METRIC_NAMES.JOBS_RECOVERY_FAILED_TOTAL,
          result.failedCount,
        );
      }

      appLogger.info('Recovery engine scan completed', {
        scannedCount: result.scannedCount,
        recoveredCount: result.recoveredCount,
        failedCount: result.failedCount,
        durationMs,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error('Error during recovery engine scan execution', { error: msg });
    }

    return result;
  }

  private async recoverStaleRunningJobs(): Promise<{
    scanned: number;
    recovered: number;
    failed: number;
    skipped: number;
    recoveredIds: string[];
    failedIds: string[];
    errors: Array<{ jobId: string; error: string }>;
  }> {
    const staleJobs = await this.repository.findStaleRunningJobs(
      this.options.leaseTimeoutMs,
      this.options.batchSize,
    );

    const res = {
      scanned: staleJobs.length,
      recovered: 0,
      failed: 0,
      skipped: 0,
      recoveredIds: [] as string[],
      failedIds: [] as string[],
      errors: [] as Array<{ jobId: string; error: string }>,
    };

    for (const job of staleJobs) {
      try {
        const canRetry = this.retryEngine
          ? job.retryCount < job.maxRetries
          : job.retryCount < job.maxRetries;
        const targetStatus = canRetry ? JobStatus.RETRYING : JobStatus.FAILED;

        const reason = canRetry
          ? 'Worker crash / Stale lease detected (retry scheduled)'
          : 'Worker crash / Stale lease detected (retries exhausted)';

        const recovered = await this.repository.recoverStaleJob(
          job.id,
          JobStatus.RUNNING,
          targetStatus,
          reason,
        );

        if (recovered) {
          res.recovered++;
          res.recoveredIds.push(job.id);
          appLogger.info('Stale RUNNING job recovered', {
            jobId: job.id,
            targetStatus,
            workerId: job.workerId,
          });
        } else {
          res.skipped++;
          prometheusRegistry.incrementCounter(METRIC_NAMES.RECOVERY_CONFLICTS_TOTAL, 1);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.failed++;
        res.failedIds.push(job.id);
        res.errors.push({ jobId: job.id, error: msg });
        errorLogger.error('Failed to recover stale RUNNING job', { jobId: job.id, error: msg });
      }
    }

    return res;
  }

  private async recoverStaleClaimedJobs(): Promise<{
    scanned: number;
    recovered: number;
    failed: number;
    skipped: number;
    recoveredIds: string[];
    failedIds: string[];
    errors: Array<{ jobId: string; error: string }>;
  }> {
    const claimedJobs = await this.repository.findClaimedJobs(
      this.options.leaseTimeoutMs,
      this.options.batchSize,
    );

    const res = {
      scanned: claimedJobs.length,
      recovered: 0,
      failed: 0,
      skipped: 0,
      recoveredIds: [] as string[],
      failedIds: [] as string[],
      errors: [] as Array<{ jobId: string; error: string }>,
    };

    for (const job of claimedJobs) {
      try {
        const recovered = await this.repository.recoverStaleJob(
          job.id,
          JobStatus.CLAIMED,
          JobStatus.QUEUED,
          'Stale claim recovery',
        );

        if (recovered) {
          await this.queueEngine.enqueue(job.queueName, job.id);
          res.recovered++;
          res.recoveredIds.push(job.id);
          appLogger.info('Stale CLAIMED job recovered and re-enqueued', { jobId: job.id });
        } else {
          res.skipped++;
          prometheusRegistry.incrementCounter(METRIC_NAMES.RECOVERY_CONFLICTS_TOTAL, 1);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.failed++;
        res.failedIds.push(job.id);
        res.errors.push({ jobId: job.id, error: msg });
        errorLogger.error('Failed to recover stale CLAIMED job', { jobId: job.id, error: msg });
      }
    }

    return res;
  }

  private async recoverPendingJobs(): Promise<{
    scanned: number;
    recovered: number;
    failed: number;
    skipped: number;
    recoveredIds: string[];
    failedIds: string[];
    errors: Array<{ jobId: string; error: string }>;
  }> {
    const pendingJobs = await this.repository.findRecoverablePendingJobs(
      this.options.leaseTimeoutMs,
      this.options.batchSize,
    );

    const res = {
      scanned: pendingJobs.length,
      recovered: 0,
      failed: 0,
      skipped: 0,
      recoveredIds: [] as string[],
      failedIds: [] as string[],
      errors: [] as Array<{ jobId: string; error: string }>,
    };

    for (const job of pendingJobs) {
      try {
        const recovered = await this.repository.recoverPendingJob(job.id);
        if (recovered) {
          await this.queueEngine.enqueue(job.queueName, job.id);
          res.recovered++;
          res.recoveredIds.push(job.id);
          appLogger.info('Stale PENDING job recovered and enqueued', { jobId: job.id });
        } else {
          res.skipped++;
          prometheusRegistry.incrementCounter(METRIC_NAMES.RECOVERY_CONFLICTS_TOTAL, 1);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.failed++;
        res.failedIds.push(job.id);
        res.errors.push({ jobId: job.id, error: msg });
        errorLogger.error('Failed to recover PENDING job', { jobId: job.id, error: msg });
      }
    }

    return res;
  }

  private async recoverRetryingJobs(): Promise<{
    scanned: number;
    recovered: number;
    failed: number;
    skipped: number;
    recoveredIds: string[];
    failedIds: string[];
    errors: Array<{ jobId: string; error: string }>;
  }> {
    const retryingJobs = await this.repository.findRetryingJobs(this.options.batchSize);

    const res = {
      scanned: retryingJobs.length,
      recovered: 0,
      failed: 0,
      skipped: 0,
      recoveredIds: [] as string[],
      failedIds: [] as string[],
      errors: [] as Array<{ jobId: string; error: string }>,
    };

    for (const job of retryingJobs) {
      try {
        const recovered = await this.repository.recoverStaleJob(
          job.id,
          JobStatus.RETRYING,
          JobStatus.QUEUED,
          'Retry delay matured',
        );

        if (recovered) {
          await this.queueEngine.enqueue(job.queueName, job.id);
          res.recovered++;
          res.recoveredIds.push(job.id);
          appLogger.info('Due RETRYING job recovered and enqueued', { jobId: job.id });
        } else {
          res.skipped++;
          prometheusRegistry.incrementCounter(METRIC_NAMES.RECOVERY_CONFLICTS_TOTAL, 1);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.failed++;
        res.failedIds.push(job.id);
        res.errors.push({ jobId: job.id, error: msg });
        errorLogger.error('Failed to recover RETRYING job', { jobId: job.id, error: msg });
      }
    }

    return res;
  }
}
