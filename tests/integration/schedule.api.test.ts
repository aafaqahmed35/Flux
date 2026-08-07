import request from 'supertest';
import express from 'express';
import { getPgPool } from '../../src/database/postgres';
import { getRedisClient } from '../../src/redis/redis';
import { appRouter } from '../../src/routes';
import { errorHandler } from '../../src/middleware/error.middleware';

const app = express();
app.use(express.json());
app.use(appRouter);
app.use(errorHandler);

describe('Schedule API Integration Tests', () => {
  let createdScheduleId: string;
  const testQueue = `sch-api-test-${Date.now()}`;

  afterAll(async () => {
    try {
      const pool = getPgPool();
      await pool.query('DELETE FROM schedule_execution_history WHERE schedule_id IN (SELECT id FROM schedules WHERE queue_name = $1)', [testQueue]);
      await pool.query('DELETE FROM schedules WHERE queue_name = $1', [testQueue]);
    } catch {
      // Cleanup fallback
    }
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

    expect(res.status).toBe(201);
    expect(res.headers.location).toBeDefined();
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.name).toBe('api-test-schedule');

    createdScheduleId = res.body.data.id;
  });

  it('GET /api/v1/schedules - should list schedules with pagination', async () => {
    const res = await request(app)
      .get('/api/v1/schedules')
      .query({ queueName: testQueue });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/schedules/:id - should retrieve schedule details', async () => {
    const res = await request(app).get(`/api/v1/schedules/${createdScheduleId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(createdScheduleId);
  });

  it('PATCH /api/v1/schedules/:id - should update schedule properties', async () => {
    const res = await request(app)
      .patch(`/api/v1/schedules/${createdScheduleId}`)
      .send({
        cronExpression: '0 0 * * *',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.cronExpression).toBe('0 0 * * *');
  });

  it('POST /api/v1/schedules/:id/disable & /enable - should toggle schedule', async () => {
    const disableRes = await request(app).post(`/api/v1/schedules/${createdScheduleId}/disable`);
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.data.enabled).toBe(false);

    const enableRes = await request(app).post(`/api/v1/schedules/${createdScheduleId}/enable`);
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.data.enabled).toBe(true);
  });

  it('POST /api/v1/schedules/:id/run - should trigger schedule manually', async () => {
    const res = await request(app).post(`/api/v1/schedules/${createdScheduleId}/run`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.jobId).toBeDefined();
  });

  it('GET /api/v1/schedules/:id/history - should retrieve execution history', async () => {
    const res = await request(app).get(`/api/v1/schedules/${createdScheduleId}/history`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('DELETE /api/v1/schedules/:id - should delete schedule', async () => {
    const res = await request(app).delete(`/api/v1/schedules/${createdScheduleId}`);
    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/v1/schedules/${createdScheduleId}`);
    expect(getRes.status).toBe(404);
  });
});
