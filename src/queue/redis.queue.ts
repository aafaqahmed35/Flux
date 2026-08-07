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
      appLogger.info('Enqueue Start', { jobId, queueName, queueKey });

      const pipeline = this.client.pipeline();
      pipeline.rpush(queueKey, jobId);
      pipeline.sadd(setKey, queueName);
      await pipeline.exec();

      const rtt = Date.now() - start;
      appLogger.info('Enqueue Success', { jobId, queueName, rttMs: rtt });

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
      appLogger.info('Batch Enqueue Start', { count: jobIds.length, queueName });

      const pipeline = this.client.pipeline();
      jobIds.forEach((jobId) => {
        pipeline.rpush(queueKey, jobId);
      });
      pipeline.sadd(setKey, queueName);
      await pipeline.exec();

      const rtt = Date.now() - start;
      appLogger.info('Batch Enqueue Success', { count: jobIds.length, queueName, rttMs: rtt });

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

  async queueLength(queueName: string): Promise<number> {
    await this.ensureConnected();
    const queueKey = QueueKeyFactory.queue(queueName);
    const length = await this.client.llen(queueKey);
    appLogger.info('Queue Length Requested', { queueName, length });
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

  async getMetrics(targetQueueName?: string): Promise<QueueMetrics> {
    await this.ensureConnected();

    // 1. Pending count from PostgreSQL (canonical source of truth for PENDING)
    const pendingCount = await jobRepository.count({
      status: JobStatus.PENDING,
      queueName: targetQueueName,
    });

    // 2. Queued count from Redis queue LENGTH
    let queuedCount = 0;
    if (targetQueueName) {
      queuedCount = await this.queueLength(targetQueueName);
    } else {
      const activeQueues = await this.listQueues();
      for (const q of activeQueues) {
        queuedCount += await this.client.llen(QueueKeyFactory.queue(q));
      }
    }

    // 3. Placeholders for processing, scheduled, deadletter, activeWorkers
    let processingCount = 0;
    if (targetQueueName) {
      processingCount = await this.client.llen(QueueKeyFactory.processing(targetQueueName));
    }

    const scheduledCount = await this.client.zcard(QueueKeyFactory.scheduled());
    const deadletterCount = await this.client.llen(QueueKeyFactory.deadLetter());
    const activeWorkers = await this.client.hlen(QueueKeyFactory.workers());

    return {
      pending: pendingCount,
      queued: queuedCount,
      processing: processingCount,
      scheduled: scheduledCount,
      deadletter: deadletterCount,
      activeWorkers,
    };
  }
}

export const redisQueue = new RedisQueue();
