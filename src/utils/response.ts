import { Response } from 'express';
import { ApiResponseSuccess } from '../interfaces/apiResponse.interface.js';

export const sendSuccess = <T>(
  res: Response,
  data: T,
  statusCode = 200,
  headers: Record<string, string> = {},
): void => {
  const body: ApiResponseSuccess<T> = {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };

  Object.entries(headers).forEach(([key, val]) => {
    res.setHeader(key, val);
  });

  res.status(statusCode).json(body);
};
