import { pgPool } from '../database/postgres.js';
import appLogger from '../logger/logger.js';
import { IScheduleRepository } from './schedule.interface';
import {
  Schedule,
  ScheduleExecutionRecord,
  CreateScheduleInput,
  UpdateScheduleInput,
  ListSchedulesOptions,
  PaginatedSchedulesResult,
} from './schedule.types';

interface ScheduleRow {
  id: string;
  name: string;
  queue_name: string;
  cron_expression: string;
  timezone: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  enabled: boolean;
  next_run_at: string | Date;
  last_run_at?: string | Date | null;
  last_success_at?: string | Date | null;
  last_failure_at?: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface ScheduleExecutionRecordRow {
  id: string;
  schedule_id: string;
  job_id?: string | null;
  started_at: string | Date;
  finished_at?: string | Date | null;
  status: 'SUCCESS' | 'FAILURE' | 'RUNNING';
  execution_time_ms?: number | null;
  worker_id?: string | null;
  error_message?: string | null;
  created_at: string | Date;
}

export class ScheduleRepository implements IScheduleRepository {
  private mapRowToSchedule(row: ScheduleRow): Schedule {
    return {
      id: String(row.id),
      name: String(row.name),
      queueName: String(row.queue_name),
      cronExpression: String(row.cron_expression),
      timezone: String(row.timezone),
      payload: row.payload || {},
      metadata: row.metadata || {},
      enabled: Boolean(row.enabled),
      nextRunAt: new Date(row.next_run_at),
      lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
      lastSuccessAt: row.last_success_at ? new Date(row.last_success_at) : null,
      lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapRowToExecutionRecord(row: ScheduleExecutionRecordRow): ScheduleExecutionRecord {
    return {
      id: String(row.id),
      scheduleId: String(row.schedule_id),
      jobId: row.job_id ? String(row.job_id) : null,
      startedAt: new Date(row.started_at),
      finishedAt: row.finished_at ? new Date(row.finished_at) : null,
      status: row.status,
      executionTimeMs:
        row.execution_time_ms !== null && row.execution_time_ms !== undefined
          ? Number(row.execution_time_ms)
          : null,
      workerId: row.worker_id ? String(row.worker_id) : null,
      errorMessage: row.error_message ? String(row.error_message) : null,
      createdAt: new Date(row.created_at),
    };
  }

  public async createSchedule(input: CreateScheduleInput & { nextRunAt: Date }): Promise<Schedule> {
    const query = `
      INSERT INTO schedules (
        name, queue_name, cron_expression, timezone, payload, metadata, enabled, next_run_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const values = [
      input.name,
      input.queueName,
      input.cronExpression,
      input.timezone || 'UTC',
      JSON.stringify(input.payload || {}),
      JSON.stringify(input.metadata || {}),
      input.enabled !== undefined ? input.enabled : true,
      input.nextRunAt.toISOString(),
    ];

    const result = await pgPool.query<ScheduleRow>(query, values);
    if (!result.rows[0]) {
      throw new Error('Failed to insert schedule');
    }
    appLogger.info('Schedule created in PostgreSQL', {
      scheduleId: result.rows[0].id,
      name: input.name,
    });
    return this.mapRowToSchedule(result.rows[0]);
  }

  public async findById(id: string): Promise<Schedule | null> {
    const result = await pgPool.query<ScheduleRow>('SELECT * FROM schedules WHERE id = $1', [id]);
    if (result.rows.length === 0 || !result.rows[0]) return null;
    return this.mapRowToSchedule(result.rows[0]);
  }

  public async findByName(name: string): Promise<Schedule | null> {
    const result = await pgPool.query<ScheduleRow>('SELECT * FROM schedules WHERE name = $1', [
      name,
    ]);
    if (result.rows.length === 0 || !result.rows[0]) return null;
    return this.mapRowToSchedule(result.rows[0]);
  }

  public async listSchedules(options: ListSchedulesOptions): Promise<PaginatedSchedulesResult> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (options.queueName) {
      conditions.push(`queue_name = $${paramIndex++}`);
      values.push(options.queueName);
    }

    if (options.enabled !== undefined) {
      conditions.push(`enabled = $${paramIndex++}`);
      values.push(options.enabled);
    }

    if (options.search) {
      conditions.push(`name ILIKE $${paramIndex++}`);
      values.push(`%${options.search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*) FROM schedules ${whereClause}`;
    const countResult = await pgPool.query<{ count: string }>(countQuery, values);
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

    const selectQuery = `
      SELECT * FROM schedules
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    const selectResult = await pgPool.query<ScheduleRow>(selectQuery, [...values, limit, offset]);
    const schedules = selectResult.rows.map((row) => this.mapRowToSchedule(row));

    return {
      schedules,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  public async updateSchedule(
    id: string,
    input: UpdateScheduleInput & { nextRunAt?: Date },
  ): Promise<Schedule | null> {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [id];
    let paramIndex = 2;

    if (input.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }

    if (input.queueName !== undefined) {
      setClauses.push(`queue_name = $${paramIndex++}`);
      values.push(input.queueName);
    }

    if (input.cronExpression !== undefined) {
      setClauses.push(`cron_expression = $${paramIndex++}`);
      values.push(input.cronExpression);
    }

    if (input.timezone !== undefined) {
      setClauses.push(`timezone = $${paramIndex++}`);
      values.push(input.timezone);
    }

    if (input.payload !== undefined) {
      setClauses.push(`payload = $${paramIndex++}`);
      values.push(JSON.stringify(input.payload));
    }

    if (input.metadata !== undefined) {
      setClauses.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(input.metadata));
    }

    if (input.enabled !== undefined) {
      setClauses.push(`enabled = $${paramIndex++}`);
      values.push(input.enabled);
    }

    if (input.nextRunAt !== undefined) {
      setClauses.push(`next_run_at = $${paramIndex++}`);
      values.push(input.nextRunAt.toISOString());
    }

    const query = `
      UPDATE schedules
      SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result = await pgPool.query<ScheduleRow>(query, values);
    if (result.rows.length === 0 || !result.rows[0]) return null;
    return this.mapRowToSchedule(result.rows[0]);
  }

  public async deleteSchedule(id: string): Promise<boolean> {
    const result = await pgPool.query('DELETE FROM schedules WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  public async findDueSchedules(limit: number = 50): Promise<Schedule[]> {
    const query = `
      SELECT * FROM schedules
      WHERE enabled = TRUE AND next_run_at <= NOW()
      ORDER BY next_run_at ASC
      LIMIT $1
    `;
    const result = await pgPool.query<ScheduleRow>(query, [limit]);
    return result.rows.map((row) => this.mapRowToSchedule(row));
  }

  public async updateNextRun(
    id: string,
    nextRunAt: Date,
    lastRunAt: Date = new Date(),
  ): Promise<Schedule | null> {
    const query = `
      UPDATE schedules
      SET next_run_at = $2,
          last_run_at = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const result = await pgPool.query<ScheduleRow>(query, [
      id,
      nextRunAt.toISOString(),
      lastRunAt.toISOString(),
    ]);
    if (result.rows.length === 0 || !result.rows[0]) return null;
    return this.mapRowToSchedule(result.rows[0]);
  }

  public async toggleEnabled(id: string, enabled: boolean): Promise<Schedule | null> {
    const query = `
      UPDATE schedules
      SET enabled = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const result = await pgPool.query<ScheduleRow>(query, [id, enabled]);
    if (result.rows.length === 0 || !result.rows[0]) return null;
    return this.mapRowToSchedule(result.rows[0]);
  }

  public async addExecutionRecord(record: {
    scheduleId: string;
    jobId?: string | null;
    status: 'SUCCESS' | 'FAILURE' | 'RUNNING';
    startedAt?: Date;
    finishedAt?: Date | null;
    executionTimeMs?: number | null;
    workerId?: string | null;
    errorMessage?: string | null;
  }): Promise<ScheduleExecutionRecord> {
    const query = `
      INSERT INTO schedule_execution_history (
        schedule_id, job_id, started_at, finished_at, status, execution_time_ms, worker_id, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const values = [
      record.scheduleId,
      record.jobId || null,
      (record.startedAt || new Date()).toISOString(),
      record.finishedAt ? record.finishedAt.toISOString() : null,
      record.status,
      record.executionTimeMs !== undefined ? record.executionTimeMs : null,
      record.workerId || null,
      record.errorMessage || null,
    ];

    const result = await pgPool.query<ScheduleExecutionRecordRow>(query, values);
    if (!result.rows[0]) {
      throw new Error('Failed to insert schedule execution record');
    }
    return this.mapRowToExecutionRecord(result.rows[0]);
  }

  public async getExecutionHistory(
    scheduleId: string,
    limit: number = 50,
  ): Promise<ScheduleExecutionRecord[]> {
    const query = `
      SELECT * FROM schedule_execution_history
      WHERE schedule_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await pgPool.query<ScheduleExecutionRecordRow>(query, [scheduleId, limit]);
    return result.rows.map((row) => this.mapRowToExecutionRecord(row));
  }
}
