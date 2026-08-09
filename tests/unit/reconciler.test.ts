/* eslint-disable @typescript-eslint/unbound-method */
import { QueueReconciler } from '../../src/recovery/reconciler.js';

import { IJobRepository } from '../../src/repositories/job.repository.interface.js';
import { IQueueEngine } from '../../src/queue/queue.interface.js';
import { JobStatus, JobPriority } from '../../src/constants/job.constants.js';
import { RetryStrategy } from '../../src/retry/retry.constants.js';
import { Job } from '../../src/types/job.types.js';

describe('QueueReconciler Unit Tests', () => {
  let mockRepository: jest.Mocked<IJobRepository>;
  let mockQueueEngine: jest.Mocked<IQueueEngine>;
  let reconciler: QueueReconciler;

  const sampleQueuedJob: Job = {
    id: 'job-recon-1',
    name: 'queued-job',
    queueName: 'default',
    idempotencyKey: null,
    workerId: null,
    payload: {},
    metadata: {},
    status: JobStatus.QUEUED,
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
    attempts: 0,
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
  };

  beforeEach(() => {
    mockRepository = {
      findByStatus: jest.fn().mockResolvedValue([sampleQueuedJob]),
      findById: jest.fn().mockImplementation((id: string) => {
        if (id === 'job-recon-1') return Promise.resolve(sampleQueuedJob);
        if (id === 'job-completed')
          return Promise.resolve({
            ...sampleQueuedJob,
            id: 'job-completed',
            status: JobStatus.COMPLETED,
          });
        return Promise.resolve(null);
      }),
    } as unknown as jest.Mocked<IJobRepository>;

    mockQueueEngine = {
      containsJob: jest.fn().mockResolvedValue(false),
      enqueue: jest
        .fn()
        .mockResolvedValue({ jobId: 'job-recon-1', queueName: 'default', enqueuedAt: new Date() }),
      listQueues: jest.fn().mockResolvedValue(['default']),
      listProcessingJobs: jest.fn().mockResolvedValue(['job-completed']),
      listAllQueueJobIds: jest.fn().mockResolvedValue(['job-orphan']),
      removeProcessingJob: jest.fn().mockResolvedValue(true),
      removeOrphanJob: jest.fn().mockResolvedValue(true),
      getDeadLetterJobIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IQueueEngine>;

    reconciler = new QueueReconciler(mockRepository, mockQueueEngine);
  });

  it('should re-enqueue PG QUEUED jobs missing from Redis', async () => {
    const result = await reconciler.runReconciliation();
    const { containsJob, enqueue } = mockQueueEngine;

    expect(containsJob).toHaveBeenCalledWith('default', 'job-recon-1');
    expect(enqueue).toHaveBeenCalledWith('default', 'job-recon-1');
    expect(result.reenqueuedCount).toBe(1);
  });

  it('should remove stale Redis processing entries for COMPLETED PG jobs', async () => {
    const result = await reconciler.runReconciliation();
    const { removeProcessingJob } = mockQueueEngine;

    expect(removeProcessingJob).toHaveBeenCalledWith('default', 'job-completed');
    expect(result.staleRedisRemovedCount).toBe(1);
  });

  it('should remove orphan Redis job IDs with no PG row', async () => {
    const result = await reconciler.runReconciliation();
    const { removeOrphanJob } = mockQueueEngine;

    expect(removeOrphanJob).toHaveBeenCalledWith('default', 'job-orphan');
    expect(result.orphansRemovedCount).toBe(1);
  });
});
