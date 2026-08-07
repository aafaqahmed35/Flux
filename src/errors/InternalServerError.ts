import { AppError } from './AppError.js';
import { HTTP_STATUS } from '../constants/statusCodes.js';

export class InternalServerError extends AppError {
  constructor(message = 'An unexpected internal error occurred', details: unknown = null) {
    super(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'INTERNAL_SERVER_ERROR', false, details);
  }
}
