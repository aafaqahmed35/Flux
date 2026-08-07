import { JobStatus } from '../constants/job.constants.js';
import { JobNotFoundError } from '../errors/JobNotFoundError.js';
import { appLogger } from '../logger/logger.js';
import { redisQueue } from '../queue/redis.queue.js';
import { jobRepository } from '../repositories/job.repository.js';
import { Job, ListJobsOptions, PaginatedJobsResult } from '../types/job.types.js';

export class DeadLetterService {
  async listDeadLetterJobs(options: Partial<ListJobsOptions> = {}): Promise<PaginatedJobsResult> {
    return jobRepository.listJobs({
      ...options,
      status: JobStatus.DEAD_LETTER,
    });
  }

  async requeueDeadLetterJob(jobId: string): Promise<Job> {
    const job = await jobRepository.findById(jobId);
    if (!job) {
      throw new JobNotFoundError(jobId);
    }

    // 1. Update PostgreSQL status to QUEUED
    const updatedJob = await jobRepository.updateStatus(jobId, JobStatus.QUEUED, {
      deadLetteredAt: null,
      deadLetterReason: null,
    });

    // 2. Remove from Redis deadletter list if cached
    await redisQueue.removeFromDeadLetter(jobId);

    // 3. Push back into active Redis queue
    await redisQueue.enqueue(job.queueName, jobId);

    appLogger.info('Dead Letter Job requeued successfully', { jobId, queueName: job.queueName });

    return updatedJob;
  }

  async deleteDeadLetterJob(jobId: string): Promise<boolean> {
    await redisQueue.removeFromDeadLetter(jobId);
    const deleted = await jobRepository.deleteJob(jobId);
    appLogger.info('Dead Letter Job soft-deleted', { jobId, deleted });
    return deleted;
  }

  async getDeadLetterMetrics(): Promise<{ totalCount: number; activeQueuesCount: number }> {
    const totalCount = await jobRepository.count({ status: JobStatus.DEAD_LETTER });
    return {
      totalCount,
      activeQueuesCount: 1,
    };
  }
}

export const deadLetterService = new DeadLetterService();
