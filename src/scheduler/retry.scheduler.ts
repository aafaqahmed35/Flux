import { JobStatus } from '../constants/job.constants.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { redisQueue } from '../queue/redis.queue.js';
import { jobRepository } from '../repositories/job.repository.js';

export interface RetrySchedulerOptions {
  intervalMs?: number;
  batchSize?: number;
}

export class RetryScheduler {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(options: RetrySchedulerOptions = {}) {
    this.intervalMs = options.intervalMs ?? 1000;
    this.batchSize = options.batchSize ?? 100;
  }

  start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    appLogger.info('Retry Scheduler started', { intervalMs: this.intervalMs });
    this.scheduleNextTick(0);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    appLogger.info('Retry Scheduler stopped');
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.isRunning) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.tick().finally(() => {
        if (this.isRunning) {
          this.scheduleNextTick(this.intervalMs);
        }
      });
    }, delayMs);
  }

  async tick(): Promise<number> {
    try {
      // 1. Query PostgreSQL for due retries
      const dueJobs = await jobRepository.findDueRetries(this.batchSize);
      if (dueJobs.length === 0) {
        return 0;
      }

      appLogger.info('Retry Scheduler found due retries in PostgreSQL', { count: dueJobs.length });

      let promotedCount = 0;
      for (const job of dueJobs) {
        try {
          // Push job into Redis active queue
          await redisQueue.enqueue(job.queueName, job.id);

          // Update status in PostgreSQL: RETRYING -> QUEUED
          await jobRepository.updateStatus(job.id, JobStatus.QUEUED);

          // Clean up Redis scheduled ZSET if present
          await redisQueue.removeScheduledJob(job.id);

          promotedCount++;
          appLogger.info('Retry promoted to active queue', {
            jobId: job.id,
            queueName: job.queueName,
            retryCount: job.retryCount,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errorLogger.error('Failed to promote due retry', { jobId: job.id, error: msg });
        }
      }

      return promotedCount;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error('Error during Retry Scheduler tick', { error: msg });
      return 0;
    }
  }
}

export const retryScheduler = new RetryScheduler();
