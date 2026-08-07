import { RecordStatus } from '../types/common.types';

export interface Schedule {
  id: string;
  name: string;
  queueName: string;
  cronExpression: string;
  timezone: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  enabled: boolean;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleExecutionRecord {
  id: string;
  scheduleId: string;
  jobId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  status: 'SUCCESS' | 'FAILURE' | 'RUNNING';
  executionTimeMs: number | null;
  workerId: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface CreateScheduleInput {
  name: string;
  queueName: string;
  cronExpression: string;
  timezone?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateScheduleInput {
  name?: string;
  queueName?: string;
  cronExpression?: string;
  timezone?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  enabled?: boolean;
}

export interface ListSchedulesOptions {
  page?: number;
  limit?: number;
  queueName?: string;
  enabled?: boolean;
  search?: string;
}

export interface PaginatedSchedulesResult {
  schedules: Schedule[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SchedulerHealthMetrics {
  leader: boolean;
  running: boolean;
  activeSchedules: number;
  dueSchedules: number;
  schedulerLagMs: number;
  pollIntervalMs: number;
  lastTick: string | null;
}
