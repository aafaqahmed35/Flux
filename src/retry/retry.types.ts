import { RetryStrategy } from './retry.constants.js';

export interface RetryPolicy {
  strategy: RetryStrategy;
  maxRetries: number;
  retryDelay: number;
  maxDelayMs?: number;
  jitterPercent?: number;
  retryOn?: string[];
  doNotRetryOn?: string[];
}

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  nextRetryAt?: Date;
  reason?: string;
  isDeadLetter?: boolean;
}

export interface RetryContext {
  attempt: number;
  error: Error;
  failedAt: Date;
  workerId?: string | null;
}

export interface RetryStatistics {
  scheduledCount: number;
  retryingCount: number;
  deadLetterCount: number;
  averageDelayMs: number;
}

export interface RetryMetricsResponse {
  scheduled: number;
  retrying: number;
  exhausted: number;
  deadletter: number;
  averageDelayMs: number;
  successRate: number;
}
