import request from 'supertest';
import app from '../../src/app.js';

interface LivenessResponse {
  status: string;
  uptime: number;
}

interface ReadinessResponse {
  status: string;
  components: {
    database: string;
    redis: string;
  };
}

describe('Health & Readiness Endpoints', () => {
  it('should return 200 OK for /health/live liveness check without external dependencies', async () => {
    const res = await request(app).get('/health/live');
    const body = res.body as LivenessResponse;
    expect(res.status).toBe(200);
    expect(body.status).toBe('UP');
    expect(body.uptime).toBeDefined();
  });

  it('should return 200 OK for /health/ready when PostgreSQL and Redis are connected', async () => {
    const res = await request(app).get('/health/ready');
    const body = res.body as ReadinessResponse;
    expect(res.status).toBe(200);
    expect(body.status).toBe('UP');
    expect(body.components.database).toBe('UP');
    expect(body.components.redis).toBe('UP');
  });
});
