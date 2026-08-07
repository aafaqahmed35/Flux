import { Request, Response, NextFunction } from 'express';
import { httpLogger } from '../logger/logger.js';

export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const { method, originalUrl, ip } = req;
    const { statusCode } = res;

    httpLogger.info(`${method} ${originalUrl} ${statusCode} ${duration}ms`, {
      method,
      path: originalUrl,
      statusCode,
      durationMs: duration,
      ip: ip || req.socket.remoteAddress,
    });
  });

  next();
};
