import { Response, NextFunction } from 'express';
import { rateLimitService } from './rate-limit.service.js';
import { AuthenticatedRequest } from '../../auth/auth.types.js';
import { HTTP_STATUS } from '../../constants/statusCodes.js';
import { prometheusRegistry } from '../../observability/prometheus.js';
import { METRIC_NAMES } from '../../observability/observability.constants.js';

export const createRateLimitMiddleware = (
  contextName: string,
  limit: number,
  windowSeconds = 60,
) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const identity = req.authContext?.userId || req.ip || 'anonymous';

    void (async (): Promise<void> => {
      try {
        const result = await rateLimitService.checkRateLimit(
          contextName,
          identity,
          limit,
          windowSeconds,
        );

        res.setHeader('X-RateLimit-Limit', result.limit);
        res.setHeader('X-RateLimit-Remaining', result.remaining);
        res.setHeader('X-RateLimit-Reset', result.resetSeconds);

        if (!result.allowed) {
          res.setHeader('Retry-After', result.resetSeconds);

          prometheusRegistry.incrementCounter(METRIC_NAMES.JOBS_FAILED_TOTAL, 1, {
            failure_type: 'RATE_LIMIT_EXCEEDED',
          });

          res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: `Too many requests for ${contextName}. Rate limit exceeded. Try again in ${result.resetSeconds} seconds.`,
            },
          });
          return;
        }

        next();
      } catch {
        next();
      }
    })();
  };
};
