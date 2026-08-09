import { JobStatus } from '../constants/job.constants.js';
import {
  CancelJobResponseDTO,
  CreateJobRequestDTO,
  CreateJobResponseDTO,
  DeleteJobResponseDTO,
  JobResponseDTO,
  ListJobsResponseDTO,
  mapJobToDTO,
  mapRetryHistoryToDTO,
  RetryHistoryRecordDTO,
} from '../dtos/job.dto.js';
import { InvalidJobStateError } from '../errors/InvalidJobStateError.js';
import { JobNotFoundError } from '../errors/JobNotFoundError.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { redisQueue } from '../queue/redis.queue.js';
import { EnqueueFailedError } from '../queue/queue.errors.js';
import { QueueService, queueService as defaultQueueService } from '../queue/queue.service.js';
import { IJobRepository } from '../repositories/job.repository.interface.js';
import { jobRepository } from '../repositories/job.repository.js';
import { retryEngine } from '../retry/retry.engine.js';
import { RetryMetricsResponse } from '../retry/retry.types.js';
import { IJobService, ListJobsQueryOptions } from './job.service.interface.js';

import { prometheusRegistry } from '../observability/prometheus.js';
import { tracingHelper } from '../observability/tracing.js';
import { METRIC_NAMES } from '../observability/observability.constants.js';

export class JobService implements IJobService {
  private readonly repository: IJobRepository;
  private readonly queueService: QueueService;

  constructor(
    repository: IJobRepository = jobRepository,
    queueService: QueueService = defaultQueueService,
  ) {
    this.repository = repository;
    this.queueService = queueService;
  }

  async createJob(
    dto: CreateJobRequestDTO,
    idempotencyHeader?: string,
  ): Promise<CreateJobResponseDTO> {
    const span = tracingHelper.startSpan('flux.job.create', {
      'job.name': dto.name,
      'job.queue': dto.queueName,
      'job.priority': dto.priority || 'NORMAL',
    });

    const idempotencyKey = idempotencyHeader || dto.idempotencyKey || null;

    if (idempotencyKey) {
      const existing = await this.repository.findByIdempotencyKey(dto.queueName, idempotencyKey);
      if (existing) {
        prometheusRegistry.incrementCounter(METRIC_NAMES.JOB_IDEMPOTENCY_HITS_TOTAL, 1, {
          queue: dto.queueName,
        });
        tracingHelper.addEvent(span, 'idempotency_hit', { 'job.id': existing.id });
        tracingHelper.endSpan(span);
        appLogger.info('Idempotent request matched existing job', {
          jobId: existing.id,
          queueName: dto.queueName,
          idempotencyKey,
        });
        return {
          job: mapJobToDTO(existing),
          isDuplicate: true,
        };
      }
    }

    prometheusRegistry.incrementCounter(METRIC_NAMES.JOBS_CREATED_TOTAL, 1, {
      queue: dto.queueName,
      priority: dto.priority || 'NORMAL',
    });

    // 1. Insert job into PostgreSQL (status: PENDING or DELAYED)
    const job = await this.repository.createJob({
      ...dto,
      idempotencyKey,
    });

    // If job is delayed/scheduled, keep in DELAYED status in DB without enqueuing to immediate queue list
    if (job.status === JobStatus.DELAYED) {
      appLogger.info('Scheduled/delayed job created in database', {
        jobId: job.id,
        scheduledFor: job.scheduledFor,
        delayUntil: job.delayUntil,
      });
      return {
        job: mapJobToDTO(job),
        isDuplicate: false,
      };
    }

    // 2. Enqueue Job ID into Redis transport
    try {
      await this.queueService.enqueue(job.queueName, job.id);

      // 3. Update PostgreSQL status to QUEUED upon Redis push success
      const queuedJob = await this.repository.updateStatus(job.id, JobStatus.QUEUED);

      appLogger.debug('Job created and enqueued successfully via service layer', {
        jobId: queuedJob.id,
        name: queuedJob.name,
        queueName: queuedJob.queueName,
        status: queuedJob.status,
      });

      return {
        job: mapJobToDTO(queuedJob),
        isDuplicate: false,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error(
        'Redis queue enqueue failed. Persisting job in PostgreSQL as PENDING for durable recovery.',
        {
          jobId: job.id,
          queueName: job.queueName,
          error: msg,
        },
      );

      await this.repository.updateExecutionMetadata(job.id, {
        failureReason: 'REDIS_ENQUEUE_FAILED',
        errorMessage: `Redis queue enqueue failed: ${msg}`,
      });

      throw new EnqueueFailedError(
        `Job created in database (ID: '${job.id}'), but failed to enqueue into Redis queue transport: ${msg}`,
      );
    }
  }

  async getJobById(id: string): Promise<JobResponseDTO> {
    const job = await this.repository.findById(id);
    if (!job) {
      throw new JobNotFoundError(id);
    }

    appLogger.info('Job retrieved via service layer', { jobId: id });
    return mapJobToDTO(job);
  }

  async listJobs(options: ListJobsQueryOptions): Promise<ListJobsResponseDTO> {
    const page = options.page && options.page >= 1 ? options.page : 1;
    const limit = options.limit && options.limit >= 1 ? Math.min(options.limit, 100) : 20;
    const offset = (page - 1) * limit;

    const normalizedOrderDirection = options.sortOrder
      ? (options.sortOrder.toUpperCase() as 'ASC' | 'DESC')
      : 'DESC';

    const result = await this.repository.listJobs({
      queueName: options.queue,
      status: options.status,
      priority: options.priority,
      workerId: options.workerId,
      createdAfter: options.createdAfter,
      createdBefore: options.createdBefore,
      scheduledAfter: options.scheduledAfter,
      scheduledBefore: options.scheduledBefore,
      limit,
      offset,
      orderBy: options.sortBy,
      orderDirection: normalizedOrderDirection,
    });

    const totalPages = Math.ceil(result.total / limit) || 1;
    const hasNext = page < totalPages;
    const hasPrevious = page > 1;

    return {
      items: result.jobs.map(mapJobToDTO),
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages,
        hasNext,
        hasPrevious,
      },
    };
  }

