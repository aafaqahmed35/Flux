import { AppError } from '../errors/AppError.js';
import { HTTP_STATUS } from '../constants/statusCodes.js';

export class AuthenticationRequiredError extends AppError {
  constructor(message = 'Authentication credentials are required') {
    super(message, HTTP_STATUS.UNAUTHORIZED, 'AUTHENTICATION_REQUIRED');
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = 'Invalid email or password') {
    super(message, HTTP_STATUS.UNAUTHORIZED, 'INVALID_CREDENTIALS');
  }
}

export class InvalidApiKeyError extends AppError {
  constructor(message = 'Invalid or expired API key') {
    super(message, HTTP_STATUS.UNAUTHORIZED, 'INVALID_API_KEY');
  }
}

export class TokenExpiredError extends AppError {
  constructor(message = 'Authentication token has expired') {
    super(message, HTTP_STATUS.UNAUTHORIZED, 'TOKEN_EXPIRED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden for current user role') {
    super(message, HTTP_STATUS.FORBIDDEN, 'FORBIDDEN_ACCESS');
  }
}

export class InsufficientScopeError extends AppError {
  constructor(requiredScope: string) {
    super(
      `Insufficient permissions. Required scope: '${requiredScope}'`,
      HTTP_STATUS.FORBIDDEN,
      'INSUFFICIENT_SCOPE',
    );
  }
}
