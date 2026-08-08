import request from 'supertest';
import app from '../../src/app.js';
import { rateLimitService } from '../../src/security/rate-limit/rate-limit.service.js';

interface ApiResponse {
  success: boolean;
  error?: { code: string; message: string };
}

describe('Rate Limiting Integration Tests', () => {
  it('should enforce Redis rate limit and return 429 Too Many Requests', async () => {
    // Force a tight limit check mock for test context
    jest.spyOn(rateLimitService, 'checkRateLimit').mockResolvedValueOnce({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetSeconds: 60,
    });

    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'test@flux.com',
      password: 'password',
    });

    const body = res.body as ApiResponse;
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
    expect(body.error?.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
