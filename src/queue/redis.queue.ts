import { Redis } from 'ioredis';
import { JobStatus } from '../constants/job.constants.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { redisClient as defaultRedisClient } from '../redis/redis.js';
import { jobRepository } from '../repositories/job.repository.js';
import { QUEUE_DEFAULTS } from './queue.constants.js';
import { EnqueueFailedError, QueueUnavailableError } from './queue.errors.js';
import { IQueueEngine } from './queue.interface.js';
import { QueueKeyFactory } from './queue.key.js';
import { EnqueueResult, QueueMetrics } from './queue.types.js';

import { prometheusRegistry } from '../observability/prometheus.js';
import { METRIC_NAMES } from '../observability/observability.constants.js';

export class RedisQueue implements IQueueEngine {
  private readonly client: Redis;

  constructor(client: Redis = defaultRedisClient) {
    this.client = client;
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.status !== 'ready' && this.client.status !== 'connecting') {
      try {
        await this.client.connect();
      } catch {
        throw new QueueUnavailableError('Redis client is not connected to server');
      }
    }
  }

  async enqueue(queueName: string, jobId: string): Promise<EnqueueResult> {
    await this.ensureConnected();

    const queueKey = QueueKeyFactory.queue(queueName);
    const setKey = QueueKeyFactory.queuesSet();

    const start = Date.now();
    try {
      appLogger.debug('Enqueue Start', { jobId, queueName, queueKey });

      const pipeline = this.client.pipeline();
      pipeline.rpush(queueKey, jobId);
      pipeline.sadd(setKey, queueName);
      await pipeline.exec();

      const rtt = Date.now() - start;
      appLogger.debug('Enqueue Success', { jobId, queueName, rttMs: rtt });

      prometheusRegistry.incrementCounter(METRIC_NAMES.QUEUE_ENQUEUED_TOTAL, 1, {
        queue: queueName,
      });

      return {
        jobId,
        queueName,
        enqueuedAt: new Date(),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error('Enqueue Failure', { jobId, queueName, error: msg });
      throw new EnqueueFailedError(
        `Failed to push job '${jobId}' into Redis queue '${queueName}': ${msg}`,
      );
    }
  }

  async enqueueMany(queueName: string, jobIds: string[]): Promise<EnqueueResult[]> {
    if (jobIds.length === 0) {
      return [];
    }

    await this.ensureConnected();

    const queueKey = QueueKeyFactory.queue(queueName);
    const setKey = QueueKeyFactory.queuesSet();

    const start = Date.now();
    try {
      appLogger.debug('Batch Enqueue Start', { count: jobIds.length, queueName });

      const pipeline = this.client.pipeline();
      jobIds.forEach((jobId) => {
        pipeline.rpush(queueKey, jobId);
      });
      pipeline.sadd(setKey, queueName);
      await pipeline.exec();

      const rtt = Date.now() - start;
      appLogger.debug('Batch Enqueue Success', { count: jobIds.length, queueName, rttMs: rtt });

      prometheusRegistry.incrementCounter(METRIC_NAMES.QUEUE_ENQUEUED_TOTAL, jobIds.length, {
        queue: queueName,
      });

      const now = new Date();
      return jobIds.map((jobId) => ({
        jobId,
        queueName,
        enqueuedAt: now,
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error('Batch Enqueue Failure', { count: jobIds.length, queueName, error: msg });
      throw new EnqueueFailedError(`Failed batch enqueue for queue '${queueName}': ${msg}`);
    }
  }

  async claimJob(queueName: string, timeoutSeconds = 0): Promise<string | null> {
    await this.ensureConnected();

    const sourceKey = QueueKeyFactory.queue(queueName);
    const destKey = QueueKeyFactory.processing(queueName);

    try {
      let jobId: string | null = null;
      if (timeoutSeconds > 0) {
        jobId = await this.client.blmove(sourceKey, destKey, 'RIGHT', 'LEFT', timeoutSeconds);
      } else {
        jobId = await this.client.lmove(sourceKey, destKey, 'RIGHT', 'LEFT');
      }

      if (jobId) {
        prometheusRegistry.incrementCounter(METRIC_NAMES.QUEUE_CLAIMED_TOTAL, 1, {
          queue: queueName,
        });
        appLogger.debug('Job Claimed from Redis', { jobId, queueName, sourceKey, destKey });
      }

      return jobId;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error('Job Claim Error in Redis', { queueName, error: msg });
      return null;
    }
  }

  async ackJob(queueName: string, jobId: string): Promise<void> {
    await this.ensureConnected();
    const destKey = QueueKeyFactory.processing(queueName);
    await this.client.lrem(destKey, 0, jobId);
    prometheusRegistry.incrementCounter(METRIC_NAMES.QUEUE_ACKNOWLEDGED_TOTAL, 1, {
      queue: queueName,
    });
    appLogger.debug('Job Acknowledged & Removed from Processing', { jobId, queueName, destKey });
  }

  async queueLength(queueName: string): Promise<number> {
    await this.ensureConnected();
    const queueKey = QueueKeyFactory.queue(queueName);
    const length = await this.client.llen(queueKey);
    appLogger.debug('Queue Length Requested', { queueName, length });
    return length;
  }

  async peek(queueName: string, count = 1): Promise<string[]> {
    return this.peekMany(queueName, count);
  }

  async peekMany(queueName: string, count = QUEUE_DEFAULTS.maxPeekCount): Promise<string[]> {
    await this.ensureConnected();
    const limit = Math.min(count, QUEUE_DEFAULTS.maxPeekCount);
    const queueKey = QueueKeyFactory.queue(queueName);
    return this.client.lrange(queueKey, 0, limit - 1);
  }

  async exists(queueName: string, jobId: string): Promise<boolean> {
    const items = await this.peekMany(queueName, 1000);
    return items.includes(jobId);
  }

  async remove(queueName: string, jobId: string): Promise<boolean> {
    await this.ensureConnected();
    const queueKey = QueueKeyFactory.queue(queueName);
    const removedCount = await this.client.lrem(queueKey, 0, jobId);
    const removed = removedCount > 0;
    if (removed) {
      appLogger.info('Job removed from Redis queue', { jobId, queueName });
    }
    return removed;
  }

  async clear(queueName: string): Promise<void> {
    await this.ensureConnected();
    const queueKey = QueueKeyFactory.queue(queueName);
    const setKey = QueueKeyFactory.queuesSet();

    const pipeline = this.client.pipeline();
    pipeline.del(queueKey);
    pipeline.srem(setKey, queueName);
    await pipeline.exec();

    appLogger.info('Queue Cleared', { queueName });
  }

  async listQueues(): Promise<string[]> {
    await this.ensureConnected();
    const setKey = QueueKeyFactory.queuesSet();
    return this.client.smembers(setKey);
  }

  async scheduleJob(jobId: string, executeAtMs: number): Promise<void> {
    await this.ensureConnected();
    const scheduledKey = QueueKeyFactory.scheduled();
    await this.client.zadd(scheduledKey, executeAtMs, jobId);
    appLogger.info('Job scheduled in Redis ZSET', { jobId, executeAtMs });
  }

  async getDueScheduledJobs(maxTimestampMs: number, limit = 100): Promise<string[]> {
    await this.ensureConnected();
    const scheduledKey = QueueKeyFactory.scheduled();
    return this.client.zrangebyscore(scheduledKey, 0, maxTimestampMs, 'LIMIT', 0, limit);
  }

  async removeScheduledJob(jobId: string): Promise<boolean> {
    await this.ensureConnected();
    const scheduledKey = QueueKeyFactory.scheduled();
    const count = await this.client.zrem(scheduledKey, jobId);
    return count > 0;
  }

  async pushToDeadLetter(jobId: string): Promise<void> {
    await this.ensureConnected();
    const dlqKey = QueueKeyFactory.deadLetter();
    await this.client.rpush(dlqKey, jobId);
    appLogger.info('Job ID pushed to Redis deadletter cache', { jobId });
  }

  async removeFromDeadLetter(jobId: string): Promise<boolean> {
    await this.ensureConnected();
    const dlqKey = QueueKeyFactory.deadLetter();
    const removed = await this.client.lrem(dlqKey, 0, jobId);
    return removed > 0;
  }

  async getDeadLetterJobIds(limit = 100, offset = 0): Promise<string[]> {
    await this.ensureConnected();
    const dlqKey = QueueKeyFactory.deadLetter();
    return this.client.lrange(dlqKey, offset, offset + limit - 1);
  }

  async getMetrics(targetQueueName?: string): Promise<QueueMetrics> {
    await this.ensureConnected();

    const pendingCount = await jobRepository.count({
      status: JobStatus.PENDING,
      queueName: targetQueueName,
    });

    let queuedCount = 0;
    if (targetQueueName) {
      queuedCount = await this.queueLength(targetQueueName);
    } else {
      const activeQueues = await this.listQueues();
      for (const q of activeQueues) {
        queuedCount += await this.client.llen(QueueKeyFactory.queue(q));
      }
    }

    let processingCount = 0;
    if (targetQueueName) {
      processingCount = await this.client.llen(QueueKeyFactory.processing(targetQueueName));
    } else {
      const activeQueues = await this.listQueues();
      for (const q of activeQueues) {
        processingCount += await this.client.llen(QueueKeyFactory.processing(q));
      }
    }

    const scheduledCount = await this.client.zcard(QueueKeyFactory.scheduled());
    const deadletterCount = await jobRepository.count({ status: JobStatus.DEAD_LETTER });
    const activeWorkers = await this.client.hlen(QueueKeyFactory.workers());

    const labels: Record<string, string> = targetQueueName ? { queue: targetQueueName } : {};
    prometheusRegistry.setGauge(METRIC_NAMES.QUEUE_DEPTH, queuedCount, labels);
    prometheusRegistry.setGauge(METRIC_NAMES.QUEUE_PROCESSING, processingCount, labels);
    prometheusRegistry.setGauge(METRIC_NAMES.QUEUE_SCHEDULED, scheduledCount);
    prometheusRegistry.setGauge(METRIC_NAMES.QUEUE_DEADLETTER, deadletterCount);

    return {
      pending: pendingCount,
      queued: queuedCount,
      processing: processingCount,
      scheduled: scheduledCount,
      deadletter: deadletterCount,
      activeWorkers,
    };
  }

  // Reconciliation & Recovery primitives
  async containsJob(queueName: string, jobId: string): Promise<boolean> {
    await this.ensureConnected();
    const queued = await this.listQueuedJobs(queueName);
    if (queued.includes(jobId)) return true;
    const processing = await this.listProcessingJobs(queueName);
    return processing.includes(jobId);
  }

  async listProcessingJobs(queueName: string): Promise<string[]> {
    await this.ensureConnected();
    const processingKey = QueueKeyFactory.processing(queueName);
    return this.client.lrange(processingKey, 0, -1);
  }

  async listQueuedJobs(queueName: string): Promise<string[]> {
    await this.ensureConnected();
    const queueKey = QueueKeyFactory.queue(queueName);
    return this.client.lrange(queueKey, 0, -1);
  }

  async listAllQueueJobIds(queueName: string): Promise<string[]> {
    await this.ensureConnected();
    const [queued, processing] = await Promise.all([
      this.listQueuedJobs(queueName),
      this.listProcessingJobs(queueName),
    ]);
    const idSet = new Set([...queued, ...processing]);
    return Array.from(idSet);
  }

  async removeProcessingJob(queueName: string, jobId: string): Promise<boolean> {
    await this.ensureConnected();
    const processingKey = QueueKeyFactory.processing(queueName);
    const count = await this.client.lrem(processingKey, 0, jobId);
    return count > 0;
  }

  async removeOrphanJob(queueName: string, jobId: string): Promise<boolean> {
    await this.ensureConnected();
    const queueKey = QueueKeyFactory.queue(queueName);
    const processingKey = QueueKeyFactory.processing(queueName);
    const scheduledKey = QueueKeyFactory.scheduled();
    const dlqKey = QueueKeyFactory.deadLetter();

    const pipeline = this.client.pipeline();
    pipeline.lrem(queueKey, 0, jobId);
    pipeline.lrem(processingKey, 0, jobId);
    pipeline.zrem(scheduledKey, jobId);
    pipeline.lrem(dlqKey, 0, jobId);

    const results = await pipeline.exec();
    let removedAny = false;
    if (results) {
      for (const [err, res] of results) {
        if (!err && typeof res === 'number' && res > 0) {
          removedAny = true;
        }
      }
    }
    return removedAny;
  }

  async rebuildQueue(queueName: string, jobIds: string[]): Promise<void> {
    await this.ensureConnected();
    const queueKey = QueueKeyFactory.queue(queueName);
    const setKey = QueueKeyFactory.queuesSet();

    const pipeline = this.client.pipeline();
    pipeline.del(queueKey);
    if (jobIds.length > 0) {
      pipeline.rpush(queueKey, ...jobIds);
      pipeline.sadd(setKey, queueName);
    }
    await pipeline.exec();
    appLogger.info('Queue rebuilt in Redis', { queueName, count: jobIds.length });
  }
}

export const redisQueue = new RedisQueue();
