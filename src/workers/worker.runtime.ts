import { JobStatus } from '../constants/job.constants.js';
import { ExecutionEngine } from '../execution/execution.engine.js';
import { ExecutionContext } from '../execution/execution.context.js';
import { IExecutionEngine } from '../execution/execution.interface.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { IQueueEngine } from '../queue/queue.interface.js';
import { redisQueue } from '../queue/redis.queue.js';
import { IJobRepository } from '../repositories/job.repository.interface.js';
import { jobRepository } from '../repositories/job.repository.js';
import { retryEngine } from '../retry/retry.engine.js';
import { ConcurrencyLimiter } from './concurrency.limiter.js';
import { WORKER_DEFAULTS } from './worker.constants.js';
import { WorkerOptions, WorkerStatus } from './worker.types.js';
import { workerRegistry } from './worker.registry.js';
import { prometheusRegistry } from '../observability/prometheus.js';
import { tracingHelper } from '../observability/tracing.js';
import { METRIC_NAMES } from '../observability/observability.constants.js';

export class WorkerRuntime {
  readonly workerId: string;
  readonly queues: string[];
  readonly concurrency: number;
  readonly limiter: ConcurrencyLimiter;
  private isRunning = false;
  private status: WorkerStatus = 'STOPPED';
  private currentJobId: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly pollIntervalMs: number;
  private readonly leaseRenewalIntervalMs: number;
  private readonly activeLeaseTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly lostLeases: Set<string> = new Set();

  private readonly queueEngine: IQueueEngine;
  private readonly repository: IJobRepository;
  private readonly executionEngine: IExecutionEngine;

  constructor(
    options: WorkerOptions,
    queueEngine: IQueueEngine = redisQueue,
    repository: IJobRepository = jobRepository,
    executionEngine: IExecutionEngine = new ExecutionEngine(),
  ) {
    this.workerId = options.workerId ?? `worker-${Math.random().toString(36).substring(2, 9)}`;
    this.queues = options.queues ?? ['default'];
    this.concurrency = options.concurrency ?? WORKER_DEFAULTS.defaultConcurrency;
    this.pollIntervalMs = options.pollIntervalMs ?? WORKER_DEFAULTS.pollIntervalMs;
    this.leaseRenewalIntervalMs =
      options.leaseRenewalIntervalMs ?? WORKER_DEFAULTS.leaseRenewalIntervalMs;
    this.limiter = new ConcurrencyLimiter(this.concurrency);

    this.queueEngine = queueEngine;
    this.repository = repository;
    this.executionEngine = executionEngine;
  }

  get supportedQueues(): string[] {
    return this.queues;
  }

  getStatus(): WorkerStatus {
    return this.status;
  }

  getCurrentJobId(): string | null {
    return this.currentJobId;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.status = 'IDLE';

    const info = workerRegistry.buildWorkerInfo(
      this.workerId,
      this.queues,
      this.concurrency,
      this.status,
    );
    await workerRegistry.registerWorker(info);

    const labels = { workerId: this.workerId, queue: this.queues[0] || 'default' };
    prometheusRegistry.setGauge(METRIC_NAMES.WORKER_ACTIVE, 1, labels);
    prometheusRegistry.setGauge(METRIC_NAMES.WORKER_BUSY, 0, labels);
    prometheusRegistry.setGauge(METRIC_NAMES.WORKER_CONCURRENCY, this.concurrency, labels);

    appLogger.info('Worker Runtime started', {
      workerId: this.workerId,
      queues: this.queues,
      concurrency: this.concurrency,
    });

    this.scheduleNextPoll(0);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.status = 'STOPPED';

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.clearAllLeaseHeartbeats();

    // Wait for active processing slots to clear
    let attempts = 0;
    while (this.limiter.active > 0 && attempts < 50) {
      await new Promise((res) => setTimeout(res, 100));
      attempts++;
    }

    await workerRegistry.deregisterWorker(this.workerId);

    const labels = { workerId: this.workerId, queue: this.queues[0] || 'default' };
    prometheusRegistry.setGauge(METRIC_NAMES.WORKER_ACTIVE, 0, labels);
    prometheusRegistry.setGauge(METRIC_NAMES.WORKER_BUSY, 0, labels);

    appLogger.info('Worker Runtime stopped cleanly', { workerId: this.workerId });
  }

  private startLeaseHeartbeat(jobId: string): void {
    this.stopLeaseHeartbeat(jobId);
    this.lostLeases.delete(jobId);

    const timer = setInterval(() => {
      void (async (): Promise<void> => {
        try {
          const renewed = await this.repository.updateJobLease(jobId, this.workerId);
          if (!renewed) {
            appLogger.warn('Worker lost lease for running job', {
              jobId,
              workerId: this.workerId,
            });
            this.lostLeases.add(jobId);
            this.stopLeaseHeartbeat(jobId);
          } else {
            appLogger.debug('Worker renewed lease for running job', {
              jobId,
              workerId: this.workerId,
            });
          }
        } catch (err: unknown) {
          appLogger.error('Error renewing job lease', {
            jobId,
            workerId: this.workerId,
            error: String(err),
          });
        }
      })();
    }, this.leaseRenewalIntervalMs);

    this.activeLeaseTimers.set(jobId, timer);
  }

