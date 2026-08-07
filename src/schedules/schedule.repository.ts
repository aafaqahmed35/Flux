import { getPgPool } from '../database/postgres';
import { logger } from '../utils/logger';
import { IScheduleRepository } from './schedule.interface';
import {
  Schedule,
  ScheduleExecutionRecord,
  CreateScheduleInput,
  UpdateScheduleInput,
  ListSchedulesOptions,
  PaginatedSchedulesResult,
} from './schedule.types';

export class ScheduleRepository implements IScheduleRepository {
  private mapRowToSchedule(row: any): Schedule {
    return {
      id: row.id,
      name: row.name,
      queueName: row.queue_name,
      cronExpression: row.cron_expression,
      timezone: row.timezone,
      payload: row.payload || {},
      metadata: row.metadata || {},
      enabled: row.enabled,
      nextRunAt: new Date(row.next_run_at),
      lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
      lastSuccessAt: row.last_success_at ? new Date(row.last_success_at) : null,
      lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapRowToExecutionRecord(row: any): ScheduleExecutionRecord {
    return {
      id: row.id,
      scheduleId: row.schedule_id,
      jobId: row.job_id,
      startedAt: new Date(row.started_at),
      finishedAt: row.finished_at ? new Date(row.finished_at) : null,
      status: row.status,
      executionTimeMs: row.execution_time_ms !== null ? Number(row.execution_time_ms) : null,
      workerId: row.worker_id,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at),
    };
  }

  public async createSchedule(input: CreateScheduleInput & { nextRunAt: Date }): Promise<Schedule> {
    const pool = getPgPool();
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

    const result = await pool.query(query, values);
    logger.info('Schedule created in PostgreSQL', { scheduleId: result.rows[0].id, name: input.name });
    return this.mapRowToSchedule(result.rows[0]);
  }

  public async findById(id: string): Promise<Schedule | null> {
    const pool = getPgPool();
    const result = await pool.query('SELECT * FROM schedules WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    return this.mapRowToSchedule(result.rows[0]);
  }

  public async findByName(name: string): Promise<Schedule | null> {
    const pool = getPgPool();
    const result = await pool.query('SELECT * FROM schedules WHERE name = $1', [name]);
    if (result.rows.length === 0) return null;
    return this.mapRowToSchedule(result.rows[0]);
  }

  public async listSchedules(options: ListSchedulesOptions): Promise<PaginatedSchedulesResult> {
    const pool = getPgPool();
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: any[] = [];
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
    const countResult = await pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].count, 10);

    const selectQuery = `
      SELECT * FROM schedules
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    const selectResult = await pool.query(selectQuery, [...values, limit, offset]);
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
    const pool = getPgPool();
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: any[] = [id];
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

    const result = await pool.query(query, values);
    if (result.rows.length === 0) return null;
    return this.mapRowToSchedule(result.rows[0]);
  }

  public async deleteSchedule(id: string): Promise<boolean> {
    const pool = getPgPool();
    const result = await pool.query('DELETE FROM schedules WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  public async findDueSchedules(limit: number = 50): Promise<Schedule[]> {
    const pool = getPgPool();
    const query = `
      SELECT * FROM schedules
      WHERE enabled = TRUE AND next_run_at <= NOW()
      ORDER BY next_run_at ASC
      LIMIT $1
    `;
    const result = await pool.query(query, [limit]);
    return result.rows.map((row) => this.mapRowToSchedule(row));
  }

  public async updateNextRun(id: string, nextRunAt: Date, lastRunAt: Date = new Date()): Promise<Schedule | null> {
    const pool = getPgPool();
    const query = `
      UPDATE schedules
      SET next_run_at = $2,
          last_run_at = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [id, nextRunAt.toISOString(), lastRunAt.toISOString()]);
    if (result.rows.length === 0) return null;
    return this.mapRowToSchedule(result.rows[0]);
  }

  public async toggleEnabled(id: string, enabled: boolean): Promise<Schedule | null> {
    const pool = getPgPool();
    const query = `
      UPDATE schedules
      SET enabled = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [id, enabled]);
    if (result.rows.length === 0) return null;
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
    const pool = getPgPool();
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

    const result = await pool.query(query, values);
    return this.mapRowToExecutionRecord(result.rows[0]);
  }

  public async getExecutionHistory(scheduleId: string, limit: number = 50): Promise<ScheduleExecutionRecord[]> {
    const pool = getPgPool();
    const query = `
      SELECT * FROM schedule_execution_history
      WHERE schedule_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [scheduleId, limit]);
    return result.rows.map((row) => this.mapRowToExecutionRecord(row));
  }
}
