import { ScheduleNotFoundError } from './schedule.errors';
import { IScheduleRepository, IScheduleService } from './schedule.interface';
import { ScheduleRepository } from './schedule.repository';
import {
  Schedule,
  ScheduleExecutionRecord,
  CreateScheduleInput,
  UpdateScheduleInput,
  ListSchedulesOptions,
  PaginatedSchedulesResult,
} from './schedule.types';
import { validateCreateSchedule, validateUpdateSchedule } from './schedule.validator';
import { JobService } from '../services/job.service.js';
import { CronEngine } from './cron.engine.js';

export class ScheduleService implements IScheduleService {
  private repository: IScheduleRepository;
  private jobService: JobService;

  constructor(repository?: IScheduleRepository, jobService?: JobService) {
    this.repository = repository || new ScheduleRepository();
    this.jobService = jobService || new JobService();
  }

  public async createSchedule(input: CreateScheduleInput): Promise<Schedule> {
    const validated = validateCreateSchedule(input);
    const timezone = validated.timezone || 'UTC';

    const nextRunAt = CronEngine.getNextRun(validated.cronExpression, { timezone });

    return this.repository.createSchedule({
      ...validated,
      nextRunAt,
    });
  }

  public async getScheduleById(id: string): Promise<Schedule> {
    const schedule = await this.repository.findById(id);
    if (!schedule) {
      throw new ScheduleNotFoundError(id);
    }
    return schedule;
  }

  public async listSchedules(options: ListSchedulesOptions): Promise<PaginatedSchedulesResult> {
    return this.repository.listSchedules(options);
  }

  public async updateSchedule(id: string, input: UpdateScheduleInput): Promise<Schedule> {
    const existing = await this.getScheduleById(id);
    const validated = validateUpdateSchedule(input);

    let nextRunAt: Date | undefined;
    const cronExpression = validated.cronExpression || existing.cronExpression;
    const timezone = validated.timezone || existing.timezone;

    if (validated.cronExpression || validated.timezone) {
      nextRunAt = CronEngine.getNextRun(cronExpression, { timezone });
    }

    const updated = await this.repository.updateSchedule(id, {
      ...validated,
      nextRunAt,
    });

    if (!updated) {
      throw new ScheduleNotFoundError(id);
    }

    return updated;
  }

  public async deleteSchedule(id: string): Promise<boolean> {
    const existing = await this.getScheduleById(id);
    return this.repository.deleteSchedule(existing.id);
  }

  public async enableSchedule(id: string): Promise<Schedule> {
    const existing = await this.getScheduleById(id);
    let nextRunAt = existing.nextRunAt;

    if (existing.nextRunAt <= new Date()) {
      nextRunAt = CronEngine.getNextRun(existing.cronExpression, { timezone: existing.timezone });
    }

    const updated = await this.repository.updateSchedule(id, { enabled: true, nextRunAt });
    if (!updated) {
      throw new ScheduleNotFoundError(id);
    }
    return updated;
  }

  public async disableSchedule(id: string): Promise<Schedule> {
    const existing = await this.getScheduleById(id);
    const updated = await this.repository.toggleEnabled(existing.id, false);
    if (!updated) {
      throw new ScheduleNotFoundError(id);
    }
    return updated;
  }

  public async triggerScheduleNow(id: string): Promise<{ schedule: Schedule; jobId: string }> {
    const schedule = await this.getScheduleById(id);

    const jobResponse = await this.jobService.createJob({
      name: schedule.name,
      queueName: schedule.queueName,
      payload: schedule.payload,
      metadata: {
        ...schedule.metadata,
        scheduleId: schedule.id,
        manualTrigger: true,
      },
    });

    const jobId = jobResponse.job.id;

    await this.repository.addExecutionRecord({
      scheduleId: schedule.id,
      jobId,
      status: 'SUCCESS',
      startedAt: new Date(),
      finishedAt: new Date(),
      executionTimeMs: 0,
      errorMessage: null,
    });

    return { schedule, jobId };
  }

  public async getExecutionHistory(
    scheduleId: string,
    limit?: number,
  ): Promise<ScheduleExecutionRecord[]> {
    await this.getScheduleById(scheduleId);
    return this.repository.getExecutionHistory(scheduleId, limit);
  }
}
