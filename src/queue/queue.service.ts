import { QUEUE_NAME_REGEX } from '../constants/job.constants.js';
import { BadRequestError } from '../errors/BadRequestError.js';
import { appLogger } from '../logger/logger.js';
import { IQueueEngine } from './queue.interface.js';
import { redisQueue } from './redis.queue.js';
import { EnqueueResult, QueueMetrics } from './queue.types.js';

export class QueueService {
  private readonly engine: IQueueEngine;

  constructor(engine: IQueueEngine = redisQueue) {
    this.engine = engine;
  }

  private validateQueueName(queueName: string): void {
    if (!queueName || !QUEUE_NAME_REGEX.test(queueName)) {
      throw new BadRequestError(
        `Invalid queue name '${queueName}'. Queue names must contain only alphanumeric characters, dots, hyphens, or underscores.`,
      );
    }
  }

  async enqueue(queueName: string, jobId: string): Promise<EnqueueResult> {
    this.validateQueueName(queueName);
    if (!jobId) {
      throw new BadRequestError('Job ID is required for enqueueing');
    }
    return this.engine.enqueue(queueName, jobId);
  }

  async enqueueMany(queueName: string, jobIds: string[]): Promise<EnqueueResult[]> {
    this.validateQueueName(queueName);
    if (!jobIds || jobIds.length === 0) {
      return [];
    }
    return this.engine.enqueueMany(queueName, jobIds);
  }

  async queueLength(queueName: string): Promise<number> {
    this.validateQueueName(queueName);
    return this.engine.queueLength(queueName);
  }

  async peek(queueName: string, count = 1): Promise<string[]> {
    this.validateQueueName(queueName);
    return this.engine.peek(queueName, count);
  }

  async peekMany(queueName: string, count = 10): Promise<string[]> {
    this.validateQueueName(queueName);
    return this.engine.peekMany(queueName, count);
  }

  async exists(queueName: string, jobId: string): Promise<boolean> {
    this.validateQueueName(queueName);
    return this.engine.exists(queueName, jobId);
  }

  async remove(queueName: string, jobId: string): Promise<boolean> {
    this.validateQueueName(queueName);
    return this.engine.remove(queueName, jobId);
  }

  async clear(queueName: string): Promise<void> {
    this.validateQueueName(queueName);
    appLogger.info('Queue Service clear requested', { queueName });
    await this.engine.clear(queueName);
  }

  async listQueues(): Promise<string[]> {
    return this.engine.listQueues();
  }

  async getMetrics(queueName?: string): Promise<QueueMetrics> {
    if (queueName) {
      this.validateQueueName(queueName);
    }
    return this.engine.getMetrics(queueName);
  }
}

export const queueService = new QueueService();
