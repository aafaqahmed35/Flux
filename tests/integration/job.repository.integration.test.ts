import { pgPool } from '../../src/database/postgres.js';
import { runMigrations } from '../../src/database/migrator.js';
import { PostgresJobRepository } from '../../src/repositories/job.repository.js';
import { JobPriority, JobStatus } from '../../src/constants/job.constants.js';
import { JobNotFoundError } from '../../src/errors/JobNotFoundError.js';
import { InvalidJobStateError } from '../../src/errors/InvalidJobStateError.js';
import { DuplicateJobError } from '../../src/errors/DuplicateJobError.js';

describe('PostgresJobRepository Integration Tests', () => {
  const repository = new PostgresJobRepository(pgPool);
  const createdJobIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();
  });

  afterEach(async () => {
    for (const id of createdJobIds) {
      await repository.deleteJob(id).catch(() => {});
    }
    createdJobIds.length = 0;
  });

  afterAll(async () => {
    await pgPool.end();
  });

  it('should create a job and retrieve it by ID', async () => {
    const request = {
      name: 'send-welcome-email',
      queueName: 'emails.integration',
      payload: { userId: 'usr-100', email: 'test@example.com' },
      metadata: { correlationId: 'corr-001' },
      priority: JobPriority.HIGH,
    };

    const job = await repository.createJob(request);
    createdJobIds.push(job.id);

    expect(job.id).toBeDefined();
    expect(job.name).toBe('send-welcome-email');
    expect(job.queueName).toBe('emails.integration');
    expect(job.status).toBe(JobStatus.PENDING);
    expect(job.priority).toBe(JobPriority.HIGH);
    expect(job.payload).toEqual({ userId: 'usr-100', email: 'test@example.com' });
    expect(job.metadata).toEqual({ correlationId: 'corr-001' });
    expect(job.version).toBe(1);

    const fetched = await repository.findById(job.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(job.id);
    expect(fetched?.name).toBe('send-welcome-email');
  });

  it('should enforce idempotency key uniqueness', async () => {
    const key = `idemp-${Date.now()}`;

    const job1 = await repository.createJob({
      name: 'idempotent-job',
      queueName: 'payments.integration',
      idempotencyKey: key,
    });
    createdJobIds.push(job1.id);

    await expect(
      repository.createJob({
        name: 'idempotent-job-duplicate',
        queueName: 'payments.integration',
        idempotencyKey: key,
      }),
    ).rejects.toThrow(DuplicateJobError);

    const found = await repository.findByIdempotencyKey('payments.integration', key);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(job1.id);
  });

  it('should update job status with valid transitions and optimistic locking', async () => {
    const job = await repository.createJob({
      name: 'process-order',
      queueName: 'orders.integration',
    });
    createdJobIds.push(job.id);

    // PENDING -> QUEUED
    const queuedJob = await repository.updateStatus(job.id, JobStatus.QUEUED);
    expect(queuedJob.status).toBe(JobStatus.QUEUED);
    expect(queuedJob.version).toBe(2);

    // QUEUED -> RUNNING
    const runningJob = await repository.updateStatus(job.id, JobStatus.RUNNING, {
      workerId: 'worker-node-1',
      lockedAt: new Date(),
    });
    expect(runningJob.status).toBe(JobStatus.RUNNING);
    expect(runningJob.workerId).toBe('worker-node-1');
    expect(runningJob.startedAt).not.toBeNull();
    expect(runningJob.version).toBe(3);

    // RUNNING -> COMPLETED
    const completedJob = await repository.updateStatus(job.id, JobStatus.COMPLETED, {
      executionTimeMs: 250,
    });
    expect(completedJob.status).toBe(JobStatus.COMPLETED);
    expect(completedJob.executionTimeMs).toBe(250);
    expect(completedJob.completedAt).not.toBeNull();
    expect(completedJob.version).toBe(4);
  });

  it('should reject invalid status transitions', async () => {
    const job = await repository.createJob({
      name: 'status-test',
      queueName: 'default.integration',
    });
    createdJobIds.push(job.id);

    // Cannot transition directly from PENDING to COMPLETED
    await expect(repository.updateStatus(job.id, JobStatus.COMPLETED)).rejects.toThrow(
      InvalidJobStateError,
    );
  });

  it('should handle retries and update execution metadata', async () => {
    const job = await repository.createJob({
      name: 'flaky-api-call',
      queueName: 'api.integration',
    });
    createdJobIds.push(job.id);

    await repository.updateStatus(job.id, JobStatus.QUEUED);
    await repository.updateStatus(job.id, JobStatus.RUNNING);

    const nextRetry = new Date(Date.now() + 5000);
    const retryingJob = await repository.updateRetry(job.id, {
      retryCount: 1,
      nextRetryAt: nextRetry,
      errorMessage: 'Connection reset by peer',
      failureReason: 'NETWORK_ERROR',
    });

    expect(retryingJob.status).toBe(JobStatus.RETRYING);
    expect(retryingJob.retryCount).toBe(1);
    expect(retryingJob.errorMessage).toBe('Connection reset by peer');

    const metaJob = await repository.updateExecutionMetadata(job.id, {
      attempts: 2,
      metadata: { lastAttemptAt: new Date().toISOString() },
    });

    expect(metaJob.attempts).toBe(2);
    expect(metaJob.metadata.lastAttemptAt).toBeDefined();
  });

  it('should list and count jobs with filters and pagination', async () => {
    const qName = `test-queue-${Date.now()}`;
    const jobA = await repository.createJob({
      name: 'job-A',
      queueName: qName,
      priority: JobPriority.HIGH,
    });
    const jobB = await repository.createJob({
      name: 'job-B',
      queueName: qName,
      priority: JobPriority.LOW,
    });
    createdJobIds.push(jobA.id, jobB.id);

    const ready = await repository.findReadyJobs(qName, 10);
    expect(ready.length).toBe(2);
    expect(ready[0]?.priority).toBe(JobPriority.HIGH); // High priority first

    const count = await repository.count({ queueName: qName });
    expect(count).toBe(2);

    const paginated = await repository.listJobs({ queueName: qName, limit: 10 });
    expect(paginated.total).toBe(2);
    expect(paginated.jobs.length).toBe(2);
  });

  it('should check existence, cancel, and delete job', async () => {
    const job = await repository.createJob({
      name: 'cancelable-job',
      queueName: 'cancel.integration',
    });
    createdJobIds.push(job.id);

    expect(await repository.exists(job.id)).toBe(true);

    const cancelled = await repository.cancelJob(job.id, 'User requested cancellation');
    expect(cancelled.status).toBe(JobStatus.CANCELLED);
    expect(cancelled.failureReason).toBe('User requested cancellation');

    const deleted = await repository.deleteJob(job.id);
    expect(deleted).toBe(true);
    expect(await repository.exists(job.id)).toBe(false);
    expect(await repository.findById(job.id)).toBeNull();
  });

  it('should throw JobNotFoundError for operations on non-existent jobs', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    await expect(repository.cancelJob(fakeId)).rejects.toThrow(JobNotFoundError);
  });
});
