import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

export const correlationIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const headerVal = req.headers['x-correlation-id'] || req.headers['X-Correlation-ID'];
  const correlationId = (Array.isArray(headerVal) ? headerVal[0] : headerVal) || randomUUID();

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  next();
};
