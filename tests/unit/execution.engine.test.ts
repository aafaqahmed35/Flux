import { ExecutionContext } from '../../src/execution/execution.context.js';
import { ExecutionEngine } from '../../src/execution/execution.engine.js';
import { appLogger } from '../../src/logger/logger.js';
import { Job } from '../../src/types/job.types.js';
import { JobPriority, JobStatus } from '../../src/constants/job.constants.js';
import { RetryStrategy } from '../../src/retry/retry.constants.js';
import { ProcessorRegistry } from '../../src/workers/processor.registry.js';

describe('ExecutionEngine (Unit Tests)', () => {
  let registry: ProcessorRegistry;
  let engine: ExecutionEngine;

  const mockJob: Job = {
    id: 'job-exec-1',
    name: 'test-execution',
    queueName: 'exec.queue',
    idempotencyKey: null,
    workerId: 'w-1',
    payload: { amount: 100 },
    metadata: {},
    status: JobStatus.RUNNING,
    priority: JobPriority.NORMAL,
    retryCount: 0,
    maxRetries: 3,
    retryDelay: 1000,
    retryStrategy: RetryStrategy.EXPONENTIAL_WITH_JITTER,
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
    lockedAt: new Date(),
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

  const mockContext: ExecutionContext = {
    jobId: mockJob.id,
    jobName: mockJob.name,
    traceId: mockJob.id,
    correlationId: mockJob.id,
    workerId: 'w-1',
    queueName: 'exec.queue',
    attempt: 1,
    startedAt: new Date(),
    logger: appLogger,
  };

  beforeEach(() => {
    registry = new ProcessorRegistry();
    engine = new ExecutionEngine(registry);
  });

  it('should execute processor successfully and return execution result', async () => {
    const mockProcessor = {
      execute: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
    };

    registry.registerProcessor('exec.queue', mockProcessor);

    const result = await engine.execute(mockJob, mockContext);

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ status: 'SUCCESS' });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(mockProcessor.execute).toHaveBeenCalledWith(mockJob, mockContext);
  });

  it('should handle processor errors gracefully and return error in result', async () => {
    const mockProcessor = {
      execute: jest.fn().mockRejectedValue(new Error('API connection timeout')),
    };

    registry.registerProcessor('exec.queue', mockProcessor);

    const result = await engine.execute(mockJob, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toBe('API connection timeout');
  });

  it('should return error when no processor is registered for queue', async () => {
    const result = await engine.execute(mockJob, mockContext);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("No job processor registered for queue 'exec.queue'");
  });
});
