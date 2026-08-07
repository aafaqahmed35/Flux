import { HTTP_STATUS } from '../constants/statusCodes.js';
import { AppError } from '../errors/AppError.js';

export class WorkerError extends AppError {
  constructor(message = 'Worker runtime error', details: unknown = null) {
    super(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'INTERNAL_SERVER_ERROR', true, details);
  }
}

export class ProcessorNotFoundError extends AppError {
  constructor(queueName: string, details: unknown = null) {
    super(
      `No job processor registered for queue '${queueName}'`,
      HTTP_STATUS.NOT_FOUND,
      'NOT_FOUND',
      true,
      details,
    );
  }
}

export class JobClaimFailedError extends AppError {
  constructor(jobId: string, details: unknown = null) {
    super(
      `Failed to claim job '${jobId}'`,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      'INTERNAL_SERVER_ERROR',
      true,
      details,
    );
  }
}
