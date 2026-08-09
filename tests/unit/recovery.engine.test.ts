/* eslint-disable @typescript-eslint/unbound-method */
import { RecoveryEngine } from '../../src/recovery/recovery.engine.js';

import { IJobRepository } from '../../src/repositories/job.repository.interface.js';
import { IQueueEngine } from '../../src/queue/queue.interface.js';
import { RetryEngine } from '../../src/retry/retry.engine.js';
import { JobStatus, JobPriority } from '../../src/constants/job.constants.js';
import { RetryStrategy } from '../../src/retry/retry.constants.js';
import { Job } from '../../src/types/job.types.js';

describe('RecoveryEngine Unit Tests', () => {
  let mockRepository: jest.Mocked<IJobRepository>;
  let mockQueueEngine: jest.Mocked<IQueueEngine>;
  let mockRetryEngine: jest.Mocked<RetryEngine>;
  let engine: RecoveryEngine;

  const sampleJob: Job = {
    id: 'job-1',
    name: 'test-job',
    queueName: 'default',
    idempotencyKey: null,
    workerId: 'worker-stale',
    payload: {},
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
    lockedAt: new Date(Date.now() - 60000),
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
    mockRepository = {
      findStaleRunningJobs: jest.fn().mockResolvedValue([sampleJob]),
      findClaimedJobs: jest.fn().mockResolvedValue([]),
      findRecoverablePendingJobs: jest.fn().mockResolvedValue([]),
      findRetryingJobs: jest.fn().mockResolvedValue([]),
      recoverStaleJob: jest.fn().mockResolvedValue(true),
      recoverPendingJob: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<IJobRepository>;

    mockQueueEngine = {
      enqueue: jest
        .fn()
        .mockResolvedValue({ jobId: 'job-1', queueName: 'default', enqueuedAt: new Date() }),
    } as unknown as jest.Mocked<IQueueEngine>;

    mockRetryEngine = {} as unknown as jest.Mocked<RetryEngine>;

    engine = new RecoveryEngine(mockRepository, mockQueueEngine, mockRetryEngine);
  });

  it('should recover stale RUNNING jobs to RETRYING when retries remain', async () => {
    const result = await engine.runRecovery();
    const { findStaleRunningJobs, recoverStaleJob } = mockRepository;

    expect(findStaleRunningJobs).toHaveBeenCalled();
    expect(recoverStaleJob).toHaveBeenCalledWith(
      'job-1',
      JobStatus.RUNNING,
      JobStatus.RETRYING,
      expect.stringContaining('Stale lease'),
    );
    expect(result.recoveredCount).toBe(1);
    expect(result.recoveredJobIds).toContain('job-1');
  });

  it('should recover stale RUNNING jobs to FAILED when retries are exhausted', async () => {
    const exhaustedJob = { ...sampleJob, id: 'job-exhausted', retryCount: 3, maxRetries: 3 };
    mockRepository.findStaleRunningJobs.mockResolvedValueOnce([exhaustedJob]);

    const result = await engine.runRecovery();
    const { recoverStaleJob } = mockRepository;

    expect(recoverStaleJob).toHaveBeenCalledWith(
      'job-exhausted',
      JobStatus.RUNNING,
      JobStatus.FAILED,
      expect.stringContaining('retries exhausted'),
    );
    expect(result.recoveredCount).toBe(1);
  });

  it('should recover stale CLAIMED jobs back to QUEUED and enqueue into Redis', async () => {
    const claimedJob = { ...sampleJob, id: 'job-claimed', status: JobStatus.CLAIMED };
    mockRepository.findStaleRunningJobs.mockResolvedValueOnce([]);
    mockRepository.findClaimedJobs.mockResolvedValueOnce([claimedJob]);

    const result = await engine.runRecovery();
    const { recoverStaleJob } = mockRepository;
    const { enqueue } = mockQueueEngine;

    expect(recoverStaleJob).toHaveBeenCalledWith(
      'job-claimed',
      JobStatus.CLAIMED,
      JobStatus.QUEUED,
      'Stale claim recovery',
    );
    expect(enqueue).toHaveBeenCalledWith('default', 'job-claimed');
    expect(result.recoveredCount).toBe(1);
  });

  it('should recover stale PENDING jobs to QUEUED and enqueue into Redis', async () => {
    const pendingJob = { ...sampleJob, id: 'job-pending', status: JobStatus.PENDING };
    mockRepository.findStaleRunningJobs.mockResolvedValueOnce([]);
    mockRepository.findRecoverablePendingJobs.mockResolvedValueOnce([pendingJob]);

    const result = await engine.runRecovery();
    const { recoverPendingJob } = mockRepository;
    const { enqueue } = mockQueueEngine;

    expect(recoverPendingJob).toHaveBeenCalledWith('job-pending');
    expect(enqueue).toHaveBeenCalledWith('default', 'job-pending');
    expect(result.recoveredCount).toBe(1);
  });

  it('should recover due RETRYING jobs to QUEUED and enqueue into Redis', async () => {
    const retryingJob = {
      ...sampleJob,
      id: 'job-retrying',
      status: JobStatus.RETRYING,
      nextRetryAt: new Date(Date.now() - 5000),
    };
    mockRepository.findStaleRunningJobs.mockResolvedValueOnce([]);
    mockRepository.findRetryingJobs.mockResolvedValueOnce([retryingJob]);

    const result = await engine.runRecovery();
    const { recoverStaleJob } = mockRepository;
    const { enqueue } = mockQueueEngine;

    expect(recoverStaleJob).toHaveBeenCalledWith(
      'job-retrying',
      JobStatus.RETRYING,
      JobStatus.QUEUED,
      'Retry delay matured',
    );
    expect(enqueue).toHaveBeenCalledWith('default', 'job-retrying');
    expect(result.recoveredCount).toBe(1);
  });

  it('should handle recovery race condition (when recoverStaleJob returns false)', async () => {
    mockRepository.recoverStaleJob.mockResolvedValueOnce(false);

    const result = await engine.runRecovery();

    expect(result.recoveredCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });
});
