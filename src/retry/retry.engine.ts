/* eslint-disable @typescript-eslint/require-await */
import { JobStatus } from '../constants/job.constants.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { redisQueue } from '../queue/redis.queue.js';
import { jobRepository } from '../repositories/job.repository.js';
import { Job } from '../types/job.types.js';
import { RETRY_DEFAULTS, RetryStrategy } from './retry.constants.js';
import { IRetryEngine } from './retry.interface.js';
import { RetryDecision, RetryMetricsResponse, RetryPolicy } from './retry.types.js';

import { prometheusRegistry } from '../observability/prometheus.js';
import { tracingHelper } from '../observability/tracing.js';
import { METRIC_NAMES } from '../observability/observability.constants.js';

export class RetryEngine implements IRetryEngine {
  private retryAttemptsTotal = 0;
  private retryFailureTotal = 0;
  private deadLetterTotal = 0;
  private totalDelayMs = 0;

  async shouldRetry(
    job: Job,
    error?: Error,
    policyOverrides?: Partial<RetryPolicy>,
  ): Promise<boolean> {
    const maxRetries = policyOverrides?.maxRetries ?? job.maxRetries ?? RETRY_DEFAULTS.maxRetries;

    if (job.retryCount >= maxRetries) {
      return false;
    }

    if (error) {
      const errName = error.name || error.constructor.name;
      const doNotRetryList = policyOverrides?.doNotRetryOn ?? [
        'ValidationError',
        'BadRequestError',
        'InvalidJobStateError',
        'SyntaxError',
        'TypeError',
      ];

      if (doNotRetryList.includes(errName)) {
        appLogger.info('Job error matched doNotRetryOn list, marking non-retryable', {
          jobId: job.id,
          errorName: errName,
        });
        return false;
      }

      if (policyOverrides?.retryOn && policyOverrides.retryOn.length > 0) {
        if (!policyOverrides.retryOn.includes(errName)) {
          return false;
        }
      }
    }

    return true;
  }

  calculateDelay(job: Job, policyOverrides?: Partial<RetryPolicy>): number {
    const strategy =
      policyOverrides?.strategy || job.retryStrategy || RETRY_DEFAULTS.defaultStrategy;
    const baseDelay = policyOverrides?.retryDelay || job.retryDelay || RETRY_DEFAULTS.retryDelay;
    const maxDelayMs = policyOverrides?.maxDelayMs || RETRY_DEFAULTS.maxDelayMs;
    const attempt = job.retryCount + 1;

    let computedDelay = baseDelay;

    switch (strategy) {
      case RetryStrategy.FIXED:
        computedDelay = baseDelay;
        break;
      case RetryStrategy.LINEAR:
        computedDelay = baseDelay * attempt;
        break;
      case RetryStrategy.EXPONENTIAL:
        computedDelay = baseDelay * Math.pow(2, attempt - 1);
        break;
      case RetryStrategy.EXPONENTIAL_WITH_JITTER:
      default: {
        const expDelay = Math.min(maxDelayMs, baseDelay * Math.pow(2, attempt - 1));
        const jitterPercent = policyOverrides?.jitterPercent ?? RETRY_DEFAULTS.jitterPercent;
        const jitterMultiplier = 1 - jitterPercent + Math.random() * (jitterPercent * 2);
        computedDelay = Math.floor(expDelay * jitterMultiplier);
        break;
      }
    }

    return Math.min(maxDelayMs, Math.max(100, computedDelay));
  }

