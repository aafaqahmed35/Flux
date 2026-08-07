import request from 'supertest';
import app from '../../src/app.js';
import { JobPriority, JobStatus } from '../../src/constants/job.constants.js';
import { runMigrations } from '../../src/database/migrator.js';
import { pgPool } from '../../src/database/postgres.js';
import {
  CancelJobResponseDTO,
  DeleteJobResponseDTO,
  JobResponseDTO,
  ListJobsResponseDTO,
} from '../../src/dtos/job.dto.js';
import {
  ApiResponseError,
  ApiResponseSuccess,
} from '../../src/interfaces/apiResponse.interface.js';
import { redisClient } from '../../src/redis/redis.js';
import { jobRepository } from '../../src/repositories/job.repository.js';

describe('Job REST API Integration Tests (/api/v1/jobs)', () => {
  const createdJobIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();
  });

  afterEach(async () => {
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

  it('POST /api/v1/jobs - should create a job and return HTTP 201 with Location header', async () => {
    const payload = {
      name: 'send-newsletter',
      queueName: 'emails.marketing',
      payload: { subscriberId: 'sub_999' },
      priority: JobPriority.HIGH,
    };

    const res = await request(app).post('/api/v1/jobs').send(payload).expect(201);
    const body = res.body as ApiResponseSuccess<JobResponseDTO>;

    expect(res.headers['location']).toBe(`/api/v1/jobs/${body.data.id}`);
    expect(res.headers['x-correlation-id']).toBeDefined();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('send-newsletter');
    expect(body.data.status).toBe(JobStatus.QUEUED);
    expect(body.data.priority).toBe(JobPriority.HIGH);

    createdJobIds.push(body.data.id);
  });

  it('POST /api/v1/jobs - should handle Idempotency-Key header and return 200 for duplicate request', async () => {
    const key = `idemp-api-${Date.now()}`;
    const payload = {
      name: 'charge-card',
      queueName: 'payments.api',
      payload: { amount: 5000 },
    };

    const res1 = await request(app)
      .post('/api/v1/jobs')
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    const body1 = res1.body as ApiResponseSuccess<JobResponseDTO>;
    createdJobIds.push(body1.data.id);

    const res2 = await request(app)
      .post('/api/v1/jobs')
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(200);
    const body2 = res2.body as ApiResponseSuccess<JobResponseDTO>;

    expect(body2.data.id).toBe(body1.data.id);
  });

  it('POST /api/v1/jobs - should handle concurrent idempotency requests safely (race condition test)', async () => {
    const raceKey = `idemp-race-${Date.now()}`;
    const payload = {
      name: 'concurrent-task',
      queueName: 'tasks.concurrent',
    };

    const [resA, resB] = await Promise.all([
      request(app).post('/api/v1/jobs').set('Idempotency-Key', raceKey).send(payload),
      request(app).post('/api/v1/jobs').set('Idempotency-Key', raceKey).send(payload),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 201]);

    const bodyA = resA.body as ApiResponseSuccess<JobResponseDTO>;
    const bodyB = resB.body as ApiResponseSuccess<JobResponseDTO>;

    const idA = bodyA.data.id;
    const idB = bodyB.data.id;
    expect(idA).toBe(idB);
    createdJobIds.push(idA);
  });

  it('GET /api/v1/jobs/:id - should retrieve a job by ID', async () => {
    const created = await jobRepository.createJob({
      name: 'get-test',
      queueName: 'default.api',
    });
    createdJobIds.push(created.id);

    const res = await request(app).get(`/api/v1/jobs/${created.id}`).expect(200);
    const body = res.body as ApiResponseSuccess<JobResponseDTO>;

    expect(body.success).toBe(true);
    expect(body.data.id).toBe(created.id);
    expect(body.data.name).toBe('get-test');
  });

  it('GET /api/v1/jobs/:id - should return 404 for non-existent UUID', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app).get(`/api/v1/jobs/${fakeId}`).expect(404);
    const body = res.body as ApiResponseError;

    expect(body.success).toBe(false);
    expect(body.error.code).toBe('JOB_NOT_FOUND');
  });

  it('GET /api/v1/jobs - should return paginated, filtered, and sorted jobs', async () => {
    const qName = `list-api-${Date.now()}`;
    const j1 = await jobRepository.createJob({
      name: 'job-1',
      queueName: qName,
      priority: JobPriority.LOW,
    });
    const j2 = await jobRepository.createJob({
      name: 'job-2',
      queueName: qName,
      priority: JobPriority.CRITICAL,
    });
    createdJobIds.push(j1.id, j2.id);

    const res = await request(app)
      .get(`/api/v1/jobs?queue=${qName}&page=1&limit=10&sortBy=createdAt&sortOrder=desc`)
      .expect(200);

    const body = res.body as ApiResponseSuccess<ListJobsResponseDTO>;

    expect(body.success).toBe(true);
    expect(body.data.pagination.total).toBe(2);
    expect(body.data.items.length).toBe(2);
  });

  it('PATCH /api/v1/jobs/:id/cancel - should cancel a job', async () => {
    const job = await jobRepository.createJob({
      name: 'cancel-me',
      queueName: 'default.api',
    });
    createdJobIds.push(job.id);

    const res = await request(app)
      .patch(`/api/v1/jobs/${job.id}/cancel`)
      .send({ reason: 'User requested stop' })
      .expect(200);

    const body = res.body as ApiResponseSuccess<CancelJobResponseDTO>;

    expect(body.success).toBe(true);
    expect(body.data.job.status).toBe(JobStatus.CANCELLED);
    expect(body.data.job.failureReason).toBe('User requested stop');
  });

  it('DELETE /api/v1/jobs/:id - should soft delete job and hide it from subsequent GETs', async () => {
    const job = await jobRepository.createJob({
      name: 'delete-me',
      queueName: 'default.api',
    });

    const res = await request(app).delete(`/api/v1/jobs/${job.id}`).expect(200);
    const body = res.body as ApiResponseSuccess<DeleteJobResponseDTO>;

    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(true);

    await request(app).get(`/api/v1/jobs/${job.id}`).expect(404);
  });

  it('POST /api/v1/jobs - should return 400 Bad Request for validation errors', async () => {
    const invalidPayload = {
      name: '', // Empty name
      queueName: 'invalid queue name!', // Invalid characters
    };

    const res = await request(app).post('/api/v1/jobs').send(invalidPayload).expect(400);
    const body = res.body as ApiResponseError;

    expect(body.success).toBe(false);
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});
