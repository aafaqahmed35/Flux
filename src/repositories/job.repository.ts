import pg from 'pg';
import { DEFAULT_PAGINATION, JobPriority, JobStatus } from '../constants/job.constants.js';
import { pgPool } from '../database/postgres.js';
import { validateStatusTransition } from '../domain/job.state.js';
import { validateCreateJobRequest } from '../domain/job.validator.js';
import { DuplicateJobError } from '../errors/DuplicateJobError.js';
import { InvalidJobStateError } from '../errors/InvalidJobStateError.js';
import { JobNotFoundError } from '../errors/JobNotFoundError.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { RetryStrategy } from '../retry/retry.constants.js';
import {
  CountJobsOptions,
  CreateJobRequest,
  CreateRetryHistoryRecordInput,
  Job,
  ListJobsOptions,
  PaginatedJobsResult,
  RetryHistoryRecord,
  UpdateExecutionMetadataInput,
  UpdateJobRequest,
  UpdateRetryInput,
} from '../types/job.types.js';
import { IJobRepository } from './job.repository.interface.js';

export interface DatabaseJobRow {
  id: string;
  name: string;
  queue_name: string;
  idempotency_key: string | null;
  worker_id: string | null;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: string;
  priority: string;
  retry_count: number;
  max_retries: number;
  retry_delay: number;
  retry_strategy: string;
  next_retry_at: Date | null;
  last_retry_at: Date | null;
  last_failure_type: string | null;
  last_failure_code: string | null;
  dead_lettered_at: Date | null;
  dead_letter_reason: string | null;
  scheduled_for: Date | null;
  delay_until: Date | null;
  attempts: number;
  version: number;
  created_at: Date;
  updated_at: Date;
  locked_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  failed_at: Date | null;
  execution_time_ms: number | null;
  error_message: string | null;
  error_stack: string | null;
  failure_reason: string | null;
  is_deleted: boolean;
  deleted_at: Date | null;
}

interface DatabaseRetryHistoryRow {
  id: string;
  job_id: string;
  attempt: number | string;
  strategy: RetryStrategy;
  delay_ms: number | string;
  scheduled_at: Date | string | null;
  started_at: Date | string | null;
  failed_at: Date | string | null;
  completed_at: Date | string | null;
  failure_reason: string | null;
  failure_code: string | null;
  worker_id: string | null;
  created_at: Date | string;
}

