import { HTTP_STATUS } from '../constants/statusCodes.js';
import { AppError } from '../errors/AppError.js';

export class QueueUnavailableError extends AppError {
  constructor(message = 'Queue engine is currently unavailable', details: unknown = null) {
    super(message, HTTP_STATUS.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE', true, details);
  }
}

export class EnqueueFailedError extends AppError {
  constructor(message = 'Failed to enqueue job into queue transport', details: unknown = null) {
    super(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'INTERNAL_SERVER_ERROR', true, details);
  }
}

export class QueueNotFoundError extends AppError {
  constructor(queueName: string, details: unknown = null) {
    super(`Queue '${queueName}' was not found`, HTTP_STATUS.NOT_FOUND, 'NOT_FOUND', true, details);
  }
}
