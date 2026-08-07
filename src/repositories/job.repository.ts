import pg from 'pg';
import { DEFAULT_PAGINATION, JobPriority, JobStatus } from '../constants/job.constants.js';
import { pgPool } from '../database/postgres.js';
import { validateStatusTransition } from '../domain/job.state.js';
import { validateCreateJobRequest } from '../domain/job.validator.js';
import { DuplicateJobError } from '../errors/DuplicateJobError.js';
import { InvalidJobStateError } from '../errors/InvalidJobStateError.js';
import { JobNotFoundError } from '../errors/JobNotFoundError.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import {
  CountJobsOptions,
  CreateJobRequest,
  Job,
  ListJobsOptions,
  PaginatedJobsResult,
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
  next_retry_at: Date | null;
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
      nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at) : null,
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
        appLogger.info('Duplicate job creation suppressed by idempotency key', {
          queueName: validated.queueName,
          idempotencyKey: validated.idempotencyKey,
          existingJobId: existing.id,
        });
        throw new DuplicateJobError(
          `Job with idempotency key '${validated.idempotencyKey}' already exists in queue '${validated.queueName}'`,
          { existingJobId: existing.id },
        );
      }
    }

    const initialStatus =
      validated.scheduledFor || validated.delayUntil ? JobStatus.DELAYED : JobStatus.PENDING;

    const sql = `
      INSERT INTO jobs (
        name,
        queue_name,
        idempotency_key,
        payload,
        metadata,
        status,
        priority,
        max_retries,
        retry_delay,
        scheduled_for,
        delay_until
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const values = [
      validated.name,
      validated.queueName,
      validated.idempotencyKey ?? null,
      JSON.stringify(validated.payload ?? {}),
      JSON.stringify(validated.metadata ?? {}),
      initialStatus,
      validated.priority ?? JobPriority.NORMAL,
      validated.maxRetries ?? 3,
      validated.retryDelay ?? 1000,
      validated.scheduledFor ?? null,
      validated.delayUntil ?? null,
    ];

    try {
      const result = await this.pool.query<DatabaseJobRow>(sql, values);
      const row = result.rows[0];
      if (!row) {
        throw new Error('Failed to insert job into database');
      }
      const job = this.mapRowToJob(row);

      appLogger.info('Job created successfully', {
        jobId: job.id,
        name: job.name,
        queueName: job.queueName,
        status: job.status,
        priority: job.priority,
      });

      return job;
    } catch (err: unknown) {
      if (err instanceof pg.DatabaseError && err.code === '23505') {
        throw new DuplicateJobError(
          `Job with idempotency key '${validated.idempotencyKey}' already exists in queue '${validated.queueName}'`,
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error(
        `Failed to create job '${validated.name}' in queue '${validated.queueName}': ${msg}`,
      );
      throw err;
    }
  }

  async findById(id: string, includeDeleted = false): Promise<Job | null> {
    const sql = includeDeleted
      ? 'SELECT * FROM jobs WHERE id = $1'
      : 'SELECT * FROM jobs WHERE id = $1 AND is_deleted = FALSE';
    const result = await this.pool.query<DatabaseJobRow>(sql, [id]);
    const row = result.rows[0];
    return row ? this.mapRowToJob(row) : null;
  }

  async findByIdempotencyKey(queueName: string, idempotencyKey: string): Promise<Job | null> {
    const sql =
      'SELECT * FROM jobs WHERE queue_name = $1 AND idempotency_key = $2 AND is_deleted = FALSE';
    const result = await this.pool.query<DatabaseJobRow>(sql, [queueName, idempotencyKey]);
    const row = result.rows[0];
    return row ? this.mapRowToJob(row) : null;
  }

  async findByStatus(status: JobStatus, options?: Partial<ListJobsOptions>): Promise<Job[]> {
    const limit = options?.limit ?? DEFAULT_PAGINATION.limit;
    const offset = options?.offset ?? DEFAULT_PAGINATION.offset;
    const sql =
      'SELECT * FROM jobs WHERE status = $1 AND is_deleted = FALSE ORDER BY created_at DESC LIMIT $2 OFFSET $3';
    const result = await this.pool.query<DatabaseJobRow>(sql, [status, limit, offset]);
    return result.rows.map((row) => this.mapRowToJob(row));
  }

  async findByQueue(queueName: string, options?: Partial<ListJobsOptions>): Promise<Job[]> {
    const limit = options?.limit ?? DEFAULT_PAGINATION.limit;
    const offset = options?.offset ?? DEFAULT_PAGINATION.offset;
    const sql =
      'SELECT * FROM jobs WHERE queue_name = $1 AND is_deleted = FALSE ORDER BY created_at DESC LIMIT $2 OFFSET $3';
    const result = await this.pool.query<DatabaseJobRow>(sql, [queueName, limit, offset]);
    return result.rows.map((row) => this.mapRowToJob(row));
  }

  async findReadyJobs(queueName?: string, limit = 10): Promise<Job[]> {
    let sql = `
      SELECT * FROM jobs
      WHERE status IN ('PENDING', 'QUEUED')
        AND is_deleted = FALSE
        AND (scheduled_for IS NULL OR scheduled_for <= NOW())
        AND (delay_until IS NULL OR delay_until <= NOW())
    `;
    const values: unknown[] = [];

    if (queueName) {
      values.push(queueName);
      sql += ` AND queue_name = $${values.length}`;
    }

    sql += `
      ORDER BY
        CASE priority
          WHEN 'CRITICAL' THEN 1
          WHEN 'HIGH' THEN 2
          WHEN 'NORMAL' THEN 3
          WHEN 'LOW' THEN 4
          ELSE 5
        END ASC,
        created_at ASC
    `;

    values.push(limit);
    sql += ` LIMIT $${values.length}`;

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
        `Failed to update status for job '${id}'. Optimistic locking collision or concurrent modification detected.`,
        { jobId: id, expectedVersion: existing.version },
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

    if (retryData.errorMessage !== undefined) {
      addClause('error_message', retryData.errorMessage);
    }
    if (retryData.errorStack !== undefined) {
      addClause('error_stack', retryData.errorStack);
    }
    if (retryData.failureReason !== undefined) {
      addClause('failure_reason', retryData.failureReason);
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
        `Failed to update execution metadata for job '${id}'. Optimistic locking collision detected.`,
        { jobId: id, expectedVersion: existing.version },
      );
    }

    const updated = this.mapRowToJob(row);

    appLogger.info('Job execution metadata updated', {
      jobId: id,
      attempts: updated.attempts,
      workerId: updated.workerId,
    });

    return updated;
  }

  async cancelJob(id: string, reason = 'Job cancelled by request'): Promise<Job> {
    return this.updateStatus(id, JobStatus.CANCELLED, {
      failureReason: reason,
      failedAt: new Date(),
    });
  }

  async deleteJob(id: string): Promise<boolean> {
    const sql =
      'UPDATE jobs SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND is_deleted = FALSE';
    const result = await this.pool.query(sql, [id]);
    const deleted = (result.rowCount ?? 0) > 0;
    if (deleted) {
      appLogger.info('Job soft-deleted successfully', { jobId: id });
    }
    return deleted;
  }

  async exists(id: string): Promise<boolean> {
    const sql = 'SELECT 1 FROM jobs WHERE id = $1 AND is_deleted = FALSE';
    const result = await this.pool.query(sql, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async count(options?: CountJobsOptions): Promise<number> {
    let sql = 'SELECT COUNT(*)::int AS total FROM jobs WHERE 1=1';
    const values: unknown[] = [];

    if (!options?.includeDeleted) {
      sql += ' AND is_deleted = FALSE';
    }

    if (options?.queueName) {
      values.push(options.queueName);
      sql += ` AND queue_name = $${values.length}`;
    }
    if (options?.status) {
      values.push(options.status);
      sql += ` AND status = $${values.length}`;
    }
    if (options?.priority) {
      values.push(options.priority);
      sql += ` AND priority = $${values.length}`;
    }
    if (options?.workerId) {
      values.push(options.workerId);
      sql += ` AND worker_id = $${values.length}`;
    }
    if (options?.createdAfter) {
      values.push(options.createdAfter);
      sql += ` AND created_at >= $${values.length}`;
    }
    if (options?.createdBefore) {
      values.push(options.createdBefore);
      sql += ` AND created_at <= $${values.length}`;
    }
    if (options?.scheduledAfter) {
      values.push(options.scheduledAfter);
      sql += ` AND scheduled_for >= $${values.length}`;
    }
    if (options?.scheduledBefore) {
      values.push(options.scheduledBefore);
      sql += ` AND scheduled_for <= $${values.length}`;
    }

    const result = await this.pool.query<{ total: number }>(sql, values);
    return Number(result.rows[0]?.total ?? 0);
  }

  async countByStatus(queueName?: string): Promise<Record<JobStatus, number>> {
    let sql = 'SELECT status, COUNT(*)::int AS count FROM jobs WHERE is_deleted = FALSE';
    const values: unknown[] = [];

    if (queueName) {
      values.push(queueName);
      sql += ` AND queue_name = $1`;
    }

    sql += ' GROUP BY status';

    const result = await this.pool.query<{ status: string; count: number }>(sql, values);
    const counts: Record<JobStatus, number> = {
      [JobStatus.PENDING]: 0,
      [JobStatus.QUEUED]: 0,
      [JobStatus.RUNNING]: 0,
      [JobStatus.COMPLETED]: 0,
      [JobStatus.FAILED]: 0,
      [JobStatus.RETRYING]: 0,
      [JobStatus.CANCELLED]: 0,
      [JobStatus.DELAYED]: 0,
    };

    result.rows.forEach((row) => {
      if (row.status in counts) {
        counts[row.status as JobStatus] = Number(row.count);
      }
    });

    return counts;
  }

  async listJobs(options?: ListJobsOptions): Promise<PaginatedJobsResult> {
    const limit = Math.min(options?.limit ?? DEFAULT_PAGINATION.limit, DEFAULT_PAGINATION.maxLimit);
    const offset = options?.offset ?? DEFAULT_PAGINATION.offset;
    const orderBy = options?.orderBy ?? 'createdAt';
    const orderDirection = options?.orderDirection ?? 'DESC';

    const columnMap: Record<string, string> = {
      createdAt: 'created_at',
      priority: 'priority',
      status: 'status',
      scheduledFor: 'scheduled_for',
    };

    const sortColumn = columnMap[orderBy] ?? 'created_at';

    let whereSql = 'WHERE 1=1';
    const values: unknown[] = [];

    if (!options?.includeDeleted) {
      whereSql += ' AND is_deleted = FALSE';
    }

    if (options?.queueName) {
      values.push(options.queueName);
      whereSql += ` AND queue_name = $${values.length}`;
    }
    if (options?.status) {
      values.push(options.status);
      whereSql += ` AND status = $${values.length}`;
    }
    if (options?.priority) {
      values.push(options.priority);
      whereSql += ` AND priority = $${values.length}`;
    }
    if (options?.workerId) {
      values.push(options.workerId);
      whereSql += ` AND worker_id = $${values.length}`;
    }
    if (options?.createdAfter) {
      values.push(options.createdAfter);
      whereSql += ` AND created_at >= $${values.length}`;
    }
    if (options?.createdBefore) {
      values.push(options.createdBefore);
      whereSql += ` AND created_at <= $${values.length}`;
    }
    if (options?.scheduledAfter) {
      values.push(options.scheduledAfter);
      whereSql += ` AND scheduled_for >= $${values.length}`;
    }
    if (options?.scheduledBefore) {
      values.push(options.scheduledBefore);
      whereSql += ` AND scheduled_for <= $${values.length}`;
    }

    const countSql = `SELECT COUNT(*)::int AS total FROM jobs ${whereSql}`;
    const countResult = await this.pool.query<{ total: number }>(countSql, values);
    const total = Number(countResult.rows[0]?.total ?? 0);

    const queryValues = [...values, limit, offset];
    const dataSql = `
      SELECT * FROM jobs
      ${whereSql}
      ORDER BY ${sortColumn} ${orderDirection}
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `;

    const dataResult = await this.pool.query<DatabaseJobRow>(dataSql, queryValues);
    const jobs = dataResult.rows.map((row) => this.mapRowToJob(row));

    return {
      jobs,
      total,
      limit,
      offset,
    };
  }
}

export const jobRepository = new PostgresJobRepository();
