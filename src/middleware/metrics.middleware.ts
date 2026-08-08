import { Request, Response, NextFunction } from 'express';
import { prometheusRegistry } from '../observability/prometheus.js';
import { METRIC_NAMES } from '../observability/observability.constants.js';

export const normalizeRoute = (req: Request): string => {
  const reqWithRoute = req as unknown as { route?: { path?: string } };
  if (reqWithRoute.route && typeof reqWithRoute.route.path === 'string') {
    const baseUrl = req.baseUrl || '';
    return `${baseUrl}${reqWithRoute.route.path}`;
  }

  // Fallback pattern matching for common UUID/ID endpoints if route matching is transient
  const path = req.path || req.originalUrl || '/';
  const normalized = path.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ':id',
  );
  return normalized.split('?')[0] || '/';
};

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (req.path === '/metrics' || req.originalUrl === '/metrics') {
    next();
    return;
  }

  const startTime = Date.now();

  res.on('finish', () => {
    try {
      const durationMs = Date.now() - startTime;
      const route = normalizeRoute(req);
      const statusCode = String(res.statusCode);
      const method = req.method;

      prometheusRegistry.incrementCounter(METRIC_NAMES.API_REQUESTS_TOTAL, 1, {
        method,
        route,
        status_code: statusCode,
      });

      prometheusRegistry.recordHistogram(METRIC_NAMES.API_REQUEST_DURATION_MS, durationMs, {
        method,
        route,
        status_code: statusCode,
      });
    } catch {
      // Telemetry failure isolation
    }
  });

  next();
};
