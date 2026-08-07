/* eslint-disable @typescript-eslint/unbound-method */
import { JobPriority, JobStatus } from '../../src/constants/job.constants.js';
import { redisQueue } from '../../src/queue/redis.queue.js';
import { jobRepository } from '../../src/repositories/job.repository.js';
import { RetryStrategy } from '../../src/retry/retry.constants.js';
import { RetryEngine } from '../../src/retry/retry.engine.js';
import { Job } from '../../src/types/job.types.js';

jest.mock('../../src/repositories/job.repository.js');
jest.mock('../../src/queue/redis.queue.js');

describe('RetryEngine Unit Tests', () => {
  let engine: RetryEngine;

  const mockJob: Job = {
    id: 'job-123',
    name: 'test-job',
    queueName: 'emails',
    idempotencyKey: null,
    workerId: 'worker-1',
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
    startedAt: new Date(),
    completedAt: null,
    failedAt: null,
    executionTimeMs: null,
    errorMessage: null,
    errorStack: null,
    failureReason: null,
    isDeleted: false,
    deletedAt: null,
  };

  beforeEach(() => {
    engine = new RetryEngine();
    jest.clearAllMocks();
  });

  it('should schedule retry when eligible', async () => {
    (jobRepository.addRetryHistoryRecord as jest.Mock).mockResolvedValue({ id: 'rec-1' });
    (jobRepository.updateRetry as jest.Mock).mockResolvedValue({
      ...mockJob,
      retryCount: 1,
      status: JobStatus.RETRYING,
    });
    (redisQueue.scheduleJob as jest.Mock).mockResolvedValue(undefined);
    (redisQueue.ackJob as jest.Mock).mockResolvedValue(undefined);

    const error = new Error('Database connection failed');
    error.name = 'DatabaseError';

    const decision = await engine.scheduleRetry(mockJob, error);

    expect(decision.shouldRetry).toBe(true);
    expect(decision.delayMs).toBeGreaterThan(0);
    expect(jobRepository.addRetryHistoryRecord).toHaveBeenCalledTimes(1);
    expect(jobRepository.updateRetry).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({
        retryCount: 1,
        status: JobStatus.RETRYING,
      }),
    );
    expect(redisQueue.scheduleJob).toHaveBeenCalledWith('job-123', expect.any(Number));
    expect(redisQueue.ackJob).toHaveBeenCalledWith('emails', 'job-123');
  });

  it('should move job to DLQ when max retries exceeded', async () => {
    const exhaustedJob = { ...mockJob, retryCount: 3, maxRetries: 3 };

    (jobRepository.addRetryHistoryRecord as jest.Mock).mockResolvedValue({ id: 'rec-2' });
    (jobRepository.updateRetry as jest.Mock).mockResolvedValue({
      ...exhaustedJob,
      status: JobStatus.DEAD_LETTER,
    });
    (redisQueue.pushToDeadLetter as jest.Mock).mockResolvedValue(undefined);
    (redisQueue.ackJob as jest.Mock).mockResolvedValue(undefined);

    const error = new Error('Persistent failure');

    const decision = await engine.scheduleRetry(exhaustedJob, error);

    expect(decision.shouldRetry).toBe(false);
    expect(decision.isDeadLetter).toBe(true);
    expect(jobRepository.updateRetry).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({
        status: JobStatus.DEAD_LETTER,
      }),
    );
    expect(redisQueue.pushToDeadLetter).toHaveBeenCalledWith('job-123');
  });

  it('should move non-retryable error (e.g. ValidationError) directly to DLQ', async () => {
    (jobRepository.addRetryHistoryRecord as jest.Mock).mockResolvedValue({ id: 'rec-3' });
    (jobRepository.updateRetry as jest.Mock).mockResolvedValue({
      ...mockJob,
      status: JobStatus.DEAD_LETTER,
    });
    (redisQueue.pushToDeadLetter as jest.Mock).mockResolvedValue(undefined);
    (redisQueue.ackJob as jest.Mock).mockResolvedValue(undefined);

    const validationError = new Error('Invalid JSON payload');
    validationError.name = 'ValidationError';

    const decision = await engine.scheduleRetry(mockJob, validationError);

    expect(decision.shouldRetry).toBe(false);
    expect(decision.isDeadLetter).toBe(true);
    expect(redisQueue.pushToDeadLetter).toHaveBeenCalledWith('job-123');
  });
});
