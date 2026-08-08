import request from 'supertest';
import app from '../../src/app.js';
import { authService } from '../../src/auth/auth.service.js';
import { apiKeyService } from '../../src/auth/api-key.service.js';
import { pgPool } from '../../src/database/postgres.js';

interface ApiResponse {
  success: boolean;
  error?: { code: string; message: string };
  data?: unknown;
}

describe('Security & RBAC Integration Tests', () => {
  let viewerToken: string;
  let operatorToken: string;
  let operatorUserId: string;

  beforeAll(async () => {
    // Enable authentication for integration tests
    process.env.AUTH_ENABLED = 'true';

    // Clean up test users
    await pgPool.query("DELETE FROM users WHERE email LIKE '%@test-security.com'");

    await authService.createUser('admin@test-security.com', 'AdminPass123!', 'ADMIN');
    const operator = await authService.createUser('op@test-security.com', 'OpPass123!', 'OPERATOR');
    const viewer = await authService.createUser('viewer@test-security.com', 'ViewPass123!', 'VIEWER');

    operatorUserId = operator.id;

    operatorToken = authService.generateAccessToken(operator);
    viewerToken = authService.generateAccessToken(viewer);
  });

  afterAll(async () => {
    process.env.AUTH_ENABLED = 'false';
    await pgPool.query("DELETE FROM users WHERE email LIKE '%@test-security.com'");
  });

  it('should reject unauthenticated request to protected route with HTTP 401', async () => {
    const res = await request(app).get('/api/v1/jobs');
    const body = res.body as ApiResponse;

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('should allow authenticated Viewer to read jobs (200 OK)', async () => {
    const res = await request(app)
      .get('/api/v1/jobs')
      .set('Authorization', `Bearer ${viewerToken}`);

    const body = res.body as ApiResponse;
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should reject Viewer attempting job creation with HTTP 403 Forbidden', async () => {
    const res = await request(app)
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'unauthorized-job', queueName: 'default' });

    const body = res.body as ApiResponse;
    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('should allow Operator to create a job (201 Created)', async () => {
    const res = await request(app)
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'authorized-job', queueName: 'default', payload: { test: true } });

    const body = res.body as ApiResponse;
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
  });

  it('should support API Key authentication via X-API-Key header', async () => {
    const { rawKey } = await apiKeyService.createApiKey({
      userId: operatorUserId,
      name: 'Integration Test Key',
    });

    const res = await request(app)
      .get('/api/v1/jobs')
      .set('X-API-Key', rawKey);

    const body = res.body as ApiResponse;
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
