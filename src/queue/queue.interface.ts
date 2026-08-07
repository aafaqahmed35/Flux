import { EnqueueResult, QueueMetrics } from './queue.types.js';

export interface IQueueEngine {
  enqueue(queueName: string, jobId: string): Promise<EnqueueResult>;
  enqueueMany(queueName: string, jobIds: string[]): Promise<EnqueueResult[]>;
  claimJob(queueName: string, timeoutSeconds?: number): Promise<string | null>;
  ackJob(queueName: string, jobId: string): Promise<void>;
  queueLength(queueName: string): Promise<number>;
  peek(queueName: string, count?: number): Promise<string[]>;
  peekMany(queueName: string, count?: number): Promise<string[]>;
  exists(queueName: string, jobId: string): Promise<boolean>;
  remove(queueName: string, jobId: string): Promise<boolean>;
  clear(queueName: string): Promise<void>;
  listQueues(): Promise<string[]>;
  getMetrics(queueName?: string): Promise<QueueMetrics>;
  scheduleJob(jobId: string, executeAtMs: number): Promise<void>;
  getDueScheduledJobs(maxTimestampMs: number, limit?: number): Promise<string[]>;
  removeScheduledJob(jobId: string): Promise<boolean>;
  pushToDeadLetter(jobId: string): Promise<void>;
  removeFromDeadLetter(jobId: string): Promise<boolean>;
  getDeadLetterJobIds(limit?: number, offset?: number): Promise<string[]>;
}
