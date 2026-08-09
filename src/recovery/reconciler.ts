import { JobStatus } from '../constants/job.constants.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { METRIC_NAMES } from '../observability/observability.constants.js';
import { prometheusRegistry } from '../observability/prometheus.js';
import { IQueueEngine } from '../queue/queue.interface.js';
import { redisQueue } from '../queue/redis.queue.js';
import { IJobRepository } from '../repositories/job.repository.interface.js';
import { jobRepository } from '../repositories/job.repository.js';
import { ReconciliationResult } from './recovery.types.js';

export class QueueReconciler {
  private readonly repository: IJobRepository;
  private readonly queueEngine: IQueueEngine;

  constructor(repository: IJobRepository = jobRepository, queueEngine: IQueueEngine = redisQueue) {
    this.repository = repository;
    this.queueEngine = queueEngine;
  }

  async runReconciliation(): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      scannedCount: 0,
      reenqueuedCount: 0,
      staleRedisRemovedCount: 0,
      orphansRemovedCount: 0,
      reconciledJobIds: [],
      errors: [],
    };

    try {
      // 1. Re-enqueue PostgreSQL QUEUED jobs missing from Redis
      const missingEnqueued = await this.reconcileMissingQueuedJobs();
      result.reenqueuedCount += missingEnqueued.count;
      result.reconciledJobIds.push(...missingEnqueued.jobIds);
      result.errors.push(...missingEnqueued.errors);

      // 2. Remove stale Redis entries for finished/failed jobs
      const staleRemoved = await this.reconcileStaleRedisJobs();
      result.staleRedisRemovedCount += staleRemoved.count;
      result.reconciledJobIds.push(...staleRemoved.jobIds);
      result.errors.push(...staleRemoved.errors);

      // 3. Remove orphan Redis job IDs with no PostgreSQL row
      const orphansRemoved = await this.reconcileOrphanRedisJobs();
      result.orphansRemovedCount += orphansRemoved.count;
      result.reconciledJobIds.push(...orphansRemoved.jobIds);
      result.errors.push(...orphansRemoved.errors);

      // 4. Reconcile DLQ Redis cache against PostgreSQL
      await this.reconcileDeadLetterQueue();

      result.scannedCount = missingEnqueued.scanned + staleRemoved.scanned + orphansRemoved.scanned;

      if (result.reenqueuedCount > 0 || result.staleRedisRemovedCount > 0) {
        prometheusRegistry.incrementCounter(
          METRIC_NAMES.JOBS_RECONCILED_TOTAL,
          result.reenqueuedCount + result.staleRedisRemovedCount,
        );
      }

      if (result.orphansRemovedCount > 0) {
        prometheusRegistry.incrementCounter(
          METRIC_NAMES.REDIS_ORPHANS_REMOVED_TOTAL,
          result.orphansRemovedCount,
        );
      }

      appLogger.info('Queue reconciliation completed', {
        scannedCount: result.scannedCount,
        reenqueuedCount: result.reenqueuedCount,
        staleRedisRemovedCount: result.staleRedisRemovedCount,
        orphansRemovedCount: result.orphansRemovedCount,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error('Error during queue reconciliation', { error: msg });
    }

    return result;
  }

  private async reconcileMissingQueuedJobs(): Promise<{
    scanned: number;
    count: number;
    jobIds: string[];
    errors: Array<{ key: string; error: string }>;
  }> {
    const queuedJobs = await this.repository.findByStatus(JobStatus.QUEUED, { limit: 500 });
    let reenqueuedCount = 0;
    const jobIds: string[] = [];
    const errors: Array<{ key: string; error: string }> = [];

    for (const job of queuedJobs) {
      try {
        const existsInRedis = await this.queueEngine.containsJob(job.queueName, job.id);
        if (!existsInRedis) {
          await this.queueEngine.enqueue(job.queueName, job.id);
          reenqueuedCount++;
          jobIds.push(job.id);
          appLogger.info('Re-enqueued missing QUEUED job to Redis', {
            jobId: job.id,
            queueName: job.queueName,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ key: job.id, error: msg });
      }
    }

    return { scanned: queuedJobs.length, count: reenqueuedCount, jobIds, errors };
  }

  private async reconcileStaleRedisJobs(): Promise<{
    scanned: number;
    count: number;
    jobIds: string[];
    errors: Array<{ key: string; error: string }>;
  }> {
    const queues = await this.queueEngine.listQueues();
    let removedCount = 0;
    let scanned = 0;
    const jobIds: string[] = [];
    const errors: Array<{ key: string; error: string }> = [];

    for (const queueName of queues) {
      try {
        const processingIds = await this.queueEngine.listProcessingJobs(queueName);
        scanned += processingIds.length;

        for (const jobId of processingIds) {
          const dbJob = await this.repository.findById(jobId);
          if (dbJob && dbJob.status !== JobStatus.RUNNING && dbJob.status !== JobStatus.CLAIMED) {
            const removed = await this.queueEngine.removeProcessingJob(queueName, jobId);
            if (removed) {
              removedCount++;
              jobIds.push(jobId);
              appLogger.info('Removed stale processing entry from Redis', {
                jobId,
                queueName,
                dbStatus: dbJob.status,
              });
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ key: queueName, error: msg });
      }
    }

    return { scanned, count: removedCount, jobIds, errors };
  }

  private async reconcileOrphanRedisJobs(): Promise<{
    scanned: number;
    count: number;
    jobIds: string[];
    errors: Array<{ key: string; error: string }>;
  }> {
    const queues = await this.queueEngine.listQueues();
    let orphanCount = 0;
    let scanned = 0;
    const jobIds: string[] = [];
    const errors: Array<{ key: string; error: string }> = [];

    for (const queueName of queues) {
      try {
        const redisJobIds = await this.queueEngine.listAllQueueJobIds(queueName);
        scanned += redisJobIds.length;

        for (const jobId of redisJobIds) {
          const dbJob = await this.repository.findById(jobId);
          if (!dbJob || dbJob.isDeleted) {
            const removed = await this.queueEngine.removeOrphanJob(queueName, jobId);
            if (removed) {
              orphanCount++;
              jobIds.push(jobId);
              appLogger.info('Removed orphan job ID from Redis', { jobId, queueName });
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ key: queueName, error: msg });
      }
    }

    return { scanned, count: orphanCount, jobIds, errors };
  }

  private async reconcileDeadLetterQueue(): Promise<void> {
    try {
      const redisDlqIds = await this.queueEngine.getDeadLetterJobIds(500);
      for (const jobId of redisDlqIds) {
        const dbJob = await this.repository.findById(jobId);
        if (
          !dbJob ||
          (dbJob.status !== JobStatus.DEAD_LETTER && dbJob.status !== JobStatus.FAILED)
        ) {
          await this.queueEngine.removeFromDeadLetter(jobId);
          appLogger.info('Removed invalid deadletter entry from Redis DLQ cache', { jobId });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error('Error reconciling Redis DLQ cache', { error: msg });
    }
  }
}
