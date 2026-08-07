import { AppError } from './AppError.js';
import { HTTP_STATUS } from '../constants/statusCodes.js';

export class InvalidJobStateError extends AppError {
  constructor(message: string, details: unknown = null) {
    super(message, HTTP_STATUS.BAD_REQUEST, 'INVALID_JOB_STATE', true, details);
  }
}
