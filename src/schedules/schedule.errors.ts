import { AppError } from '../errors/AppError.js';
import { HTTP_STATUS } from '../constants/statusCodes.js';

export class InvalidCronExpressionError extends AppError {
  constructor(cronExpression: string, details?: string) {
    super(
      `Invalid cron expression '${cronExpression}'${details ? `: ${details}` : ''}`,
      HTTP_STATUS.BAD_REQUEST,
      'INVALID_CRON_EXPRESSION',
      true,
      details,
    );
  }
}

export class ScheduleNotFoundError extends AppError {
  constructor(scheduleId: string) {
    super(
      `Schedule with ID '${scheduleId}' not found`,
      HTTP_STATUS.NOT_FOUND,
      'SCHEDULE_NOT_FOUND',
      true,
      { scheduleId },
    );
  }
}

export class InvalidTimezoneError extends AppError {
  constructor(timezone: string) {
    super(`Invalid timezone '${timezone}'`, HTTP_STATUS.BAD_REQUEST, 'INVALID_TIMEZONE', true, {
      timezone,
    });
  }
}
