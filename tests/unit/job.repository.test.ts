import pg from 'pg';
import { JobPriority, JobStatus } from '../../src/constants/job.constants.js';
import { DuplicateJobError } from '../../src/errors/DuplicateJobError.js';
import { JobNotFoundError } from '../../src/errors/JobNotFoundError.js';
import { PostgresJobRepository } from '../../src/repositories/job.repository.js';

describe('PostgresJobRepository (Unit Tests)', () => {
  let mockQuery: jest.Mock;
  let repository: PostgresJobRepository;

  beforeEach(() => {
    mockQuery = jest.fn();
    const mockPool = {
      query: mockQuery,
    } as unknown as pg.Pool;

    repository = new PostgresJobRepository(mockPool);
  });

  const sampleDbRow = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'test-job',
    queue_name: 'test-queue',
    idempotency_key: null,
    worker_id: null,
    payload: { key: 'value' },
    metadata: {},
    status: 'PENDING',
    priority: 'NORMAL',
    retry_count: 0,
    max_retries: 3,
    retry_delay: 1000,
    retry_strategy: 'EXPONENTIAL_WITH_JITTER',
    next_retry_at: null,
    last_retry_at: null,
    last_failure_type: null,
    last_failure_code: null,
    dead_lettered_at: null,
    dead_letter_reason: null,
    scheduled_for: null,
    delay_until: null,
    attempts: 0,
    version: 1,
    created_at: new Date(),
    updated_at: new Date(),
    locked_at: null,
    started_at: null,
    completed_at: null,
    failed_at: null,
    execution_time_ms: null,
    error_message: null,
    error_stack: null,
    failure_reason: null,
    is_deleted: false,
    deleted_at: null,
  };

  it('should find a job by ID', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [sampleDbRow],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const job = await repository.findById('123e4567-e89b-12d3-a456-426614174000');

    expect(job).not.toBeNull();
    expect(job?.id).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(job?.name).toBe('test-job');
    expect(job?.status).toBe(JobStatus.PENDING);
    expect(job?.priority).toBe(JobPriority.NORMAL);
  });

  it('should return null when finding non-existent job ID', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const job = await repository.findById('non-existent-id');
    expect(job).toBeNull();
  });

  it('should throw DuplicateJobError on duplicate key violation (code 23505)', async () => {
    const dbErr = new pg.DatabaseError(
      'duplicate key value violates unique constraint',
      10,
      'error',
    );
    dbErr.code = '23505';

    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    mockQuery.mockRejectedValueOnce(dbErr);

    await expect(
      repository.createJob({
        name: 'duplicate-test',
        queueName: 'emails',
        idempotencyKey: 'key-123',
      }),
    ).rejects.toThrow(DuplicateJobError);
  });

  it('should throw JobNotFoundError when updating non-existent job status', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    await expect(repository.updateStatus('non-existent-id', JobStatus.CANCELLED)).rejects.toThrow(
      JobNotFoundError,
    );
  });

  describe('Recovery Operations Unit Tests', () => {
    it('should find stale RUNNING jobs', async () => {
      const staleRow = {
        ...sampleDbRow,
        status: 'RUNNING',
        locked_at: new Date(Date.now() - 60000),
      };
      mockQuery.mockResolvedValueOnce({ rows: [staleRow], rowCount: 1 });

      const jobs = await repository.findStaleRunningJobs(30000, 10);
      expect(jobs.length).toBe(1);
      expect(jobs[0]?.status).toBe(JobStatus.RUNNING);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'RUNNING'"),
        expect.arrayContaining([expect.any(Date), 10]),
      );
    });

    it('should find stale CLAIMED jobs', async () => {
      const claimedRow = {
        ...sampleDbRow,
        status: 'CLAIMED',
        locked_at: new Date(Date.now() - 60000),
      };
      mockQuery.mockResolvedValueOnce({ rows: [claimedRow], rowCount: 1 });

      const jobs = await repository.findClaimedJobs(30000, 5);
      expect(jobs.length).toBe(1);
      expect(jobs[0]?.status).toBe(JobStatus.CLAIMED);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'CLAIMED'"),
        expect.arrayContaining([expect.any(Date), 5]),
      );
    });

    it('should find recoverable PENDING jobs', async () => {
      const pendingRow = {
        ...sampleDbRow,
        status: 'PENDING',
        created_at: new Date(Date.now() - 120000),
      };
      mockQuery.mockResolvedValueOnce({ rows: [pendingRow], rowCount: 1 });

      const jobs = await repository.findRecoverablePendingJobs(60000, 10);
      expect(jobs.length).toBe(1);
      expect(jobs[0]?.status).toBe(JobStatus.PENDING);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'PENDING'"),
        expect.arrayContaining([expect.any(Date), 10]),
      );
    });

    it('should find due RETRYING jobs and exclude NULL next_retry_at', async () => {
      const retryingRow = {
        ...sampleDbRow,
        status: 'RETRYING',
        next_retry_at: new Date(Date.now() - 1000),
      };
      mockQuery.mockResolvedValueOnce({ rows: [retryingRow], rowCount: 1 });

      const jobs = await repository.findRetryingJobs(10);
      expect(jobs.length).toBe(1);
      expect(jobs[0]?.status).toBe(JobStatus.RETRYING);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('next_retry_at IS NOT NULL'),
        [10],
      );
    });

    it('should recover stale job atomically (returning true on success, false when zero rows affected)', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      const success = await repository.recoverStaleJob(
        'job-1',
        JobStatus.RUNNING,
        JobStatus.RETRYING,
        'Stale lease',
      );
      expect(success).toBe(true);

      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      const failed = await repository.recoverStaleJob(
        'job-1',
        JobStatus.RUNNING,
        JobStatus.RETRYING,
        'Stale lease',
      );
      expect(failed).toBe(false);
    });

    it('should recover pending job atomically (returning true on success, false when zero rows affected)', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      const success = await repository.recoverPendingJob('job-2');
      expect(success).toBe(true);

      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      const failed = await repository.recoverPendingJob('job-2');
      expect(failed).toBe(false);
    });

    it('should update job lease atomically (returning true for matching worker & RUNNING status, false otherwise)', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      const success = await repository.updateJobLease('job-3', 'worker-1');
      expect(success).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('worker_id = $2'), [
        'job-3',
        'worker-1',
      ]);

      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      const failed = await repository.updateJobLease('job-3', 'wrong-worker');
      expect(failed).toBe(false);
    });
  });
});
