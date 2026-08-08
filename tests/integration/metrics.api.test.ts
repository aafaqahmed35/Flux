import request from 'supertest';
import app from '../../src/app.js';
import { closePostgresConnection } from '../../src/database/postgres.js';
import { closeRedisConnection } from '../../src/redis/redis.js';

describe('Metrics API Endpoint Integration Tests', () => {
  afterAll(async () => {
    await closePostgresConnection();
    await closeRedisConnection();
  });

  it('GET /metrics should return 200 and valid Prometheus metrics exposition text', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');

    const body = res.text;
    expect(body).toContain('flux_jobs_created_total');
    expect(body).toContain('flux_queue_depth');
    expect(body).toContain('flux_worker_active');
    expect(body).toContain('flux_scheduler_lag_ms');
  });

  interface HealthResponseBody {
    components: {
      observability: {
        metrics: boolean;
        serviceName: string;
      };
    };
  }

  it('GET /health should return 200 and include observability status section', async () => {
    const res = await request(app).get('/health');
    const body = res.body as HealthResponseBody;
    expect(res.status).toBe(200);
    expect(body.components.observability).toBeDefined();
    expect(body.components.observability.metrics).toBe(true);
    expect(body.components.observability.serviceName).toBeDefined();
  });
});
