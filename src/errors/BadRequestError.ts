import { AppError } from './AppError.js';
import { HTTP_STATUS } from '../constants/statusCodes.js';

export class BadRequestError extends AppError {
  constructor(message = 'Bad request payload or parameter', details: unknown = null) {
    super(message, HTTP_STATUS.BAD_REQUEST, 'BAD_REQUEST', true, details);
  }
}