  async cancelJob(id: string, reason = 'Job cancelled via API'): Promise<CancelJobResponseDTO> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new JobNotFoundError(id);
    }

    const updatedJob = await this.repository.cancelJob(id, reason);

    // Also remove from Redis transport if present
    await this.queueService.remove(existing.queueName, id).catch(() => {});

    prometheusRegistry.incrementCounter(METRIC_NAMES.JOBS_CANCELLED_TOTAL, 1, {
      queue: existing.queueName,
    });

    appLogger.info('Job cancelled via service layer', {
      jobId: id,
      previousStatus: existing.status,
      reason,
    });

    return {
      job: mapJobToDTO(updatedJob),
      cancelledAt: new Date().toISOString(),
    };
  }

  async deleteJob(id: string): Promise<DeleteJobResponseDTO> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new JobNotFoundError(id);
    }

    if (existing.status === JobStatus.RUNNING || existing.status === JobStatus.QUEUED) {
      throw new InvalidJobStateError(
        `Cannot delete job '${id}' while in status '${existing.status}'. Cancel the job first before deleting.`,
        { jobId: id, currentStatus: existing.status },
      );
    }

    await this.repository.deleteJob(id);

    // Remove from Redis transport if present
    await this.queueService.remove(existing.queueName, id).catch(() => {});

    prometheusRegistry.incrementCounter(METRIC_NAMES.JOBS_DELETED_TOTAL, 1, {
      queue: existing.queueName,
    });

    appLogger.info('Job soft-deleted via service layer', { jobId: id });

    return {
      id,
      deleted: true,
      deletedAt: new Date().toISOString(),
    };
  }

  async getJobRetries(id: string): Promise<RetryHistoryRecordDTO[]> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new JobNotFoundError(id);
    }

    const records = await this.repository.getJobRetryHistory(id);
    return records.map(mapRetryHistoryToDTO);
  }

  async manualRetryJob(id: string): Promise<JobResponseDTO> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new JobNotFoundError(id);
    }

    if (existing.status !== JobStatus.FAILED && existing.status !== JobStatus.DEAD_LETTER) {
      throw new InvalidJobStateError(
        `Manual retry is only allowed for jobs in FAILED or DEAD_LETTER status. Current status: '${existing.status}'`,
        { jobId: id, currentStatus: existing.status },
      );
    }

    const updated = await this.repository.updateStatus(id, JobStatus.QUEUED, {
      deadLetteredAt: null,
      deadLetterReason: null,
    });

    await redisQueue.removeFromDeadLetter(id).catch(() => {});
    await this.queueService.enqueue(existing.queueName, id);

    appLogger.info('Manual retry triggered successfully for job', {
      jobId: id,
      previousStatus: existing.status,
    });

    return mapJobToDTO(updated);
  }

  async getRetryMetrics(): Promise<RetryMetricsResponse> {
    return retryEngine.getMetrics();
  }
}

export const jobService = new JobService();
