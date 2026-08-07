import { getRedisClient } from '../redis/redis';
import { JobService } from '../services/job.service';
import { logger } from '../utils/logger';
import { CronEngine } from './cron.engine';
import {
  SCHEDULER_HEARTBEAT_INTERVAL_MS,
  SCHEDULER_LOCK_TTL_MS,
  SCHEDULER_POLL_INTERVAL_MS,
  SCHEDULER_REDIS_LOCK_KEY,
} from './schedule.constants';
import { IScheduleRepository, ISchedulerRuntime } from './schedule.interface';
import { ScheduleRepository } from './schedule.repository';
import { Schedule, SchedulerHealthMetrics } from './schedule.types';

export class SchedulerRuntime implements ISchedulerRuntime {
  private readonly instanceId: string;
  private readonly repository: IScheduleRepository;
  private readonly jobService: JobService;

  private running: boolean = false;
  private leader: boolean = false;

  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  private activeSchedulesCount: number = 0;
  private dueSchedulesCount: number = 0;
  private schedulerLagMs: number = 0;
  private lastTickTime: Date | null = null;

  constructor(repository?: IScheduleRepository, jobService?: JobService, instanceId?: string) {
    this.instanceId =
      instanceId || `scheduler-${Math.random().toString(36).substring(2, 9)}-${Date.now().toString(36)}`;
    this.repository = repository || new ScheduleRepository();
    this.jobService = jobService || new JobService();
  }

  public isLeader(): boolean {
    return this.leader;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getMetrics(): SchedulerHealthMetrics {
    return {
      leader: this.leader,
      running: this.running,
      activeSchedules: this.activeSchedulesCount,
      dueSchedules: this.dueSchedulesCount,
      schedulerLagMs: this.schedulerLagMs,
      pollIntervalMs: SCHEDULER_POLL_INTERVAL_MS,
      lastTick: this.lastTickTime ? this.lastTickTime.toISOString() : null,
    };
  }

  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    logger.info('Starting Scheduler Runtime', { instanceId: this.instanceId });

    // Step 1: Attempt initial Leader Lock acquisition
    await this.acquireLeaderLock();

    // Start heartbeat timer to attempt acquiring or renewing leader lock periodically
    this.heartbeatTimer = setInterval(async () => {
      if (this.leader) {
        await this.renewLeaderLock();
      } else {
        await this.acquireLeaderLock();
      }
    }, SCHEDULER_HEARTBEAT_INTERVAL_MS);

    // If acquired leader lock, execute recovery sequence before polling loop
    if (this.leader) {
      await this.recoverOverdueSchedules();
      this.startPollingLoop();
    }
  }

