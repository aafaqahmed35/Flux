import request from 'supertest';
import app from '../../src/app.js';
import { pgPool } from '../../src/database/postgres.js';
import { ApiResponseError } from '../../src/interfaces/apiResponse.interface.js';
import { redisClient } from '../../src/redis/redis.js';

describe('GET /health Integration Test', () => {
  afterAll(async () => {
    await pgPool.end();
    if (redisClient.status !== 'end') {
      await redisClient.quit();
    }
  });

  it('should return HTTP 200 OK with enriched health information and component metrics', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    expect(body['status']).toBe('UP');
    expect(body['service']).toBe('Flux');
    expect(typeof body['version']).toBe('string');
    expect(typeof body['uptime']).toBe('number');
    expect(typeof body['timestamp']).toBe('string');

    const components = body['components'] as Record<string, Record<string, unknown>> | undefined;
    expect(components).toBeDefined();
    expect(components?.['database']?.['status']).toBe('UP');
    expect(components?.['redis']?.['status']).toBe('UP');
    expect(components?.['redis']?.['version']).toBeDefined();
    expect(components?.['redis']?.['connectedClients']).toBeDefined();
    expect(components?.['migrations']?.['status']).toBe('UP');
    expect(typeof components?.['migrations']?.['appliedCount']).toBe('number');

    expect(components?.['queue']).toBeDefined();
    expect(typeof components?.['queue']?.['pending']).toBe('number');
    expect(typeof components?.['queue']?.['queued']).toBe('number');
  });

  it('should return HTTP 404 for an unregistered route with standardized error format', async () => {
    const response = await request(app).get('/non-existent-endpoint');

    expect(response.status).toBe(404);
    const body = response.body as ApiResponseError;
    expect(body.success).toBe(false);
    expect(body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Route GET /non-existent-endpoint not found',
      details: null,
    });
    expect(typeof body.timestamp).toBe('string');
    expect(body.path).toBe('/non-existent-endpoint');
  });
});