export class PostgresJobRepository implements IJobRepository {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool = pgPool) {
    this.pool = pool;
  }

  private mapRowToJob(row: DatabaseJobRow): Job {
    return {
      id: row.id,
      name: row.name,
      queueName: row.queue_name,
      idempotencyKey: row.idempotency_key,
      workerId: row.worker_id,
      payload: row.payload ?? {},
      metadata: row.metadata ?? {},
      status: row.status as JobStatus,
      priority: row.priority as JobPriority,
      retryCount: Number(row.retry_count),
      maxRetries: Number(row.max_retries),
      retryDelay: Number(row.retry_delay),
      retryStrategy: (row.retry_strategy as RetryStrategy) || RetryStrategy.EXPONENTIAL_WITH_JITTER,
      nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at) : null,
      lastRetryAt: row.last_retry_at ? new Date(row.last_retry_at) : null,
      lastFailureType: row.last_failure_type ?? null,
      lastFailureCode: row.last_failure_code ?? null,
      deadLetteredAt: row.dead_lettered_at ? new Date(row.dead_lettered_at) : null,
      deadLetterReason: row.dead_letter_reason ?? null,
      scheduledFor: row.scheduled_for ? new Date(row.scheduled_for) : null,
      delayUntil: row.delay_until ? new Date(row.delay_until) : null,
      attempts: Number(row.attempts),
      version: Number(row.version),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lockedAt: row.locked_at ? new Date(row.locked_at) : null,
      startedAt: row.started_at ? new Date(row.started_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      failedAt: row.failed_at ? new Date(row.failed_at) : null,
      executionTimeMs: row.execution_time_ms !== null ? Number(row.execution_time_ms) : null,
      errorMessage: row.error_message,
      errorStack: row.error_stack,
      failureReason: row.failure_reason,
      isDeleted: Boolean(row.is_deleted),
      deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    };
  }

  async createJob(rawRequest: CreateJobRequest): Promise<Job> {
    const validated = validateCreateJobRequest(rawRequest);

    if (validated.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(
        validated.queueName,
        validated.idempotencyKey,
      );
      if (existing) {
        throw new DuplicateJobError(validated.queueName, validated.idempotencyKey);
      }
    }

    const sql = `
      INSERT INTO jobs (
        name, queue_name, payload, metadata, priority, max_retries, retry_delay, retry_strategy,
        scheduled_for, delay_until, idempotency_key, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING')
      RETURNING *
    `;

    const values = [
      validated.name,
      validated.queueName,
      JSON.stringify(validated.payload ?? {}),
      JSON.stringify(validated.metadata ?? {}),
      validated.priority,
      validated.maxRetries,
      validated.retryDelay,
      validated.retryStrategy ?? RetryStrategy.EXPONENTIAL_WITH_JITTER,
      validated.scheduledFor ?? null,
      validated.delayUntil ?? null,
      validated.idempotencyKey ?? null,
    ];

    try {
      const result = await this.pool.query<DatabaseJobRow>(sql, values);
      const row = result.rows[0];
      if (!row) {
        throw new Error('Database failed to return inserted job row');
      }
      const createdJob = this.mapRowToJob(row);

      appLogger.info('Job created in PostgreSQL', {
        jobId: createdJob.id,
        name: createdJob.name,
        queueName: createdJob.queueName,
        status: createdJob.status,
      });

      return createdJob;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new DuplicateJobError(
          validated.queueName,
          validated.idempotencyKey || 'concurrent_duplicate',
        );
      }
      errorLogger.error('Failed to create job in PostgreSQL', { error, rawRequest });
      throw error;
    }
  }

  async findById(id: string): Promise<Job | null> {
    const sql = `SELECT * FROM jobs WHERE id = $1 AND is_deleted = FALSE`;
    const result = await this.pool.query<DatabaseJobRow>(sql, [id]);
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return this.mapRowToJob(row);
  }

  async findByIdempotencyKey(queueName: string, idempotencyKey: string): Promise<Job | null> {
    const sql = `
      SELECT * FROM jobs 
      WHERE queue_name = $1 AND idempotency_key = $2 AND is_deleted = FALSE
    `;
    const result = await this.pool.query<DatabaseJobRow>(sql, [queueName, idempotencyKey]);
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return this.mapRowToJob(row);
  }

  async findByStatus(status: JobStatus, options: Partial<ListJobsOptions> = {}): Promise<Job[]> {
    const limit = options.limit ?? DEFAULT_PAGINATION.limit;
    const offset = options.offset ?? DEFAULT_PAGINATION.offset;

    let sql = `SELECT * FROM jobs WHERE status = $1 AND is_deleted = FALSE`;
    const values: unknown[] = [status];

    if (options.queueName) {
      values.push(options.queueName);
      sql += ` AND queue_name = $${values.length}`;
    }

    values.push(limit, offset);
    sql += ` ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`;

    const result = await this.pool.query<DatabaseJobRow>(sql, values);
    return result.rows.map((row) => this.mapRowToJob(row));
  }

  async findByQueue(queueName: string, options: Partial<ListJobsOptions> = {}): Promise<Job[]> {
    return this.findByStatus(options.status ?? JobStatus.QUEUED, { ...options, queueName });
  }

  async findReadyJobs(queueName?: string, limit = 10): Promise<Job[]> {
    let sql = `
      SELECT * FROM jobs 
      WHERE status = 'QUEUED'
        AND is_deleted = FALSE
        AND (scheduled_for IS NULL OR scheduled_for <= NOW())
        AND (delay_until IS NULL OR delay_until <= NOW())
    `;
    const values: unknown[] = [];

    if (queueName) {
      values.push(queueName);
      sql += ` AND queue_name = $${values.length}`;
    }

    values.push(limit);
    sql += ` ORDER BY 
      CASE priority
        WHEN 'CRITICAL' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'NORMAL' THEN 3
        WHEN 'LOW' THEN 4
        ELSE 5
      END ASC, created_at ASC LIMIT $${values.length}`;

    const result = await this.pool.query<DatabaseJobRow>(sql, values);
    return result.rows.map((row) => this.mapRowToJob(row));
  }

  async findScheduledJobs(beforeDate: Date = new Date(), limit = 50): Promise<Job[]> {
    const sql = `
      SELECT * FROM jobs
      WHERE (status = 'DELAYED' OR scheduled_for IS NOT NULL)
        AND is_deleted = FALSE
        AND (
          (scheduled_for IS NOT NULL AND scheduled_for <= $1)
          OR (delay_until IS NOT NULL AND delay_until <= $1)
        )
      ORDER BY COALESCE(scheduled_for, delay_until, created_at) ASC
      LIMIT $2
    `;
    const result = await this.pool.query<DatabaseJobRow>(sql, [beforeDate, limit]);
    return result.rows.map((row) => this.mapRowToJob(row));
  }

  async findDueRetries(limit = 100): Promise<Job[]> {
    const sql = `
      SELECT * FROM jobs
      WHERE status = 'RETRYING'
        AND is_deleted = FALSE
        AND next_retry_at IS NOT NULL
        AND next_retry_at <= NOW()
      ORDER BY next_retry_at ASC
      LIMIT $1
    `;
    const result = await this.pool.query<DatabaseJobRow>(sql, [limit]);
    return result.rows.map((row) => this.mapRowToJob(row));
  }

  async updateStatus(
    id: string,
    newStatus: JobStatus,
    additionalData?: Partial<UpdateJobRequest>,
  ): Promise<Job> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new JobNotFoundError(id);
    }

    validateStatusTransition(existing.status, newStatus);

    const now = new Date();
    const setClauses: string[] = ['status = $1', 'version = version + 1', 'updated_at = NOW()'];
    const values: unknown[] = [newStatus];

    const addClause = (column: string, val: unknown): void => {
      values.push(val);
      setClauses.push(`${column} = $${values.length}`);
    };

    if (newStatus === JobStatus.RUNNING && !additionalData?.startedAt) {
      addClause('started_at', now);
    } else if (additionalData?.startedAt !== undefined) {
      addClause('started_at', additionalData.startedAt);
    }

    if (newStatus === JobStatus.COMPLETED && !additionalData?.completedAt) {
      addClause('completed_at', now);
    } else if (additionalData?.completedAt !== undefined) {
      addClause('completed_at', additionalData.completedAt);
    }

    if (newStatus === JobStatus.FAILED && !additionalData?.failedAt) {
      addClause('failed_at', now);
    } else if (additionalData?.failedAt !== undefined) {
      addClause('failed_at', additionalData.failedAt);
    }

    if (newStatus === JobStatus.DEAD_LETTER && !additionalData?.deadLetteredAt) {
      addClause('dead_lettered_at', now);
    } else if (additionalData?.deadLetteredAt !== undefined) {
      addClause('dead_lettered_at', additionalData.deadLetteredAt);
    }

    if (additionalData?.workerId !== undefined) {
      addClause('worker_id', additionalData.workerId);
    }
    if (additionalData?.lockedAt !== undefined) {
      addClause('locked_at', additionalData.lockedAt);
    }
    if (additionalData?.executionTimeMs !== undefined) {
      addClause('execution_time_ms', additionalData.executionTimeMs);
    }
    if (additionalData?.errorMessage !== undefined) {
      addClause('error_message', additionalData.errorMessage);
    }
    if (additionalData?.errorStack !== undefined) {
      addClause('error_stack', additionalData.errorStack);
    }
    if (additionalData?.failureReason !== undefined) {
      addClause('failure_reason', additionalData.failureReason);
    }
    if (additionalData?.deadLetterReason !== undefined) {
      addClause('dead_letter_reason', additionalData.deadLetterReason);
    }
    if (additionalData?.lastFailureType !== undefined) {
      addClause('last_failure_type', additionalData.lastFailureType);
    }
    if (additionalData?.lastFailureCode !== undefined) {
      addClause('last_failure_code', additionalData.lastFailureCode);
    }

    values.push(id);
    const idParamIndex = values.length;

    let sql = '';
    if (additionalData?.expectedVersion !== undefined) {
      values.push(additionalData.expectedVersion);
      const versionParamIndex = values.length;
      sql = `
        UPDATE jobs
        SET ${setClauses.join(', ')}
        WHERE id = $${idParamIndex} AND version = $${versionParamIndex} AND is_deleted = FALSE
        RETURNING *
      `;
    } else {
      sql = `
        UPDATE jobs
        SET ${setClauses.join(', ')}
        WHERE id = $${idParamIndex} AND is_deleted = FALSE
        RETURNING *
      `;
    }

    const result = await this.pool.query<DatabaseJobRow>(sql, values);
    const row = result.rows[0];

    if (!row) {
      throw new InvalidJobStateError(
        `Failed to update status for job '${id}'. Optimistic locking collision or job not found.`,
        { jobId: id, expectedVersion: additionalData?.expectedVersion ?? existing.version },
      );
    }

    const updatedJob = this.mapRowToJob(row);

    appLogger.info('Job status updated', {
      jobId: id,
      fromStatus: existing.status,
      toStatus: newStatus,
      version: updatedJob.version,
    });

    return updatedJob;
  }

  async updateRetry(id: string, retryData: UpdateRetryInput): Promise<Job> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new JobNotFoundError(id);
    }

    const newStatus = retryData.status ?? JobStatus.RETRYING;
    validateStatusTransition(existing.status, newStatus);

    const setClauses: string[] = [
      'retry_count = $1',
      'next_retry_at = $2',
      'status = $3',
      'version = version + 1',
      'updated_at = NOW()',
    ];
    const values: unknown[] = [retryData.retryCount, retryData.nextRetryAt ?? null, newStatus];

    const addClause = (column: string, val: unknown): void => {
      values.push(val);
      setClauses.push(`${column} = $${values.length}`);
    };

    if (retryData.lastRetryAt !== undefined) {
      addClause('last_retry_at', retryData.lastRetryAt);
    }
    if (retryData.errorMessage !== undefined) {
      addClause('error_message', retryData.errorMessage);
    }
    if (retryData.errorStack !== undefined) {
      addClause('error_stack', retryData.errorStack);
    }
    if (retryData.failureReason !== undefined) {
      addClause('failure_reason', retryData.failureReason);
    }
    if (retryData.lastFailureType !== undefined) {
      addClause('last_failure_type', retryData.lastFailureType);
    }
    if (retryData.lastFailureCode !== undefined) {
      addClause('last_failure_code', retryData.lastFailureCode);
    }
    if (retryData.deadLetteredAt !== undefined) {
      addClause('dead_lettered_at', retryData.deadLetteredAt);
    }
    if (retryData.deadLetterReason !== undefined) {
      addClause('dead_letter_reason', retryData.deadLetterReason);
    }

    values.push(id);
    const idParamIndex = values.length;
    values.push(existing.version);
    const versionParamIndex = values.length;

    const sql = `
      UPDATE jobs
      SET ${setClauses.join(', ')}
      WHERE id = $${idParamIndex} AND version = $${versionParamIndex} AND is_deleted = FALSE
      RETURNING *
    `;

    const result = await this.pool.query<DatabaseJobRow>(sql, values);
    const row = result.rows[0];

    if (!row) {
      throw new InvalidJobStateError(
        `Failed to update retry state for job '${id}'. Optimistic locking collision detected.`,
        { jobId: id, expectedVersion: existing.version },
      );
    }

    const updated = this.mapRowToJob(row);

    appLogger.info('Job retry updated', {
      jobId: id,
      retryCount: updated.retryCount,
      nextRetryAt: updated.nextRetryAt,
      status: updated.status,
    });

    return updated;
  }

  async updateExecutionMetadata(id: string, metadata: UpdateExecutionMetadataInput): Promise<Job> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new JobNotFoundError(id);
    }

    const setClauses: string[] = ['version = version + 1', 'updated_at = NOW()'];
    const values: unknown[] = [];

    const addClause = (column: string, val: unknown): void => {
      values.push(val);
      setClauses.push(`${column} = $${values.length}`);
    };

    if (metadata.attempts !== undefined) {
      addClause('attempts', metadata.attempts);
    }
    if (metadata.workerId !== undefined) {
      addClause('worker_id', metadata.workerId);
    }
    if (metadata.lockedAt !== undefined) {
      addClause('locked_at', metadata.lockedAt);
    }
    if (metadata.startedAt !== undefined) {
      addClause('started_at', metadata.startedAt);
    }
    if (metadata.completedAt !== undefined) {
      addClause('completed_at', metadata.completedAt);
    }
    if (metadata.failedAt !== undefined) {
      addClause('failed_at', metadata.failedAt);
    }
    if (metadata.executionTimeMs !== undefined) {
      addClause('execution_time_ms', metadata.executionTimeMs);
    }
    if (metadata.errorMessage !== undefined) {
      addClause('error_message', metadata.errorMessage);
    }
    if (metadata.errorStack !== undefined) {
      addClause('error_stack', metadata.errorStack);
    }
    if (metadata.failureReason !== undefined) {
      addClause('failure_reason', metadata.failureReason);
    }
    if (metadata.metadata !== undefined) {
      addClause('metadata', JSON.stringify(metadata.metadata));
    }

    values.push(id);
    const idParamIndex = values.length;
    values.push(existing.version);
    const versionParamIndex = values.length;

    const sql = `
      UPDATE jobs
      SET ${setClauses.join(', ')}
      WHERE id = $${idParamIndex} AND version = $${versionParamIndex} AND is_deleted = FALSE
      RETURNING *
    `;

    const result = await this.pool.query<DatabaseJobRow>(sql, values);
    const row = result.rows[0];

    if (!row) {
      throw new InvalidJobStateError(
        `Failed to update execution metadata for job '${id}'. Concurrent modification detected.`,
        { jobId: id, expectedVersion: existing.version },
      );
    }

    return this.mapRowToJob(row);
  }

  async addRetryHistoryRecord(input: CreateRetryHistoryRecordInput): Promise<RetryHistoryRecord> {
    const sql = `
      INSERT INTO job_retry_history (
        job_id, attempt, strategy, delay_ms, scheduled_at, started_at, failed_at, completed_at,
        failure_reason, failure_code, worker_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const values = [
      input.jobId,
      input.attempt,
      input.strategy,
      input.delayMs,
      input.scheduledAt ?? null,
      input.startedAt ?? null,
      input.failedAt ?? null,
      input.completedAt ?? null,
      input.failureReason ?? null,
      input.failureCode ?? null,
      input.workerId ?? null,
    ];
    const result = await this.pool.query<DatabaseRetryHistoryRow>(sql, values);
    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to insert retry history record');
    }
    return {
      id: row.id,
      jobId: row.job_id,
      attempt: Number(row.attempt),
      strategy: row.strategy,
      delayMs: Number(row.delay_ms),
      scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
      startedAt: row.started_at ? new Date(row.started_at) : null,
      failedAt: row.failed_at ? new Date(row.failed_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      failureReason: row.failure_reason,
      failureCode: row.failure_code,
      workerId: row.worker_id,
      createdAt: new Date(row.created_at),
    };
  }

  async getJobRetryHistory(jobId: string): Promise<RetryHistoryRecord[]> {
    const sql = `
      SELECT * FROM job_retry_history
      WHERE job_id = $1
      ORDER BY attempt ASC
    `;

    const result = await this.pool.query<DatabaseRetryHistoryRow>(sql, [jobId]);
    return result.rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      attempt: Number(row.attempt),
      strategy: row.strategy,
      delayMs: Number(row.delay_ms),
      scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
      startedAt: row.started_at ? new Date(row.started_at) : null,
      failedAt: row.failed_at ? new Date(row.failed_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      failureReason: row.failure_reason,
      failureCode: row.failure_code,
      workerId: row.worker_id,
      createdAt: new Date(row.created_at),
    }));
  }

  async cancelJob(id: string, reason = 'Cancelled by user'): Promise<Job> {
    return this.updateStatus(id, JobStatus.CANCELLED, {
      failureReason: reason,
    });
  }

  async deleteJob(id: string): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) {
      return false;
    }

    const sql = `
      UPDATE jobs
      SET is_deleted = TRUE, deleted_at = NOW(), version = version + 1, updated_at = NOW()
      WHERE id = $1 AND is_deleted = FALSE
    `;
    const result = await this.pool.query(sql, [id]);
    const deleted = (result.rowCount ?? 0) > 0;
    if (deleted) {
      appLogger.info('Job soft-deleted successfully', { jobId: id });
    }
    return deleted;
  }

  async exists(id: string): Promise<boolean> {
    const sql = `SELECT 1 FROM jobs WHERE id = $1 AND is_deleted = FALSE`;
    const result = await this.pool.query(sql, [id]);
    return result.rows.length > 0;
  }

  async count(options: CountJobsOptions = {}): Promise<number> {
    let sql = `SELECT COUNT(*) AS total FROM jobs WHERE is_deleted = FALSE`;
    const values: unknown[] = [];

    if (options.queueName) {
      values.push(options.queueName);
      sql += ` AND queue_name = $${values.length}`;
    }
    if (options.status) {
      values.push(options.status);
      sql += ` AND status = $${values.length}`;
    }
    if (options.priority) {
      values.push(options.priority);
      sql += ` AND priority = $${values.length}`;
    }
    if (options.workerId) {
      values.push(options.workerId);
      sql += ` AND worker_id = $${values.length}`;
    }
    if (options.createdAfter) {
      values.push(options.createdAfter);
      sql += ` AND created_at >= $${values.length}`;
    }
    if (options.createdBefore) {
      values.push(options.createdBefore);
      sql += ` AND created_at <= $${values.length}`;
    }
    if (options.scheduledAfter) {
      values.push(options.scheduledAfter);
      sql += ` AND scheduled_for >= $${values.length}`;
    }
    if (options.scheduledBefore) {
      values.push(options.scheduledBefore);
      sql += ` AND scheduled_for <= $${values.length}`;
    }

    const result = await this.pool.query<{ total: string }>(sql, values);
    const firstRow = result.rows[0];
    return firstRow ? parseInt(firstRow.total, 10) : 0;
  }

  async countByStatus(queueName?: string): Promise<Record<JobStatus, number>> {
    let sql = `
      SELECT status, COUNT(*) AS count 
      FROM jobs 
      WHERE is_deleted = FALSE
    `;
    const values: unknown[] = [];

    if (queueName) {
      values.push(queueName);
      sql += ` AND queue_name = $1`;
    }

    sql += ` GROUP BY status`;

    const result = await this.pool.query<{ status: string; count: string }>(sql, values);

    const counts: Record<JobStatus, number> = {
      [JobStatus.PENDING]: 0,
      [JobStatus.QUEUED]: 0,
      [JobStatus.CLAIMED]: 0,
      [JobStatus.RUNNING]: 0,
      [JobStatus.COMPLETED]: 0,
      [JobStatus.FAILED]: 0,
      [JobStatus.RETRYING]: 0,
      [JobStatus.CANCELLED]: 0,
      [JobStatus.DELAYED]: 0,
      [JobStatus.DEAD_LETTER]: 0,
    };

    result.rows.forEach((row) => {
      if (row.status in counts) {
        counts[row.status as JobStatus] = parseInt(row.count, 10);
      }
    });

    return counts;
  }

  async listJobs(options: ListJobsOptions = {}): Promise<PaginatedJobsResult> {
    const limit = Math.min(options.limit ?? DEFAULT_PAGINATION.limit, DEFAULT_PAGINATION.maxLimit);
    const offset = options.offset ?? DEFAULT_PAGINATION.offset;
    const orderBy = options.orderBy ?? 'createdAt';
    const orderDirection = options.orderDirection ?? 'DESC';

    const colMap: Record<string, string> = {
      createdAt: 'created_at',
      priority: 'priority',
      status: 'status',
      scheduledFor: 'scheduled_for',
    };
    const dbOrderCol = colMap[orderBy] || 'created_at';

    const whereConditions: string[] = [];
    const values: unknown[] = [];

    if (!options.includeDeleted) {
      whereConditions.push('is_deleted = FALSE');
    }
    if (options.queueName) {
      values.push(options.queueName);
      whereConditions.push(`queue_name = $${values.length}`);
    }
    if (options.status) {
      values.push(options.status);
      whereConditions.push(`status = $${values.length}`);
    }
    if (options.priority) {
      values.push(options.priority);
      whereConditions.push(`priority = $${values.length}`);
    }
    if (options.workerId) {
      values.push(options.workerId);
      whereConditions.push(`worker_id = $${values.length}`);
    }
    if (options.createdAfter) {
      values.push(options.createdAfter);
      whereConditions.push(`created_at >= $${values.length}`);
    }
    if (options.createdBefore) {
      values.push(options.createdBefore);
      whereConditions.push(`created_at <= $${values.length}`);
    }
    if (options.scheduledAfter) {
      values.push(options.scheduledAfter);
      whereConditions.push(`scheduled_for >= $${values.length}`);
    }
    if (options.scheduledBefore) {
      values.push(options.scheduledBefore);
      whereConditions.push(`scheduled_for <= $${values.length}`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total FROM jobs ${whereClause}`;
    const countResult = await this.pool.query<{ total: string }>(countSql, values);
    const countRow = countResult.rows[0];
    const total = countRow ? parseInt(countRow.total, 10) : 0;

    values.push(limit, offset);
    const dataSql = `
      SELECT * FROM jobs 
      ${whereClause} 
      ORDER BY ${dbOrderCol} ${orderDirection} 
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `;

    const dataResult = await this.pool.query<DatabaseJobRow>(dataSql, values);
    const jobs = dataResult.rows.map((row) => this.mapRowToJob(row));

    return {
      jobs,
      total,
      limit,
      offset,
    };
  }

  // Recovery operations
  async findStaleRunningJobs(leaseTimeoutMs: number, limit = 100): Promise<Job[]> {
    const cutoff = new Date(Date.now() - leaseTimeoutMs);
    const sql = `
      SELECT * FROM jobs
      WHERE status = 'RUNNING'
        AND is_deleted = FALSE
        AND (locked_at IS NULL OR locked_at <= $1)
      ORDER BY locked_at ASC NULLS FIRST, created_at ASC
      LIMIT $2
    `;
    const result = await this.pool.query<DatabaseJobRow>(sql, [cutoff, Math.max(1, limit)]);
    return result.rows.map((row) => this.mapRowToJob(row));
  }

  async findClaimedJobs(leaseTimeoutMs: number, limit = 100): Promise<Job[]> {
    const cutoff = new Date(Date.now() - leaseTimeoutMs);
    const sql = `
      SELECT * FROM jobs
      WHERE status = 'CLAIMED'
        AND is_deleted = FALSE
        AND (locked_at IS NULL OR locked_at <= $1)
      ORDER BY locked_at ASC NULLS FIRST, created_at ASC
      LIMIT $2
    `;
    const result = await this.pool.query<DatabaseJobRow>(sql, [cutoff, Math.max(1, limit)]);
    return result.rows.map((row) => this.mapRowToJob(row));
  }

  async findRecoverablePendingJobs(staleThresholdMs: number, limit = 100): Promise<Job[]> {
    const cutoff = new Date(Date.now() - staleThresholdMs);
    const sql = `
      SELECT * FROM jobs
      WHERE status = 'PENDING'
        AND is_deleted = FALSE
        AND created_at <= $1
        AND (scheduled_for IS NULL OR scheduled_for <= NOW())
        AND (delay_until IS NULL OR delay_until <= NOW())
      ORDER BY created_at ASC
      LIMIT $2
    `;
    const result = await this.pool.query<DatabaseJobRow>(sql, [cutoff, Math.max(1, limit)]);
    return result.rows.map((row) => this.mapRowToJob(row));
  }

  async findRetryingJobs(limit = 100): Promise<Job[]> {
    const sql = `
      SELECT * FROM jobs
      WHERE status = 'RETRYING'
        AND is_deleted = FALSE
        AND next_retry_at IS NOT NULL
        AND next_retry_at <= NOW()
      ORDER BY next_retry_at ASC, created_at ASC
      LIMIT $1
    `;
    const result = await this.pool.query<DatabaseJobRow>(sql, [Math.max(1, limit)]);
    return result.rows.map((row) => this.mapRowToJob(row));
  }

  async recoverStaleJob(
    jobId: string,
    fromStatus: JobStatus,
    targetStatus: JobStatus,
    reason: string,
  ): Promise<boolean> {
    const isTerminalFailure =
      targetStatus === JobStatus.FAILED || targetStatus === JobStatus.CANCELLED;

    let extraSetClauses = '';
    if (isTerminalFailure) {
      extraSetClauses += `, failed_at = NOW()`;
    }
    if (targetStatus === JobStatus.FAILED) {
      extraSetClauses += `, dead_lettered_at = NOW(), dead_letter_reason = $2`;
    }

    const sql = `
      UPDATE jobs
      SET status = $1,
          failure_reason = $2,
          error_message = $2,
          worker_id = NULL,
          locked_at = NULL,
          version = version + 1,
          updated_at = NOW()
          ${extraSetClauses}
      WHERE id = $3
        AND status = $4
        AND is_deleted = FALSE
    `;

    const result = await this.pool.query(sql, [targetStatus, reason, jobId, fromStatus]);
    return (result.rowCount ?? 0) > 0;
  }

  async recoverPendingJob(jobId: string): Promise<boolean> {
    const sql = `
      UPDATE jobs
      SET status = 'QUEUED',
          version = version + 1,
          updated_at = NOW()
      WHERE id = $1
        AND status = 'PENDING'
        AND is_deleted = FALSE
    `;

    const result = await this.pool.query(sql, [jobId]);
    return (result.rowCount ?? 0) > 0;
  }

  async updateJobLease(jobId: string, workerId: string): Promise<boolean> {
    const sql = `
      UPDATE jobs
      SET locked_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
        AND worker_id = $2
        AND status = 'RUNNING'
        AND is_deleted = FALSE
    `;

    const result = await this.pool.query(sql, [jobId, workerId]);
    return (result.rowCount ?? 0) > 0;
  }
}

export const jobRepository = new PostgresJobRepository();
