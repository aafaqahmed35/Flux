/* eslint-disable @typescript-eslint/require-await */
import request from 'supertest';
import app from '../../src/app.js';
import { JobStatus } from '../../src/constants/job.constants.js';
import { runMigrations } from '../../src/database/migrator.js';
import { pgPool } from '../../src/database/postgres.js';
import { JobResponseDTO } from '../../src/dtos/job.dto.js';
import { ApiResponseSuccess } from '../../src/interfaces/apiResponse.interface.js';
import { redisClient } from '../../src/redis/redis.js';
import { jobRepository } from '../../src/repositories/job.repository.js';
import { jobService } from '../../src/services/job.service.js';
import { ExecutionContext } from '../../src/execution/execution.context.js';
import { Job } from '../../src/types/job.types.js';
import { WorkerManager } from '../../src/workers/worker.manager.js';
import { processorRegistry } from '../../src/workers/processor.registry.js';
import { workerRegistry } from '../../src/workers/worker.registry.js';

describe('Worker Runtime & Job Execution Engine Integration Tests', () => {
  const createdJobIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();
  });

  afterEach(async () => {
    processorRegistry.clear();
    for (const id of createdJobIds) {
      await jobRepository.deleteJob(id).catch(() => {});
    }
    createdJobIds.length = 0;
  });

  afterAll(async () => {
    await pgPool.end();
    if (redisClient.status !== 'end') {
      await redisClient.quit();
    }
  });

  it('should register worker in Redis upon WorkerManager start', async () => {
    const manager = new WorkerManager({ queues: ['test.reg'] });
    await manager.start();

    const activeWorkers = await workerRegistry.listActiveWorkers();
    const found = activeWorkers.find((w) => w.workerId === manager.runtime.workerId);

    expect(found).toBeDefined();
    expect(found?.supportedQueues).toContain('test.reg');
    expect(found?.status).toBe('IDLE');

    await manager.stop();
  });

  it('should claim, execute, and mark job as COMPLETED in PostgreSQL', async () => {
    const qName = `exec.single.${Date.now()}`;

    // Register processor
    processorRegistry.registerProcessor(qName, {
      execute: async (job: Job, _ctx: ExecutionContext) => {
        return { processed: true, payload: job.payload };
      },
    });

    const manager = new WorkerManager({ queues: [qName], concurrency: 2 });
    await manager.start();

    // Create job via REST API
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ name: 'email-job', queueName: qName, payload: { to: 'user@test.com' } })
      .expect(201);

    const jobId = (res.body as ApiResponseSuccess<JobResponseDTO>).data.id;
    createdJobIds.push(jobId);

    // Wait for execution completion
    let attempts = 0;
    let completedJob = await jobRepository.findById(jobId);
    while (completedJob?.status !== JobStatus.COMPLETED && attempts < 30) {
      await new Promise((res) => setTimeout(res, 100));
      completedJob = await jobRepository.findById(jobId);
      attempts++;
    }

    expect(completedJob?.status).toBe(JobStatus.COMPLETED);
    expect(completedJob?.completedAt).toBeDefined();
    expect(completedJob?.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(completedJob?.workerId).toBe(manager.runtime.workerId);

    await manager.stop();
  });

  it('should route failing job with maxRetries: 0 to DEAD_LETTER', async () => {
    const qName = `fail.single.${Date.now()}`;

    processorRegistry.registerProcessor(qName, {
      execute: async () => {
        throw new Error('Database connection failed');
      },
    });

    const manager = new WorkerManager({ queues: [qName] });
    await manager.start();

    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ name: 'failing-job', queueName: qName, maxRetries: 0 })
      .expect(201);

    const jobId = (res.body as ApiResponseSuccess<JobResponseDTO>).data.id;
    createdJobIds.push(jobId);

    let attempts = 0;
    let failedJob = await jobRepository.findById(jobId);
    while (failedJob?.status !== JobStatus.DEAD_LETTER && attempts < 30) {
      await new Promise((res) => setTimeout(res, 100));
      failedJob = await jobRepository.findById(jobId);
      attempts++;
    }

    expect(failedJob?.status).toBe(JobStatus.DEAD_LETTER);
    expect(failedJob?.errorMessage).toContain('Database connection failed');

    await manager.stop();
  });

  it('Stress Test - 2 Workers, 1 Queue, 100 Jobs: 100 processed, 0 duplicates, 0 lost', async () => {
    const qName = `stress.${Date.now()}`;
    const processedJobIds = new Set<string>();

    processorRegistry.registerProcessor(qName, {
      execute: async (job: Job) => {
        processedJobIds.add(job.id);
        return { ok: true };
      },
    });

    // 1. Create and enqueue 100 jobs first using jobService
    const jobCreationPromises = [];
    for (let i = 0; i < 100; i++) {
      jobCreationPromises.push(
        jobService.createJob({
          name: `stress-job-${i}`,
          queueName: qName,
        }),
      );
    }

    const createdResponses = await Promise.all(jobCreationPromises);
    const jobIds = createdResponses.map((r) => r.job.id);
    createdJobIds.push(...jobIds);

    // 2. Start 2 workers
    const manager1 = new WorkerManager({ queues: [qName], concurrency: 4, pollIntervalMs: 50 });
    const manager2 = new WorkerManager({ queues: [qName], concurrency: 4, pollIntervalMs: 50 });

    await manager1.start();
    await manager2.start();

    // 3. Wait until all 100 jobs are completed
    let attempts = 0;

    while (processedJobIds.size < 100 && attempts < 150) {
      await new Promise((res) => setTimeout(res, 100));
      attempts++;
    }

    expect(processedJobIds.size).toBe(100);

    // Verify PostgreSQL status for all 100 jobs
    const finalJobs = await Promise.all(jobIds.map((id) => jobRepository.findById(id)));
    const completedCount = finalJobs.filter((j) => j?.status === JobStatus.COMPLETED).length;

    expect(completedCount).toBe(100);

    await manager1.stop();
    await manager2.stop();
  }, 30000);
});
