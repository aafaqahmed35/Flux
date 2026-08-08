import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { tracingHelper } from '../observability/tracing.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId?: string;
      traceId?: string;
      spanId?: string;
    }
  }
}

export const correlationIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const headerVal = req.headers['x-correlation-id'] || req.headers['X-Correlation-ID'];
  const correlationId = (Array.isArray(headerVal) ? headerVal[0] : headerVal) || randomUUID();

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  const activeContext = tracingHelper.getActiveSpanContext();
  if (activeContext) {
    req.traceId = activeContext.traceId;
    req.spanId = activeContext.spanId;
  }

  next();
};