  private stopLeaseHeartbeat(jobId: string): void {
    const timer = this.activeLeaseTimers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.activeLeaseTimers.delete(jobId);
    }
  }

  private clearAllLeaseHeartbeats(): void {
    for (const timer of this.activeLeaseTimers.values()) {
      clearInterval(timer);
    }
    this.activeLeaseTimers.clear();
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.isRunning) {
      return;
    }
    this.pollTimer = setTimeout(() => {
      void this.pollAndExecute();
    }, delayMs);
  }

  private async pollAndExecute(): Promise<void> {
    if (!this.isRunning || this.limiter.isFull) {
      return;
    }

    if (!this.limiter.tryAcquire()) {
      return;
    }

    let claimedJobId: string | null = null;
    let claimedQueue: string | null = null;

    for (const qName of this.queues) {
      claimedJobId = await this.queueEngine.claimJob(qName, 0);
      if (claimedJobId) {
        claimedQueue = qName;
        break;
      }
    }

    if (!claimedJobId || !claimedQueue) {
      this.limiter.release();
      if (this.isRunning) {
        this.scheduleNextPoll(this.pollIntervalMs);
      }
      return;
    }

    this.currentJobId = claimedJobId;
    this.status = 'BUSY';

    void this.processJob(claimedQueue, claimedJobId).finally(() => {
      this.limiter.release();
      this.currentJobId = null;
      this.status = this.limiter.active > 0 ? 'BUSY' : 'IDLE';

      if (this.isRunning) {
        this.scheduleNextPoll(0);
      }
    });

    if (!this.limiter.isFull && this.isRunning) {
      this.scheduleNextPoll(0);
    }
  }

  private async processJob(queueName: string, jobId: string): Promise<void> {
    const job = await this.repository.findById(jobId);
    if (!job) {
      appLogger.warn('Claimed job not found in PostgreSQL database', { jobId, queueName });
      await this.queueEngine.ackJob(queueName, jobId);
      return;
    }

    // 1. PostgreSQL transition: QUEUED -> CLAIMED
    await this.repository.updateStatus(jobId, JobStatus.CLAIMED, {
      workerId: this.workerId,
      lockedAt: new Date(),
    });

    // 2. PostgreSQL transition: CLAIMED -> RUNNING
    const runningJob = await this.repository.updateStatus(jobId, JobStatus.RUNNING, {
      startedAt: new Date(),
    });

    // Start background lease renewal heartbeat
    this.startLeaseHeartbeat(runningJob.id);

    // 3. Construct Execution Context
    const context: ExecutionContext = {
      jobId: runningJob.id,
      jobName: runningJob.name,
      traceId: runningJob.id,
      correlationId: runningJob.id,
      workerId: this.workerId,
      queueName,
      attempt: runningJob.attempts + 1,
      startedAt: new Date(),
      logger: appLogger,
    };

    const queueWaitMs = Math.max(
      0,
      context.startedAt.getTime() - new Date(runningJob.createdAt).getTime(),
    );
    prometheusRegistry.recordHistogram(METRIC_NAMES.JOB_QUEUE_WAIT_DURATION_MS, queueWaitMs, {
      queue: queueName,
    });

    const span = tracingHelper.startSpan('flux.worker.process', {
      'job.id': runningJob.id,
      'job.name': runningJob.name,
      'job.queue': queueName,
      'job.attempt': context.attempt,
      'worker.id': this.workerId,
    });

    try {
      // 4. Delegate execution to Execution Engine
      const result = await this.executionEngine.execute(runningJob, context);

      const wasLeaseLost = this.lostLeases.has(jobId);
      this.stopLeaseHeartbeat(jobId);

      if (wasLeaseLost) {
        appLogger.warn(
          'Job execution finished but worker lost lease during execution. Skipping PostgreSQL status update.',
          { jobId, workerId: this.workerId },
        );
        await this.queueEngine.ackJob(queueName, jobId).catch(() => {});
        return;
      }

      // 5. Update PostgreSQL state and acknowledge Redis job
      if (result.success) {
        prometheusRegistry.incrementCounter(METRIC_NAMES.JOBS_COMPLETED_TOTAL, 1, {
          queue: queueName,
        });
        prometheusRegistry.recordHistogram(METRIC_NAMES.WORKER_JOB_DURATION_MS, result.durationMs, {
          queue: queueName,
          status: 'COMPLETED',
        });
        prometheusRegistry.recordHistogram(
          METRIC_NAMES.JOB_EXECUTION_DURATION_MS,
          result.durationMs,
          { queue: queueName, status: 'COMPLETED' },
        );

        tracingHelper.endSpan(span, 'OK');

        await this.repository.updateStatus(jobId, JobStatus.COMPLETED, {
          completedAt: new Date(),
          executionTimeMs: result.durationMs,
        });
        await this.queueEngine.ackJob(queueName, jobId);
        appLogger.debug('Job Execution Success Persisted', {
          jobId,
          durationMs: result.durationMs,
        });
      } else {
        const error = result.error || new Error('Processor execution error');
        prometheusRegistry.incrementCounter(METRIC_NAMES.JOBS_FAILED_TOTAL, 1, {
          queue: queueName,
          failure_type: error.name || 'Error',
        });
        prometheusRegistry.recordHistogram(METRIC_NAMES.WORKER_JOB_DURATION_MS, result.durationMs, {
          queue: queueName,
          status: 'FAILED',
        });
        prometheusRegistry.recordHistogram(
          METRIC_NAMES.JOB_EXECUTION_DURATION_MS,
          result.durationMs,
          { queue: queueName, status: 'FAILED' },
        );

        tracingHelper.recordException(span, error);
        tracingHelper.endSpan(span, 'ERROR', error.message);

        await retryEngine.scheduleRetry(runningJob, error);
        errorLogger.error('Job Execution Failure Handled by Retry Engine', {
          jobId,
          durationMs: result.durationMs,
          error: error.message,
        });
      }
    } finally {
      this.stopLeaseHeartbeat(jobId);
      this.lostLeases.delete(jobId);
    }
  }
}