  async scheduleRetry(
    job: Job,
    error: Error,
    policyOverrides?: Partial<RetryPolicy>,
  ): Promise<RetryDecision> {
    const isEligible = await this.shouldRetry(job, error, policyOverrides);

    if (!isEligible) {
      appLogger.info('Job exhausted retries or failed non-retryable error. Moving to DLQ', {
        jobId: job.id,
        retryCount: job.retryCount,
        maxRetries: job.maxRetries,
        error: error.message,
      });
      await this.moveToDeadLetter(job, error);
      return {
        shouldRetry: false,
        delayMs: 0,
        isDeadLetter: true,
        reason: error.message,
      };
    }

    const delayMs = this.calculateDelay(job, policyOverrides);
    const nextRetryAt = new Date(Date.now() + delayMs);
    const attempt = job.retryCount + 1;
    const strategy = job.retryStrategy || RetryStrategy.EXPONENTIAL_WITH_JITTER;

    this.retryAttemptsTotal++;
    this.totalDelayMs += delayMs;

    const span = tracingHelper.startSpan('flux.job.retry', {
      'job.id': job.id,
      'job.queue': job.queueName,
      'job.attempt': attempt,
      'retry.delay_ms': delayMs,
      'retry.strategy': strategy,
    });

    prometheusRegistry.incrementCounter(METRIC_NAMES.JOBS_RETRIED_TOTAL, 1, {
      queue: job.queueName,
      strategy,
    });
    prometheusRegistry.recordHistogram(METRIC_NAMES.JOB_RETRY_DELAY_MS, delayMs, {
      queue: job.queueName,
      strategy,
    });

    try {
      // 1. Record relational history entry
      await jobRepository.addRetryHistoryRecord({
        jobId: job.id,
        attempt,
        strategy,
        delayMs,
        scheduledAt: nextRetryAt,
        startedAt: job.startedAt,
        failedAt: new Date(),
        failureReason: error.message,
        failureCode: error.name,
        workerId: job.workerId,
      });

      // 2. Update PostgreSQL job status to RETRYING
      await jobRepository.updateRetry(job.id, {
        retryCount: attempt,
        nextRetryAt,
        status: JobStatus.RETRYING,
        lastRetryAt: new Date(),
        errorMessage: error.message,
        errorStack: error.stack,
        failureReason: 'PROCESSOR_EXECUTION_ERROR',
        lastFailureType: error.name,
      });

      // 3. Add to Redis scheduled ZSET
      await redisQueue.scheduleJob(job.id, nextRetryAt.getTime());

      // 4. Acknowledge and remove from active processing queue in Redis
      await redisQueue.ackJob(job.queueName, job.id);

      tracingHelper.endSpan(span, 'OK');

      appLogger.info('Job successfully scheduled for retry', {
        jobId: job.id,
        attempt,
        delayMs,
        nextRetryAt: nextRetryAt.toISOString(),
      });

      return {
        shouldRetry: true,
        delayMs,
        nextRetryAt,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      tracingHelper.recordException(span, msg);
      tracingHelper.endSpan(span, 'ERROR', msg);
      errorLogger.error('Failed to schedule job retry', { jobId: job.id, error: msg });
      throw err;
    }
  }

  async moveToDeadLetter(job: Job, error: Error): Promise<Job> {
    const attempt = job.retryCount + 1;
    this.deadLetterTotal++;
    this.retryFailureTotal++;

    const span = tracingHelper.startSpan('flux.job.dead_letter', {
      'job.id': job.id,
      'job.queue': job.queueName,
      'job.attempt': attempt,
      'error.message': error.message,
    });

    prometheusRegistry.incrementCounter(METRIC_NAMES.JOBS_DEAD_LETTERED_TOTAL, 1, {
      queue: job.queueName,
    });

    // 1. Record history entry
    await jobRepository.addRetryHistoryRecord({
      jobId: job.id,
      attempt,
      strategy: job.retryStrategy || RetryStrategy.EXPONENTIAL_WITH_JITTER,
      delayMs: 0,
      startedAt: job.startedAt,
      failedAt: new Date(),
      failureReason: error.message,
      failureCode: 'DEAD_LETTER',
      workerId: job.workerId,
    });

    // 2. Update PostgreSQL job state to DEAD_LETTER
    const deadLetterJob = await jobRepository.updateRetry(job.id, {
      retryCount: attempt,
      status: JobStatus.DEAD_LETTER,
      deadLetteredAt: new Date(),
      deadLetterReason: error.message,
      errorMessage: error.message,
      errorStack: error.stack,
      failureReason: 'MAX_RETRIES_EXCEEDED',
    });

    // 3. Push to Redis deadletter cache list
    await redisQueue.pushToDeadLetter(job.id);

    // 4. Ack job in processing list
    await redisQueue.ackJob(job.queueName, job.id);

    tracingHelper.endSpan(span, 'OK');

    appLogger.info('Job moved to Dead Letter Queue (DLQ)', {
      jobId: job.id,
      queueName: job.queueName,
      reason: error.message,
    });

    return deadLetterJob;
  }

  async recoverPendingRetries(): Promise<number> {
    const dueJobs = await jobRepository.findDueRetries(100);
    let recoveredCount = 0;

    for (const job of dueJobs) {
      const isEnqueued = await redisQueue.exists(job.queueName, job.id);
      if (!isEnqueued) {
        await redisQueue.enqueue(job.queueName, job.id);
        await jobRepository.updateStatus(job.id, JobStatus.QUEUED);
        recoveredCount++;
        appLogger.info('Recovered pending due retry into Redis queue', {
          jobId: job.id,
          queueName: job.queueName,
        });
      }
    }

    return recoveredCount;
  }

  async getMetrics(): Promise<RetryMetricsResponse> {
    const scheduled = await redisQueue.getMetrics();
    const retrying = await jobRepository.count({ status: JobStatus.RETRYING });
    const deadletter = await jobRepository.count({ status: JobStatus.DEAD_LETTER });
    const completed = await jobRepository.count({ status: JobStatus.COMPLETED });

    const totalProcessed = completed + deadletter;
    const successRate = totalProcessed > 0 ? (completed / totalProcessed) * 100 : 100;
    const averageDelayMs =
      this.retryAttemptsTotal > 0 ? Math.round(this.totalDelayMs / this.retryAttemptsTotal) : 0;

    return {
      scheduled: scheduled.scheduled,
      retrying,
      exhausted: deadletter,
      deadletter,
      averageDelayMs,
      successRate: Math.round(successRate * 100) / 100,
    };
  }
}

export const retryEngine = new RetryEngine();
