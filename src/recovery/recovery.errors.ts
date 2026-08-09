import { AppError } from '../errors/AppError.js';
import { HTTP_STATUS } from '../constants/statusCodes.js';

export class RecoveryError extends AppError {
  constructor(message: string, details: Record<string, unknown> | null = null) {
    super(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'RECOVERY_ERROR', true, details);
  }
}

export class RecoveryConflictError extends AppError {
  constructor(message: string, details: Record<string, unknown> | null = null) {
    super(message, HTTP_STATUS.CONFLICT, 'RECOVERY_CONFLICT', true, details);
  }
}

export class RecoveryLimitExceededError extends AppError {
  constructor(message: string, details: Record<string, unknown> | null = null) {
    super(message, HTTP_STATUS.TOO_MANY_REQUESTS, 'RECOVERY_LIMIT_EXCEEDED', true, details);
  }
}

export class ReconciliationError extends AppError {
  constructor(message: string, details: Record<string, unknown> | null = null) {
    super(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'RECONCILIATION_ERROR', true, details);
  }
}

export class StaleJobError extends AppError {
  constructor(message: string, details: Record<string, unknown> | null = null) {
    super(message, HTTP_STATUS.BAD_REQUEST, 'STALE_JOB_ERROR', true, details);
  }
}
