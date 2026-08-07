import { CustomError } from '../errors/CustomError';

export class InvalidCronExpressionError extends CustomError {
  readonly statusCode = 400;
  readonly code = 'INVALID_CRON_EXPRESSION';

  constructor(cronExpression: string, details?: string) {
    super(`Invalid cron expression '${cronExpression}'${details ? `: ${details}` : ''}`);
    Object.setPrototypeOf(this, InvalidCronExpressionError.prototype);
  }

  serializeErrors() {
    return [{ message: this.message, code: this.code }];
  }
}

export class ScheduleNotFoundError extends CustomError {
  readonly statusCode = 404;
  readonly code = 'SCHEDULE_NOT_FOUND';

  constructor(scheduleId: string) {
    super(`Schedule with ID '${scheduleId}' not found`);
    Object.setPrototypeOf(this, ScheduleNotFoundError.prototype);
  }

  serializeErrors() {
    return [{ message: this.message, code: this.code }];
  }
}

export class InvalidTimezoneError extends CustomError {
  readonly statusCode = 400;
  readonly code = 'INVALID_TIMEZONE';

  constructor(timezone: string) {
    super(`Invalid timezone '${timezone}'`);
    Object.setPrototypeOf(this, InvalidTimezoneError.prototype);
  }

  serializeErrors() {
    return [{ message: this.message, code: this.code }];
  }
}
