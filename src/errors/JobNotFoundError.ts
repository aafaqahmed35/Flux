import { AppError } from './AppError.js';
import { HTTP_STATUS } from '../constants/statusCodes.js';

export class JobNotFoundError extends AppError {
  constructor(jobId: string, details: unknown = null) {
    super(
      `Job with ID '${jobId}' was not found`,
      HTTP_STATUS.NOT_FOUND,
      'JOB_NOT_FOUND',
      true,
      details,
    );
  }
}
