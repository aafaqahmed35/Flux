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
    await repository.updateStatus(jobA.id, JobStatus.QUEUED);
    await repository.updateStatus(jobB.id, JobStatus.QUEUED);
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

  describe('Recovery Integration Tests', () => {
    it('should discover stale RUNNING vs fresh RUNNING jobs', async () => {
      const staleJob = await repository.createJob({
        name: 'stale-running',
        queueName: 'recovery.int',
      });
      const freshJob = await repository.createJob({
        name: 'fresh-running',
        queueName: 'recovery.int',
      });
      createdJobIds.push(staleJob.id, freshJob.id);

      await repository.updateStatus(staleJob.id, JobStatus.QUEUED);
      await repository.updateStatus(staleJob.id, JobStatus.RUNNING, {
        workerId: 'w-1',
        lockedAt: new Date(),
      });
      await pgPool.query(
        "UPDATE jobs SET locked_at = NOW() - INTERVAL '60 seconds' WHERE id = $1",
        [staleJob.id],
      );

      await repository.updateStatus(freshJob.id, JobStatus.QUEUED);
      await repository.updateStatus(freshJob.id, JobStatus.RUNNING, {
        workerId: 'w-2',
        lockedAt: new Date(),
      });

      const staleRunning = await repository.findStaleRunningJobs(30000, 100);
      const staleIds = staleRunning.map((j) => j.id);

      expect(staleIds).toContain(staleJob.id);
      expect(staleIds).not.toContain(freshJob.id);
    });

    it('should discover stale CLAIMED vs fresh CLAIMED jobs', async () => {
      const staleClaimed = await repository.createJob({
        name: 'stale-claimed',
        queueName: 'recovery.int',
      });
      const freshClaimed = await repository.createJob({
        name: 'fresh-claimed',
        queueName: 'recovery.int',
      });
      createdJobIds.push(staleClaimed.id, freshClaimed.id);

      await repository.updateStatus(staleClaimed.id, JobStatus.QUEUED);
      await repository.updateStatus(staleClaimed.id, JobStatus.CLAIMED, {
        workerId: 'w-1',
        lockedAt: new Date(),
      });
      await pgPool.query(
        "UPDATE jobs SET locked_at = NOW() - INTERVAL '60 seconds' WHERE id = $1",
        [staleClaimed.id],
      );

      await repository.updateStatus(freshClaimed.id, JobStatus.QUEUED);
      await repository.updateStatus(freshClaimed.id, JobStatus.CLAIMED, {
        workerId: 'w-2',
        lockedAt: new Date(),
      });

      const claimedJobs = await repository.findClaimedJobs(30000, 100);
      const claimedIds = claimedJobs.map((j) => j.id);

      expect(claimedIds).toContain(staleClaimed.id);
      expect(claimedIds).not.toContain(freshClaimed.id);
    });

    it('should discover stale PENDING vs fresh PENDING jobs', async () => {
      const stalePending = await repository.createJob({
        name: 'stale-pending',
        queueName: 'recovery.int',
      });
      const freshPending = await repository.createJob({
        name: 'fresh-pending',
        queueName: 'recovery.int',
      });
      createdJobIds.push(stalePending.id, freshPending.id);

      await pgPool.query(
        "UPDATE jobs SET created_at = NOW() - INTERVAL '120 seconds' WHERE id = $1",
        [stalePending.id],
      );

      const recoverable = await repository.findRecoverablePendingJobs(60000, 100);
      const recoverableIds = recoverable.map((j) => j.id);

      expect(recoverableIds).toContain(stalePending.id);
      expect(recoverableIds).not.toContain(freshPending.id);
    });

    it('should discover due RETRYING jobs and exclude future and NULL next_retry_at jobs', async () => {
      const dueJob = await repository.createJob({ name: 'due-retry', queueName: 'recovery.int' });
      const futureJob = await repository.createJob({
        name: 'future-retry',
        queueName: 'recovery.int',
      });
      const nullRetryJob = await repository.createJob({
        name: 'null-retry',
        queueName: 'recovery.int',
      });
      createdJobIds.push(dueJob.id, futureJob.id, nullRetryJob.id);

      await repository.updateStatus(dueJob.id, JobStatus.QUEUED);
      await repository.updateStatus(dueJob.id, JobStatus.RUNNING);
      await repository.updateRetry(dueJob.id, {
        retryCount: 1,
        nextRetryAt: new Date(Date.now() - 10000),
        errorMessage: 'err',
      });

      await repository.updateStatus(futureJob.id, JobStatus.QUEUED);
      await repository.updateStatus(futureJob.id, JobStatus.RUNNING);
      await repository.updateRetry(futureJob.id, {
        retryCount: 1,
        nextRetryAt: new Date(Date.now() + 60000),
        errorMessage: 'err',
      });

      await pgPool.query(
        "UPDATE jobs SET status = 'RETRYING', next_retry_at = NULL WHERE id = $1",
        [nullRetryJob.id],
      );

      const retryingJobs = await repository.findRetryingJobs(100);
      const retryingIds = retryingJobs.map((j) => j.id);

      expect(retryingIds).toContain(dueJob.id);
      expect(retryingIds).not.toContain(futureJob.id);
      expect(retryingIds).not.toContain(nullRetryJob.id);
    });

    it('should perform atomic stale recovery and prevent duplicate recovery', async () => {
      const job = await repository.createJob({ name: 'atomic-stale', queueName: 'recovery.int' });
      createdJobIds.push(job.id);

      await repository.updateStatus(job.id, JobStatus.QUEUED);
      await repository.updateStatus(job.id, JobStatus.RUNNING, {
        workerId: 'w-stale',
        lockedAt: new Date(),
      });

      // Concurrent recovery attempts
      const [res1, res2] = await Promise.all([
        repository.recoverStaleJob(job.id, JobStatus.RUNNING, JobStatus.RETRYING, 'Stale timeout'),
        repository.recoverStaleJob(job.id, JobStatus.RUNNING, JobStatus.RETRYING, 'Stale timeout'),
      ]);

      // Exactly one process succeeds
      expect([res1, res2].filter(Boolean).length).toBe(1);

      const recovered = await repository.findById(job.id);
      expect(recovered?.status).toBe(JobStatus.RETRYING);
      expect(recovered?.workerId).toBeNull();
      expect(recovered?.lockedAt).toBeNull();
    });

    it('should perform atomic pending recovery and prevent duplicate pending recovery', async () => {
      const job = await repository.createJob({ name: 'atomic-pending', queueName: 'recovery.int' });
      createdJobIds.push(job.id);

      const [res1, res2] = await Promise.all([
        repository.recoverPendingJob(job.id),
        repository.recoverPendingJob(job.id),
      ]);

      expect([res1, res2].filter(Boolean).length).toBe(1);

      const recovered = await repository.findById(job.id);
      expect(recovered?.status).toBe(JobStatus.QUEUED);
    });

    it('should update job lease only for matching worker and RUNNING status', async () => {
      const job = await repository.createJob({ name: 'lease-test', queueName: 'recovery.int' });
      createdJobIds.push(job.id);

      await repository.updateStatus(job.id, JobStatus.QUEUED);
      await repository.updateStatus(job.id, JobStatus.RUNNING, {
        workerId: 'worker-A',
        lockedAt: new Date(),
      });

      // Correct worker renews lease
      const renewSuccess = await repository.updateJobLease(job.id, 'worker-A');
      expect(renewSuccess).toBe(true);

      // Wrong worker fails to renew lease
      const wrongWorkerResult = await repository.updateJobLease(job.id, 'worker-B');
      expect(wrongWorkerResult).toBe(false);

      // Complete job
      await repository.updateStatus(job.id, JobStatus.COMPLETED);

      // Non-RUNNING job fails lease renewal even for correct worker
      const nonRunningResult = await repository.updateJobLease(job.id, 'worker-A');
      expect(nonRunningResult).toBe(false);
    });
  });
});
