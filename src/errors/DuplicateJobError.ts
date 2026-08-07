import { AppError } from './AppError.js';
import { HTTP_STATUS } from '../constants/statusCodes.js';

export class DuplicateJobError extends AppError {
  constructor(message: string, details: unknown = null) {
    super(message, HTTP_STATUS.CONFLICT, 'DUPLICATE_JOB', true, details);
  }
}
