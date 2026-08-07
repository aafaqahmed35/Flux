import { AppError } from './AppError.js';
import { HTTP_STATUS } from '../constants/statusCodes.js';

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details: unknown = null) {
    super(message, HTTP_STATUS.NOT_FOUND, 'NOT_FOUND', true, details);
  }
}
