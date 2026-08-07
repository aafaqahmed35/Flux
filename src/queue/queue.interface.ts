import { EnqueueResult, QueueMetrics } from './queue.types.js';

export interface IQueueEngine {
  enqueue(queueName: string, jobId: string): Promise<EnqueueResult>;
  enqueueMany(queueName: string, jobIds: string[]): Promise<EnqueueResult[]>;
  queueLength(queueName: string): Promise<number>;
  peek(queueName: string, count?: number): Promise<string[]>;
  peekMany(queueName: string, count?: number): Promise<string[]>;
  exists(queueName: string, jobId: string): Promise<boolean>;
  remove(queueName: string, jobId: string): Promise<boolean>;
  clear(queueName: string): Promise<void>;
  listQueues(): Promise<string[]>;
  getMetrics(queueName?: string): Promise<QueueMetrics>;
}
