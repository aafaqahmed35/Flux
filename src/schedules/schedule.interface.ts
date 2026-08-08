import {
  Schedule,
  ScheduleExecutionRecord,
  CreateScheduleInput,
  UpdateScheduleInput,
  ListSchedulesOptions,
  PaginatedSchedulesResult,
  SchedulerHealthMetrics,
} from './schedule.types';

export interface IScheduleRepository {
  createSchedule(input: CreateScheduleInput & { nextRunAt: Date }): Promise<Schedule>;
  findById(id: string): Promise<Schedule | null>;
  findByName(name: string): Promise<Schedule | null>;
  listSchedules(options: ListSchedulesOptions): Promise<PaginatedSchedulesResult>;
  updateSchedule(
    id: string,
    input: UpdateScheduleInput & { nextRunAt?: Date },
  ): Promise<Schedule | null>;
  deleteSchedule(id: string): Promise<boolean>;
  findDueSchedules(limit?: number): Promise<Schedule[]>;
  updateNextRun(id: string, nextRunAt: Date, lastRunAt?: Date): Promise<Schedule | null>;
  toggleEnabled(id: string, enabled: boolean): Promise<Schedule | null>;

  addExecutionRecord(record: {
    scheduleId: string;
    jobId?: string | null;
    status: 'SUCCESS' | 'FAILURE' | 'RUNNING';
    startedAt?: Date;
    finishedAt?: Date | null;
    executionTimeMs?: number | null;
    workerId?: string | null;
    errorMessage?: string | null;
  }): Promise<ScheduleExecutionRecord>;
  getExecutionHistory(scheduleId: string, limit?: number): Promise<ScheduleExecutionRecord[]>;
}

export interface IScheduleService {
  createSchedule(input: CreateScheduleInput): Promise<Schedule>;
  getScheduleById(id: string): Promise<Schedule>;
  listSchedules(options: ListSchedulesOptions): Promise<PaginatedSchedulesResult>;
  updateSchedule(id: string, input: UpdateScheduleInput): Promise<Schedule>;
  deleteSchedule(id: string): Promise<boolean>;
  enableSchedule(id: string): Promise<Schedule>;
  disableSchedule(id: string): Promise<Schedule>;
  triggerScheduleNow(id: string): Promise<{ schedule: Schedule; jobId: string }>;
  getExecutionHistory(scheduleId: string, limit?: number): Promise<ScheduleExecutionRecord[]>;
}

export interface ISchedulerRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  isLeader(): boolean;
  isRunning(): boolean;
  getMetrics(): SchedulerHealthMetrics;
}
