/* eslint-disable @typescript-eslint/unbound-method */
import { JobPriority, JobStatus } from '../../src/constants/job.constants.js';
import { InvalidJobStateError } from '../../src/errors/InvalidJobStateError.js';
import { JobNotFoundError } from '../../src/errors/JobNotFoundError.js';
import { QueueService } from '../../src/queue/queue.service.js';
import { IJobRepository } from '../../src/repositories/job.repository.interface.js';
import { RetryStrategy } from '../../src/retry/retry.constants.js';
import { JobService } from '../../src/services/job.service.js';
import { Job } from '../../src/types/job.types.js';

describe('JobService (Unit Tests)', () => {
  let mockRepository: jest.Mocked<IJobRepository>;
  let mockQueueService: jest.Mocked<QueueService>;
  let service: JobService;

  const mockJob: Job = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'test-job',
    queueName: 'emails',
    idempotencyKey: 'idemp-1',
    workerId: null,
    payload: { email: 'user@example.com' },
    metadata: {},
    status: JobStatus.PENDING,
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
      createJob: jest.fn(),
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findByStatus: jest.fn(),
      findByQueue: jest.fn(),
      findReadyJobs: jest.fn(),
      findScheduledJobs: jest.fn(),
      updateStatus: jest.fn(),
      updateRetry: jest.fn(),
      updateExecutionMetadata: jest.fn(),
      cancelJob: jest.fn(),
      deleteJob: jest.fn(),
      exists: jest.fn(),
      count: jest.fn(),
      countByStatus: jest.fn(),
      listJobs: jest.fn(),
      findDueRetries: jest.fn(),
      addRetryHistoryRecord: jest.fn(),
      getJobRetryHistory: jest.fn(),
    };

    mockQueueService = {
      enqueue: jest
        .fn()
        .mockResolvedValue({ jobId: mockJob.id, queueName: 'emails', enqueuedAt: new Date() }),
      remove: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<QueueService>;

    service = new JobService(mockRepository, mockQueueService);
  });

  it('should return existing job on idempotency key match', async () => {
    mockRepository.findByIdempotencyKey.mockResolvedValueOnce(mockJob);

    const result = await service.createJob(
      {
        name: 'test-job',
        queueName: 'emails',
      },
      'idemp-1',
    );

    expect(result.isDuplicate).toBe(true);
    expect(result.job.id).toBe(mockJob.id);
    expect(mockRepository.createJob).not.toHaveBeenCalled();
  });

  it('should create new job and enqueue into Redis when idempotency key is not matched', async () => {
    mockRepository.findByIdempotencyKey.mockResolvedValueOnce(null);
    mockRepository.createJob.mockResolvedValueOnce(mockJob);
    mockRepository.updateStatus.mockResolvedValueOnce({ ...mockJob, status: JobStatus.QUEUED });

    const result = await service.createJob(
      {
        name: 'test-job',
        queueName: 'emails',
      },
      'idemp-new',
    );

    expect(result.isDuplicate).toBe(false);
    expect(result.job.id).toBe(mockJob.id);
    expect(result.job.status).toBe(JobStatus.QUEUED);
    expect(mockRepository.createJob).toHaveBeenCalled();
    expect(mockQueueService.enqueue).toHaveBeenCalledWith(mockJob.queueName, mockJob.id);
  });

  it('should throw JobNotFoundError when getting non-existent job', async () => {
    mockRepository.findById.mockResolvedValueOnce(null);
    await expect(service.getJobById('fake-id')).rejects.toThrow(JobNotFoundError);
  });

  it('should prevent soft deleting a RUNNING job', async () => {
    const runningJob: Job = { ...mockJob, status: JobStatus.RUNNING };
    mockRepository.findById.mockResolvedValueOnce(runningJob);

    await expect(service.deleteJob(runningJob.id)).rejects.toThrow(InvalidJobStateError);
    expect(mockRepository.deleteJob).not.toHaveBeenCalled();
  });

  it('should allow soft deleting a COMPLETED job', async () => {
    const completedJob: Job = { ...mockJob, status: JobStatus.COMPLETED };
    mockRepository.findById.mockResolvedValueOnce(completedJob);
    mockRepository.deleteJob.mockResolvedValueOnce(true);

    const result = await service.deleteJob(completedJob.id);

    expect(result.deleted).toBe(true);
    expect(mockRepository.deleteJob).toHaveBeenCalledWith(completedJob.id);
  });
});
