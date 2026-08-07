import { Job } from '../types/job.types.js';
import { RetryDecision, RetryMetricsResponse, RetryPolicy } from './retry.types.js';

export interface IRetryEngine {
  shouldRetry(job: Job, error?: Error, policy?: Partial<RetryPolicy>): Promise<boolean>;
  calculateDelay(job: Job, policy?: Partial<RetryPolicy>): number;
  scheduleRetry(job: Job, error: Error, policy?: Partial<RetryPolicy>): Promise<RetryDecision>;
  moveToDeadLetter(job: Job, error: Error): Promise<Job>;
  recoverPendingRetries(): Promise<number>;
  getMetrics(): Promise<RetryMetricsResponse>;
}
