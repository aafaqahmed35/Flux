import request from 'supertest';
import express from 'express';
import { pgPool, closePostgresConnection } from '../../src/database/postgres.js';
import { closeRedisConnection } from '../../src/redis/redis.js';
import { appRouter } from '../../src/routes/index.js';
import { errorMiddleware } from '../../src/middleware/error.middleware.js';

const app = express();
app.use(express.json());
app.use(appRouter);
app.use(errorMiddleware);

interface ApiResponse {
  success: boolean;
  data: {
    id: string;
    name: string;
    cronExpression: string;
    enabled: boolean;
    jobId: string;
    [key: string]: unknown;
  };
}

describe('Schedule API Integration Tests', () => {
  let createdScheduleId: string;
  const testQueue = `sch-api-test-${Date.now()}`;

  afterAll(async () => {
    try {
      await pgPool.query(
        'DELETE FROM schedule_execution_history WHERE schedule_id IN (SELECT id FROM schedules WHERE queue_name = $1)',
        [testQueue],
      );
      await pgPool.query('DELETE FROM schedules WHERE queue_name = $1', [testQueue]);
    } catch {
      // Cleanup fallback
    }
    await closePostgresConnection();
    await closeRedisConnection();
  });

  it('POST /api/v1/schedules - should create new recurring schedule', async () => {
    const res = await request(app)
      .post('/api/v1/schedules')
      .send({
        name: 'api-test-schedule',
        queueName: testQueue,
        cronExpression: '*/10 * * * *',
        timezone: 'UTC',
        payload: { reportId: 42 },
      });

    const body = res.body as ApiResponse;
    expect(res.status).toBe(201);
    expect(res.headers.location).toBeDefined();
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.name).toBe('api-test-schedule');

    createdScheduleId = body.data.id;
  });

  it('GET /api/v1/schedules - should list schedules with pagination', async () => {
    const res = await request(app).get('/api/v1/schedules').query({ queueName: testQueue });

    const body = res.body as { success: boolean; data: unknown[] };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/schedules/:id - should retrieve schedule details', async () => {
    const res = await request(app).get(`/api/v1/schedules/${createdScheduleId}`);
    const body = res.body as ApiResponse;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(createdScheduleId);
  });

  it('PATCH /api/v1/schedules/:id - should update schedule properties', async () => {
    const res = await request(app).patch(`/api/v1/schedules/${createdScheduleId}`).send({
      cronExpression: '0 0 * * *',
    });
    const body = res.body as ApiResponse;

    expect(res.status).toBe(200);
    expect(body.data.cronExpression).toBe('0 0 * * *');
  });

  it('POST /api/v1/schedules/:id/disable & /enable - should toggle schedule', async () => {
    const disableRes = await request(app).post(`/api/v1/schedules/${createdScheduleId}/disable`);
    const disableBody = disableRes.body as ApiResponse;
    expect(disableRes.status).toBe(200);
    expect(disableBody.data.enabled).toBe(false);

    const enableRes = await request(app).post(`/api/v1/schedules/${createdScheduleId}/enable`);
    const enableBody = enableRes.body as ApiResponse;
    expect(enableRes.status).toBe(200);
    expect(enableBody.data.enabled).toBe(true);
  });

  it('POST /api/v1/schedules/:id/run - should trigger schedule manually', async () => {
    const res = await request(app).post(`/api/v1/schedules/${createdScheduleId}/run`);
    const body = res.body as ApiResponse;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.jobId).toBeDefined();
  });

  it('GET /api/v1/schedules/:id/history - should retrieve execution history', async () => {
    const res = await request(app).get(`/api/v1/schedules/${createdScheduleId}/history`);
    const body = res.body as { success: boolean; data: unknown[] };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('DELETE /api/v1/schedules/:id - should delete schedule', async () => {
    const res = await request(app).delete(`/api/v1/schedules/${createdScheduleId}`);
    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/v1/schedules/${createdScheduleId}`);
    expect(getRes.status).toBe(404);
  });
});
