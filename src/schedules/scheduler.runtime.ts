import { redisClient } from '../redis/redis.js';
import { JobService } from '../services/job.service.js';
import appLogger from '../logger/logger.js';
import { CronEngine } from './cron.engine.js';
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
  private isTicking: boolean = false;

  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  private activeSchedulesCount: number = 0;
  private dueSchedulesCount: number = 0;
  private schedulerLagMs: number = 0;
  private lastTickTime: Date | null = null;

  constructor(repository?: IScheduleRepository, jobService?: JobService, instanceId?: string) {
    this.instanceId =
      instanceId ||
      `scheduler-${Math.random().toString(36).substring(2, 9)}-${Date.now().toString(36)}`;
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

    appLogger.info('Starting Scheduler Runtime', { instanceId: this.instanceId });

    // Step 1: Attempt initial Leader Lock acquisition
    const acquired = await this.acquireLeaderLock();

    // Step 2: Start heartbeat timer
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => {
        void this.heartbeatLoop();
      }, SCHEDULER_HEARTBEAT_INTERVAL_MS);
    }

    // Step 3: If leader lock acquired during start, run recovery & start polling
    if (acquired) {
      await this.recoverOverdueSchedules();
      this.startPollingLoop();
    }
  }

  private async heartbeatLoop(): Promise<void> {
    if (!this.running) return;
    if (this.leader) {
      await this.renewLeaderLock();
    } else {
      const becameLeader = await this.acquireLeaderLock();
      if (becameLeader && this.running) {
        await this.recoverOverdueSchedules();
        this.startPollingLoop();
      }
    }
  }

  public async stop(): Promise<void> {
    if (!this.running) return;

    appLogger.info('Stopping Scheduler Runtime', { instanceId: this.instanceId });
    this.running = false;
    this.stopPollingLoop();

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.leader) {
      this.leader = false;
      await this.releaseLeaderLock();
    }
  }

  private async acquireLeaderLock(): Promise<boolean> {
    try {
      const acquired = await redisClient.set(
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
          appLogger.info('Scheduler acquired Leader Lock', { instanceId: this.instanceId });
        }
        return true;
      }
    } catch (err) {
      appLogger.error('Failed to attempt Leader Lock acquisition', { error: err });
    }

    return false;
  }

  private async renewLeaderLock(): Promise<boolean> {
    try {
      const currentLeader = await redisClient.get(SCHEDULER_REDIS_LOCK_KEY);

      if (currentLeader === this.instanceId) {
        await redisClient.pexpire(SCHEDULER_REDIS_LOCK_KEY, SCHEDULER_LOCK_TTL_MS);
        return true;
      } else {
        appLogger.warn('Scheduler lost Leader Lock to another instance', {
          instanceId: this.instanceId,
          currentLeader,
        });
        this.handleLeadershipLoss();
        return false;
      }
    } catch (err) {
      appLogger.error('Failed to renew Leader Lock', { error: err });
      this.handleLeadershipLoss();
      return false;
    }
  }

  private handleLeadershipLoss(): void {
    this.leader = false;
    this.stopPollingLoop();
  }

  private async releaseLeaderLock(): Promise<void> {
    try {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await redisClient.eval(script, 1, SCHEDULER_REDIS_LOCK_KEY, this.instanceId);
      appLogger.info('Scheduler released Leader Lock', { instanceId: this.instanceId });
    } catch (err) {
      appLogger.error('Failed to release Leader Lock', { error: err });
    }
  }

  private startPollingLoop(): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(() => {
      if (this.running && this.leader) {
        void this.tick();
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
    if (!this.leader || !this.running) return;

    try {
      appLogger.info('Performing overdue schedule startup recovery...', {
        instanceId: this.instanceId,
      });
      const dueSchedules = await this.repository.findDueSchedules(100);

      if (dueSchedules.length > 0) {
        appLogger.warn(`Found ${dueSchedules.length} overdue schedules during startup recovery`, {
          count: dueSchedules.length,
        });
        for (const schedule of dueSchedules) {
          if (!this.leader || !this.running) break;
          await this.executeSchedule(schedule, true);
        }
      }
    } catch (err) {
      appLogger.error('Error during scheduler startup recovery', { error: err });
    }
  }

  /**
   * Periodic Tick Loop
   */
  public async tick(): Promise<void> {
    if (!this.running || !this.leader || this.isTicking) return;

    this.isTicking = true;
    this.lastTickTime = new Date();
    const tickStart = Date.now();

    try {
      const dueSchedules = await this.repository.findDueSchedules(50);
      this.dueSchedulesCount = dueSchedules.length;

      if (dueSchedules.length > 0) {
        for (const schedule of dueSchedules) {
          if (!this.running || !this.leader) break;
          await this.executeSchedule(schedule, false);
        }
      }

      this.schedulerLagMs = Date.now() - tickStart;
    } catch (err) {
      appLogger.error('Error during scheduler tick', { error: err });
    } finally {
      this.isTicking = false;
    }
  }

  private async executeSchedule(schedule: Schedule, isRecovery: boolean): Promise<void> {
    const startedAt = new Date();

    try {
      // 1. Create background job in PostgreSQL + Redis
      const jobResponse = await this.jobService.createJob({
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

      const jobId = jobResponse.job.id;

      // 2. Compute next execution timestamp (guaranteed strictly > startedAt)
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
        jobId,
        status: 'SUCCESS',
        startedAt,
        finishedAt,
        executionTimeMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage: null,
      });

      appLogger.info('Scheduled job enqueued successfully', {
        scheduleId: schedule.id,
        jobId,
        nextRunAt: nextRunAt.toISOString(),
        isRecovery,
      });
    } catch (err: unknown) {
      const finishedAt = new Date();
      const errorMessage = err instanceof Error ? err.message : 'Failed to enqueue scheduled job';

      appLogger.error('Failed to execute schedule', {
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
        appLogger.error('Failed to advance next_run_at after schedule execution failure', {
          calcErr,
        });
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

export const schedulerRuntime = new SchedulerRuntime();