  public async stop(): Promise<void> {
    if (!this.running) return;

    logger.info('Stopping Scheduler Runtime', { instanceId: this.instanceId });
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.leader) {
      await this.releaseLeaderLock();
      this.leader = false;
    }
  }

  private async acquireLeaderLock(): Promise<boolean> {
    try {
      const redis = getRedisClient();
      const acquired = await redis.set(
        SCHEDULER_REDIS_LOCK_KEY,
        this.instanceId,
        'PX',
        SCHEDULER_LOCK_TTL_MS,
        'NX',
      );

      if (acquired === 'OK') {
        const wasLeader = this.leader;
        this.leader = true;

        if (!wasLeader) {
          logger.info('Scheduler acquired Leader Lock', { instanceId: this.instanceId });
          await this.recoverOverdueSchedules();
          this.startPollingLoop();
        }
        return true;
      }
    } catch (err) {
      logger.error('Failed to attempt Leader Lock acquisition', { error: err });
    }

    return false;
  }

  private async renewLeaderLock(): Promise<boolean> {
    try {
      const redis = getRedisClient();
      const currentLeader = await redis.get(SCHEDULER_REDIS_LOCK_KEY);

      if (currentLeader === this.instanceId) {
        await redis.pexpire(SCHEDULER_REDIS_LOCK_KEY, SCHEDULER_LOCK_TTL_MS);
        return true;
      } else {
        logger.warn('Scheduler lost Leader Lock to another instance', {
          instanceId: this.instanceId,
          currentLeader,
        });
        this.leader = false;
        this.stopPollingLoop();
        return false;
      }
    } catch (err) {
      logger.error('Failed to renew Leader Lock', { error: err });
      return false;
    }
  }

  private async releaseLeaderLock(): Promise<void> {
    try {
      const redis = getRedisClient();
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await redis.eval(script, 1, SCHEDULER_REDIS_LOCK_KEY, this.instanceId);
      logger.info('Scheduler released Leader Lock', { instanceId: this.instanceId });
    } catch (err) {
      logger.error('Failed to release Leader Lock', { error: err });
    }
  }

  private startPollingLoop(): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(async () => {
      if (this.running && this.leader) {
        await this.tick();
      }
    }, SCHEDULER_POLL_INTERVAL_MS);
  }

  private stopPollingLoop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Overdue Schedule Startup Recovery
   */
  public async recoverOverdueSchedules(): Promise<void> {
    if (!this.leader) return;

    try {
      logger.info('Performing overdue schedule startup recovery...', { instanceId: this.instanceId });
      const dueSchedules = await this.repository.findDueSchedules(100);

      if (dueSchedules.length > 0) {
        logger.warn(`Found ${dueSchedules.length} overdue schedules during startup recovery`, {
          count: dueSchedules.length,
        });
        for (const schedule of dueSchedules) {
          await this.executeSchedule(schedule, true);
        }
      }
    } catch (err) {
      logger.error('Error during scheduler startup recovery', { error: err });
    }
  }

  /**
   * Periodic Tick Loop
   */
  public async tick(): Promise<void> {
    if (!this.running || !this.leader) return;

    this.lastTickTime = new Date();
    const tickStart = Date.now();

    try {
      const dueSchedules = await this.repository.findDueSchedules(50);
      this.dueSchedulesCount = dueSchedules.length;

      if (dueSchedules.length > 0) {
        for (const schedule of dueSchedules) {
          await this.executeSchedule(schedule, false);
        }
      }

      this.schedulerLagMs = Date.now() - tickStart;
    } catch (err) {
      logger.error('Error during scheduler tick', { error: err });
    }
  }

  private async executeSchedule(schedule: Schedule, isRecovery: boolean): Promise<void> {
    const startedAt = new Date();

    try {
      // 1. Create background job in PostgreSQL + Redis
      const job = await this.jobService.createJob({
        name: schedule.name,
        queueName: schedule.queueName,
        payload: schedule.payload,
        metadata: {
          ...schedule.metadata,
          scheduleId: schedule.id,
          cronExpression: schedule.cronExpression,
          isRecovery,
        },
      });

      // 2. Compute next execution timestamp
      const nextRunAt = CronEngine.getNextRun(schedule.cronExpression, {
        fromDate: startedAt,
        timezone: schedule.timezone,
      });

      // 3. Update next_run_at in PostgreSQL
      await this.repository.updateNextRun(schedule.id, nextRunAt, startedAt);

      // 4. Record execution history audit log
      const finishedAt = new Date();
      await this.repository.addExecutionRecord({
        scheduleId: schedule.id,
        jobId: job.id,
        status: 'SUCCESS',
        startedAt,
        finishedAt,
        executionTimeMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage: null,
      });

      logger.info('Scheduled job enqueued successfully', {
        scheduleId: schedule.id,
        jobId: job.id,
        nextRunAt: nextRunAt.toISOString(),
        isRecovery,
      });
    } catch (err: any) {
      const finishedAt = new Date();
      const errorMessage = err?.message || 'Failed to enqueue scheduled job';

      logger.error('Failed to execute schedule', {
        scheduleId: schedule.id,
        error: err,
      });

      // Safely advance next_run_at even if job enqueue failed so schedule doesn't loop infinitely
      try {
        const nextRunAt = CronEngine.getNextRun(schedule.cronExpression, {
          fromDate: startedAt,
          timezone: schedule.timezone,
        });
        await this.repository.updateNextRun(schedule.id, nextRunAt, startedAt);
      } catch (calcErr) {
        logger.error('Failed to advance next_run_at after schedule execution failure', { calcErr });
      }

      await this.repository.addExecutionRecord({
        scheduleId: schedule.id,
        jobId: null,
        status: 'FAILURE',
        startedAt,
        finishedAt,
        executionTimeMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage,
      });
    }
  }
}
