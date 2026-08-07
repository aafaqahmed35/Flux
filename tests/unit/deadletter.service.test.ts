import { JobPriority, JobStatus } from '../../src/constants/job.constants.js';
import { redisQueue } from '../../src/queue/redis.queue.js';
import { jobRepository } from '../../src/repositories/job.repository.js';
import { RetryStrategy } from '../../src/retry/retry.constants.js';
/* eslint-disable @typescript-eslint/unbound-method */
import { DeadLetterService } from '../../src/services/deadletter.service.js';
import { Job } from '../../src/types/job.types.js';

jest.mock('../../src/repositories/job.repository.js');
jest.mock('../../src/queue/redis.queue.js');

describe('DeadLetterService Unit Tests', () => {
  let service: DeadLetterService;

  const mockDLQJob: Job = {
    id: 'dlq-1',
    name: 'dead-job',
    queueName: 'reports',
    idempotencyKey: null,
    workerId: null,
    payload: {},
    metadata: {},
    status: JobStatus.DEAD_LETTER,
    priority: JobPriority.NORMAL,
    retryCount: 3,
    maxRetries: 3,
    retryDelay: 1000,
    retryStrategy: RetryStrategy.EXPONENTIAL,
    nextRetryAt: null,
    lastRetryAt: null,
    lastFailureType: 'Error',
    lastFailureCode: 'ERR',
    deadLetteredAt: new Date(),
    deadLetterReason: 'Max retries exhausted',
    scheduledFor: null,
    delayUntil: null,
    attempts: 3,
    version: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
    lockedAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: new Date(),
    executionTimeMs: 50,
    errorMessage: 'Max retries exhausted',
    errorStack: null,
    failureReason: 'MAX_RETRIES_EXCEEDED',
    isDeleted: false,
    deletedAt: null,
  };

  beforeEach(() => {
    service = new DeadLetterService();
    jest.clearAllMocks();
  });

  it('should list dead letter jobs from repository', async () => {
    (jobRepository.listJobs as jest.Mock).mockResolvedValue({
      jobs: [mockDLQJob],
      total: 1,
      limit: 20,
      offset: 0,
    });

    const result = await service.listDeadLetterJobs({ limit: 10 });
    expect(result.jobs.length).toBe(1);
    expect(jobRepository.listJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        status: JobStatus.DEAD_LETTER,
        limit: 10,
      }),
    );
  });

  it('should requeue dead letter job back to active queue', async () => {
    (jobRepository.findById as jest.Mock).mockResolvedValue(mockDLQJob);
    (jobRepository.updateStatus as jest.Mock).mockResolvedValue({
      ...mockDLQJob,
      status: JobStatus.QUEUED,
    });
    (redisQueue.removeFromDeadLetter as jest.Mock).mockResolvedValue(true);
    (redisQueue.enqueue as jest.Mock).mockResolvedValue({ jobId: 'dlq-1', queueName: 'reports' });

    const requeued = await service.requeueDeadLetterJob('dlq-1');

    expect(requeued.status).toBe(JobStatus.QUEUED);
    expect(jobRepository.updateStatus).toHaveBeenCalledWith('dlq-1', JobStatus.QUEUED, {
      deadLetteredAt: null,
      deadLetterReason: null,
    });
    expect(redisQueue.removeFromDeadLetter).toHaveBeenCalledWith('dlq-1');
    expect(redisQueue.enqueue).toHaveBeenCalledWith('reports', 'dlq-1');
  });

  it('should delete dead letter job', async () => {
    (redisQueue.removeFromDeadLetter as jest.Mock).mockResolvedValue(true);
    (jobRepository.deleteJob as jest.Mock).mockResolvedValue(true);

    const res = await service.deleteDeadLetterJob('dlq-1');
    expect(res).toBe(true);
    expect(redisQueue.removeFromDeadLetter).toHaveBeenCalledWith('dlq-1');
    expect(jobRepository.deleteJob).toHaveBeenCalledWith('dlq-1');
  });
});
