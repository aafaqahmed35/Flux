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
    next_retry_at: null,
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
});
