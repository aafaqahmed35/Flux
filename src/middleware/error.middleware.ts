import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { errorLogger } from '../logger/logger.js';
import { HTTP_STATUS, HttpStatusCode } from '../constants/statusCodes.js';
import { ApiResponseError } from '../interfaces/apiResponse.interface.js';
import { serverConfig } from '../config/server.js';

export const errorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  let statusCode: HttpStatusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;
  let code: string = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected internal error occurred';
  let details: unknown = null;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.errorCode;
    message = err.message;
    details = err.details;
  } else {
    // Unhandled exception
    message =
      serverConfig.env === 'production' ? 'An unexpected internal error occurred' : err.message;
  }

  errorLogger.error(`[${code}] ${req.method} ${req.originalUrl} - ${err.message}`, {
    path: req.originalUrl,
    method: req.method,
    statusCode,
    code,
    stack: err.stack,
    details,
  });

  const responseBody: ApiResponseError = {
    success: false,
    error: {
      code,
      message,
      details,
    },
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
  };

  res.status(statusCode).json(responseBody);
};
