export enum RetryStrategy {
  FIXED = 'FIXED',
  LINEAR = 'LINEAR',
  EXPONENTIAL = 'EXPONENTIAL',
  EXPONENTIAL_WITH_JITTER = 'EXPONENTIAL_WITH_JITTER',
}

export const RETRY_DEFAULTS = {
  maxRetries: 3,
  retryDelay: 1000,
  maxDelayMs: 5 * 60 * 1000, // 5 minutes
  jitterPercent: 0.2, // 20%
  defaultStrategy: RetryStrategy.EXPONENTIAL_WITH_JITTER,
} as const;

export const REDIS_RETRY_KEYS = {
  scheduled: 'flux:scheduled',
  deadletter: 'flux:deadletter',
} as const;
