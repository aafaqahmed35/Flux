import request from 'supertest';
import app from '../../src/app.js';
import { JobStatus } from '../../src/constants/job.constants.js';
import { runMigrations } from '../../src/database/migrator.js';
import { pgPool } from '../../src/database/postgres.js';
import { JobResponseDTO } from '../../src/dtos/job.dto.js';
import { ApiResponseSuccess } from '../../src/interfaces/apiResponse.interface.js';
import { EnqueueFailedError } from '../../src/queue/queue.errors.js';
import { QueueKeyFactory } from '../../src/queue/queue.key.js';
import { queueService } from '../../src/queue/queue.service.js';
import { redisClient } from '../../src/redis/redis.js';
import { jobRepository } from '../../src/repositories/job.repository.js';
import { JobService } from '../../src/services/job.service.js';

describe('Queue Producer & Atomic Pipeline Integration Tests', () => {
  const createdJobIds: string[] = [];
  const testQueueName = `producer.test.${Date.now()}`;

  beforeAll(async () => {
    await runMigrations();
  });

  afterEach(async () => {
    for (const id of createdJobIds) {
      await jobRepository.deleteJob(id).catch(() => {});
    }
    createdJobIds.length = 0;
    await queueService.clear(testQueueName).catch(() => {});
  });

  afterAll(async () => {
    await pgPool.end();
    if (redisClient.status !== 'end') {
      await redisClient.quit();
    }
  });

  it('POST /api/v1/jobs - should create job in DB and enqueue Job ID into Redis (STATUS -> QUEUED)', async () => {
    const payload = {
      name: 'send-invoice',
      queueName: testQueueName,
      payload: { invoiceId: 'inv-123' },
    };

    const res = await request(app).post('/api/v1/jobs').send(payload).expect(201);
    const body = res.body as ApiResponseSuccess<JobResponseDTO>;

    const jobId = body.data.id;
    createdJobIds.push(jobId);

    // 1. Verify PostgreSQL row has status QUEUED
    const dbJob = await jobRepository.findById(jobId);
    expect(dbJob).not.toBeNull();
    expect(dbJob?.status).toBe(JobStatus.QUEUED);

    // 2. Verify Job ID stored in Redis list
    const len = await queueService.queueLength(testQueueName);
    expect(len).toBe(1);

    const queuedIds = await queueService.peek(testQueueName);
    expect(queuedIds).toContain(jobId);

    // 3. Verify Queue Key Factory namespace
    const itemsInRedis = await redisClient.lrange(QueueKeyFactory.queue(testQueueName), 0, -1);
    expect(itemsInRedis).toEqual([jobId]);
  });

  it('Durable Source of Truth - should preserve job in PostgreSQL as PENDING when Redis fails', async () => {
    const failingQueueService = {
      enqueue: jest.fn().mockRejectedValue(new Error('Redis connection timeout')),
      remove: jest.fn().mockResolvedValue(true),
    } as unknown as typeof queueService;

    const customJobService = new JobService(jobRepository, failingQueueService);

    await expect(
      customJobService.createJob({
        name: 'durable-test-job',
        queueName: 'failing.queue',
      }),
    ).rejects.toThrow(EnqueueFailedError);

    // Find the persisted job in PostgreSQL
    const paginated = await jobRepository.listJobs({ queueName: 'failing.queue' });
    expect(paginated.jobs.length).toBe(1);

    const persistedJob = paginated.jobs[0];
    expect(persistedJob).toBeDefined();
    if (persistedJob) {
      createdJobIds.push(persistedJob.id);
      expect(persistedJob.status).toBe(JobStatus.PENDING);
      expect(persistedJob.failureReason).toBe('REDIS_ENQUEUE_FAILED');
      expect(persistedJob.errorMessage).toContain('Redis connection timeout');
    }
  });

  it('should return queue metrics including pending and queued counts', async () => {
    const j1 = await request(app)
      .post('/api/v1/jobs')
      .send({ name: 'metric-job-1', queueName: testQueueName })
      .expect(201);
    createdJobIds.push((j1.body as ApiResponseSuccess<JobResponseDTO>).data.id);

    const metrics = await queueService.getMetrics(testQueueName);
    expect(metrics.queued).toBeGreaterThanOrEqual(1);
    expect(metrics.pending).toBeDefined();
  });
});
