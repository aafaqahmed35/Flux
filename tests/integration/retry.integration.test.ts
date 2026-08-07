/* eslint-disable @typescript-eslint/require-await */
import request from 'supertest';
import app from '../../src/app.js';
import { JobStatus } from '../../src/constants/job.constants.js';
import { runMigrations } from '../../src/database/migrator.js';
import { pgPool } from '../../src/database/postgres.js';
import { JobResponseDTO, RetryHistoryRecordDTO } from '../../src/dtos/job.dto.js';
import { ApiResponseSuccess } from '../../src/interfaces/apiResponse.interface.js';
import { redisClient } from '../../src/redis/redis.js';
import { jobRepository } from '../../src/repositories/job.repository.js';
import { RetryStrategy } from '../../src/retry/retry.constants.js';
import { RetryMetricsResponse } from '../../src/retry/retry.types.js';
import { retryScheduler } from '../../src/scheduler/retry.scheduler.js';
import { jobService } from '../../src/services/job.service.js';
import { Job } from '../../src/types/job.types.js';
import { processorRegistry } from '../../src/workers/processor.registry.js';
import { WorkerManager } from '../../src/workers/worker.manager.js';

describe('Retry Engine & Dead Letter Queue Integration Tests', () => {
  const createdJobIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();
  });

  afterEach(async () => {
    processorRegistry.clear();
    if (createdJobIds.length > 0) {
      const ids = [...createdJobIds];
      createdJobIds.length = 0;
      await pgPool.query('DELETE FROM jobs WHERE id = ANY($1)', [ids]).catch(() => {});
    }
  });

  afterAll(async () => {
    retryScheduler.stop();
    await pgPool.end();
    if (redisClient.status !== 'end') {
      await redisClient.quit();
    }
  });

  it('should retry a failed job, promote via scheduler, and succeed on next attempt', async () => {
    const qName = `retry.single.${Date.now()}`;
    const attemptCounts = new Map<string, number>();

    processorRegistry.registerProcessor(qName, {
      execute: async (job: Job) => {
        const count = (attemptCounts.get(job.id) || 0) + 1;
        attemptCounts.set(job.id, count);
        if (count === 1) {
          throw new Error('Temporary API failure');
        }
        return { ok: true, attempts: count };
      },
    });

    // 1. Create job with FIXED 300ms retry delay
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({
        name: 'retriable-job',
        queueName: qName,
        maxRetries: 2,
        retryDelay: 300,
        retryStrategy: RetryStrategy.FIXED,
      })
      .expect(201);

    const jobId = (res.body as ApiResponseSuccess<JobResponseDTO>).data.id;
    createdJobIds.push(jobId);

    // 2. Start worker manager after creation
    const manager = new WorkerManager({ queues: [qName], pollIntervalMs: 50 });
    await manager.start();

    // Wait for 1st attempt failure & status transition to RETRYING
    let attempts = 0;
    let jobState = await jobRepository.findById(jobId);
    while (jobState?.status !== JobStatus.RETRYING && attempts < 30) {
      await new Promise((res) => setTimeout(res, 100));
      jobState = await jobRepository.findById(jobId);
      attempts++;
    }

    expect(jobState?.status).toBe(JobStatus.RETRYING);
    expect(jobState?.retryCount).toBe(1);

    // Verify relational retry history recorded in PostgreSQL
    const history = await jobRepository.getJobRetryHistory(jobId);
    expect(history.length).toBe(1);
    expect(history[0]?.attempt).toBe(1);
    expect(history[0]?.failureReason).toContain('Temporary API failure');

    // Fast-forward delay: trigger Retry Scheduler tick to promote job back to QUEUED
    await new Promise((res) => setTimeout(res, 350));
    await retryScheduler.tick();

    // Wait for 2nd attempt success & status transition to COMPLETED
    attempts = 0;
    jobState = await jobRepository.findById(jobId);
    while (jobState?.status !== JobStatus.COMPLETED && attempts < 30) {
      await new Promise((res) => setTimeout(res, 100));
      jobState = await jobRepository.findById(jobId);
      attempts++;
    }

    expect(jobState?.status).toBe(JobStatus.COMPLETED);
    expect(attemptCounts.get(jobId)).toBe(2);

    await manager.stop();
  });

  it('should transition job to DEAD_LETTER when max retries are exhausted', async () => {
    const qName = `dlq.exhaust.${Date.now()}`;

    processorRegistry.registerProcessor(qName, {
      execute: async () => {
        throw new Error('Permanent database crash');
      },
    });

    const res = await request(app)
      .post('/api/v1/jobs')
      .send({
        name: 'exhaust-job',
        queueName: qName,
        maxRetries: 1,
        retryDelay: 100,
        retryStrategy: RetryStrategy.FIXED,
      })
      .expect(201);

    const jobId = (res.body as ApiResponseSuccess<JobResponseDTO>).data.id;
    createdJobIds.push(jobId);

    const manager = new WorkerManager({ queues: [qName], pollIntervalMs: 50 });
    await manager.start();

    // Wait for 1st attempt failure -> RETRYING
    let attempts = 0;
    let jobState = await jobRepository.findById(jobId);
    while (jobState?.status !== JobStatus.RETRYING && attempts < 30) {
      await new Promise((res) => setTimeout(res, 100));
      jobState = await jobRepository.findById(jobId);
      attempts++;
    }

    // Promote retry via scheduler
    await new Promise((res) => setTimeout(res, 150));
    await retryScheduler.tick();

    // Wait for 2nd attempt failure -> DEAD_LETTER
    attempts = 0;
    jobState = await jobRepository.findById(jobId);
    while (jobState?.status !== JobStatus.DEAD_LETTER && attempts < 30) {
      await new Promise((res) => setTimeout(res, 100));
      jobState = await jobRepository.findById(jobId);
      attempts++;
    }

    expect(jobState?.status).toBe(JobStatus.DEAD_LETTER);
    expect(jobState?.deadLetteredAt).toBeDefined();
    expect(jobState?.deadLetterReason).toContain('Permanent database crash');

    // Check REST API GET /api/v1/deadletter
    const dlqRes = await request(app).get('/api/v1/deadletter').expect(200);
    const dlqItems = (dlqRes.body as ApiResponseSuccess<{ items: JobResponseDTO[] }>).data.items;
    const foundDlq = dlqItems.find((j) => j.id === jobId);
    expect(foundDlq).toBeDefined();

    await manager.stop();
  });

  it('should route non-retryable exception (ValidationError) directly to DEAD_LETTER', async () => {
    const qName = `dlq.nonretry.${Date.now()}`;

    processorRegistry.registerProcessor(qName, {
      execute: async () => {
        const err = new Error('Invalid schema payload');
        err.name = 'ValidationError';
        throw err;
      },
    });

    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ name: 'validation-job', queueName: qName, maxRetries: 5 })
      .expect(201);

    const jobId = (res.body as ApiResponseSuccess<JobResponseDTO>).data.id;
    createdJobIds.push(jobId);

    const manager = new WorkerManager({ queues: [qName] });
    await manager.start();

    let attempts = 0;
    let jobState = await jobRepository.findById(jobId);
    while (jobState?.status !== JobStatus.DEAD_LETTER && attempts < 30) {
      await new Promise((res) => setTimeout(res, 100));
      jobState = await jobRepository.findById(jobId);
      attempts++;
    }

    expect(jobState?.status).toBe(JobStatus.DEAD_LETTER);
    // Should NOT have retried 5 times
    expect(jobState?.retryCount).toBe(1);

    await manager.stop();
  });

  it('should support manual requeue of dead letter job via REST API', async () => {
    const qName = `dlq.requeue.${Date.now()}`;

    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ name: 'manual-job', queueName: qName })
      .expect(201);

    const jobId = (res.body as ApiResponseSuccess<JobResponseDTO>).data.id;
    createdJobIds.push(jobId);

    // Force job to DEAD_LETTER status
    await jobRepository.updateStatus(jobId, JobStatus.DEAD_LETTER, {
      deadLetteredAt: new Date(),
      deadLetterReason: 'Testing manual requeue',
    });

    // Call POST /api/v1/deadletter/:id/requeue
    const reqRes = await request(app).post(`/api/v1/deadletter/${jobId}/requeue`).expect(200);
    const requeuedJob = (reqRes.body as ApiResponseSuccess<JobResponseDTO>).data;
    expect(requeuedJob.status).toBe(JobStatus.QUEUED);
  });

  it('should return retry history and retry metrics via REST API', async () => {
    const qName = `retry.metrics.${Date.now()}`;

    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ name: 'history-job', queueName: qName })
      .expect(201);

    const jobId = (res.body as ApiResponseSuccess<JobResponseDTO>).data.id;
    createdJobIds.push(jobId);

    await jobRepository.addRetryHistoryRecord({
      jobId,
      attempt: 1,
      strategy: 'EXPONENTIAL_WITH_JITTER',
      delayMs: 1000,
      failedAt: new Date(),
      failureReason: 'Test failure 1',
    });

    // GET /api/v1/jobs/:id/retries
    const histRes = await request(app).get(`/api/v1/jobs/${jobId}/retries`).expect(200);
    const historyItems = (histRes.body as ApiResponseSuccess<RetryHistoryRecordDTO[]>).data;
    expect(historyItems.length).toBe(1);
    expect(historyItems[0]?.failureReason).toBe('Test failure 1');

    // GET /api/v1/retries
    const metRes = await request(app).get('/api/v1/retries').expect(200);
    const metrics = (metRes.body as ApiResponseSuccess<RetryMetricsResponse>).data;
    expect(metrics).toHaveProperty('scheduled');
    expect(metrics).toHaveProperty('retrying');
    expect(metrics).toHaveProperty('deadletter');
    expect(metrics).toHaveProperty('averageDelayMs');
  });

  it('Stress Test - 1000 Failed Jobs: 1000 processed to DEAD_LETTER with zero lost jobs or duplicates', async () => {
    const qName = `stress.fail.${Date.now()}`;
    const failedJobIds = new Set<string>();

    processorRegistry.registerProcessor(qName, {
      execute: async (job: Job) => {
        failedJobIds.add(job.id);
        const err = new Error('Stress test intentional failure');
        err.name = 'ValidationError'; // Immediately route to DEAD_LETTER
        throw err;
      },
    });

    // 1. Create 1000 failing jobs
    const jobCreationPromises = [];
    for (let i = 0; i < 1000; i++) {
      jobCreationPromises.push(
        jobService.createJob({
          name: `stress-fail-${i}`,
          queueName: qName,
          maxRetries: 0,
        }),
      );
    }

    const createdResponses = await Promise.all(jobCreationPromises);
    const jobIds = createdResponses.map((r) => r.job.id);
    createdJobIds.push(...jobIds);

    // 2. Start 2 workers with high concurrency
    const manager1 = new WorkerManager({ queues: [qName], concurrency: 10, pollIntervalMs: 20 });
    const manager2 = new WorkerManager({ queues: [qName], concurrency: 10, pollIntervalMs: 20 });

    await manager1.start();
    await manager2.start();

    // 3. Wait until all 1000 jobs are dead lettered
    let attempts = 0;
    while (failedJobIds.size < 1000 && attempts < 300) {
      await new Promise((res) => setTimeout(res, 100));
      attempts++;
    }

    await new Promise((res) => setTimeout(res, 200));

    expect(failedJobIds.size).toBe(1000);

    // Verify PostgreSQL database status for all 1000 jobs
    const deadLetterCount = await jobRepository.count({
      queueName: qName,
      status: JobStatus.DEAD_LETTER,
    });

    expect(deadLetterCount).toBe(1000);

    await manager1.stop();
    await manager2.stop();
  }, 60000);
});
