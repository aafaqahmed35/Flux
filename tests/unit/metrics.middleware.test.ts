import { Request, Response } from 'express';
import { metricsMiddleware, normalizeRoute } from '../../src/middleware/metrics.middleware.js';
import { prometheusRegistry } from '../../src/observability/prometheus.js';

describe('MetricsMiddleware Unit Tests', () => {
  it('should normalize UUID endpoints to route parameters', () => {
    const req = {
      path: '/api/v1/jobs/123e4567-e89b-12d3-a456-426614174000',
      originalUrl: '/api/v1/jobs/123e4567-e89b-12d3-a456-426614174000',
    } as Request;

    const normalized = normalizeRoute(req);
    expect(normalized).toBe('/api/v1/jobs/:id');
  });

  it('should use express route template if available', () => {
    const req = {
      baseUrl: '/api/v1/jobs',
      route: { path: '/:id' },
    } as unknown as Request;

    const normalized = normalizeRoute(req);
    expect(normalized).toBe('/api/v1/jobs/:id');
  });

  it('should instrument finish event on res', async () => {
    const req = {
      method: 'GET',
      path: '/api/v1/jobs',
      originalUrl: '/api/v1/jobs',
    } as Request;

    const listeners: Record<string, () => void> = {};
    const res = {
      statusCode: 200,
      on: (event: string, cb: () => void) => {
        listeners[event] = cb;
      },
    } as unknown as Response;

    const next = jest.fn();

    metricsMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();

    // Trigger finish
    if (listeners['finish']) {
      listeners['finish']();
    }

    const metricsText = await prometheusRegistry.getMetricsText();
    expect(metricsText).toContain(
      'flux_api_requests_total{method="GET",route="/api/v1/jobs",status_code="200"} 1',
    );
  });

  it('should skip instrumentation for /metrics endpoint', () => {
    const req = { path: '/metrics' } as Request;
    const res = {} as Response;
    const next = jest.fn();

    metricsMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
