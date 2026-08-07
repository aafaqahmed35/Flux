import { JobPriority, JobStatus } from '../../src/constants/job.constants.js';
import { RETRY_DEFAULTS, RetryStrategy } from '../../src/retry/retry.constants.js';
import { RetryEngine } from '../../src/retry/retry.engine.js';
import { Job } from '../../src/types/job.types.js';

describe('Retry Policy & Backoff Math Unit Tests', () => {
  let engine: RetryEngine;

  beforeEach(() => {
    engine = new RetryEngine();
  });

  const mockJob = (overrides?: Partial<Job>): Job => ({
    id: 'test-job-id',
    name: 'test-job',
    queueName: 'default',
    idempotencyKey: null,
    workerId: null,
    payload: {},
    metadata: {},
    status: JobStatus.RUNNING,
    priority: JobPriority.NORMAL,
    retryCount: 0,
    maxRetries: 3,
    retryDelay: 1000,
    retryStrategy: RetryStrategy.EXPONENTIAL,
    nextRetryAt: null,
    lastRetryAt: null,
    lastFailureType: null,
    lastFailureCode: null,
    deadLetteredAt: null,
    deadLetterReason: null,
    scheduledFor: null,
    delayUntil: null,
    attempts: 1,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    lockedAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    executionTimeMs: null,
    errorMessage: null,
    errorStack: null,
    failureReason: null,
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  });

  describe('calculateDelay', () => {
    it('should compute FIXED backoff correctly', () => {
      const job = mockJob({ retryStrategy: RetryStrategy.FIXED, retryDelay: 1000 });
      expect(engine.calculateDelay(job)).toBe(1000);
      job.retryCount = 2;
      expect(engine.calculateDelay(job)).toBe(1000);
    });

    it('should compute LINEAR backoff correctly', () => {
      const job = mockJob({ retryStrategy: RetryStrategy.LINEAR, retryDelay: 1000 });
      job.retryCount = 0; // attempt 1
      expect(engine.calculateDelay(job)).toBe(1000);
      job.retryCount = 1; // attempt 2
      expect(engine.calculateDelay(job)).toBe(2000);
      job.retryCount = 2; // attempt 3
      expect(engine.calculateDelay(job)).toBe(3000);
    });

    it('should compute EXPONENTIAL backoff correctly', () => {
      const job = mockJob({ retryStrategy: RetryStrategy.EXPONENTIAL, retryDelay: 1000 });
      job.retryCount = 0; // 1000 * 2^0 = 1000
      expect(engine.calculateDelay(job)).toBe(1000);
      job.retryCount = 1; // 1000 * 2^1 = 2000
      expect(engine.calculateDelay(job)).toBe(2000);
      job.retryCount = 2; // 1000 * 2^2 = 4000
      expect(engine.calculateDelay(job)).toBe(4000);
    });

    it('should compute EXPONENTIAL_WITH_JITTER within +/- 20% bounds', () => {
      const job = mockJob({
        retryStrategy: RetryStrategy.EXPONENTIAL_WITH_JITTER,
        retryDelay: 1000,
      });
      job.retryCount = 1; // base 2000ms
      const delay = engine.calculateDelay(job);
      // Bounds: 2000 * 0.8 = 1600ms <= delay <= 2000 * 1.2 = 2400ms
      expect(delay).toBeGreaterThanOrEqual(1600);
      expect(delay).toBeLessThanOrEqual(2400);
    });

    it('should cap calculated delay at MAX_DELAY_MS', () => {
      const job = mockJob({ retryStrategy: RetryStrategy.EXPONENTIAL, retryDelay: 100000 });
      job.retryCount = 10;
      const delay = engine.calculateDelay(job);
      expect(delay).toBeLessThanOrEqual(RETRY_DEFAULTS.maxDelayMs);
    });
  });

  describe('shouldRetry', () => {
    it('should allow retry if retryCount < maxRetries', async () => {
      const job = mockJob({ retryCount: 1, maxRetries: 3 });
      const res = await engine.shouldRetry(job);
      expect(res).toBe(true);
    });

    it('should reject retry if retryCount >= maxRetries', async () => {
      const job = mockJob({ retryCount: 3, maxRetries: 3 });
      const res = await engine.shouldRetry(job);
      expect(res).toBe(false);
    });

    it('should reject retry if error is in doNotRetryOn list', async () => {
      const job = mockJob({ retryCount: 0, maxRetries: 3 });
      const validationError = new Error('Invalid email parameter');
      validationError.name = 'ValidationError';

      const res = await engine.shouldRetry(job, validationError);
      expect(res).toBe(false);
    });

    it('should allow retry if error is transient and not in doNotRetryOn', async () => {
      const job = mockJob({ retryCount: 0, maxRetries: 3 });
      const networkError = new Error('Connection timeout');
      networkError.name = 'TimeoutError';

      const res = await engine.shouldRetry(job, networkError);
      expect(res).toBe(true);
    });
  });
});
