import { CRON_MACROS, DEFAULT_SCHEDULE_TIMEZONE } from './schedule.constants';
import { InvalidCronExpressionError, InvalidTimezoneError } from './schedule.errors';

export interface GetNextRunOptions {
  fromDate?: Date;
  timezone?: string;
}

export class CronEngine {
  /**
   * Expands macros (@daily, @hourly, etc.) and validates syntax.
   */
  public static normalizeExpression(expression: string): string {
    const trimmed = expression.trim();
    if (CRON_MACROS[trimmed]) {
      return CRON_MACROS[trimmed];
    }
    return trimmed;
  }

  /**
   * Validates if a timezone identifier is supported by the runtime Environment.
   */
  public static isValidTimezone(timezone: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks if a cron expression is valid syntactically and logically.
   */
  public static isValid(expression: string, timezone: string = DEFAULT_SCHEDULE_TIMEZONE): boolean {
    if (!this.isValidTimezone(timezone)) {
      return false;
    }

    try {
      const normalized = this.normalizeExpression(expression);
      const parts = normalized.split(/\s+/);
      if (parts.length !== 5) {
        return false;
      }

      const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

      return (
        this.parseField(minute, 0, 59) !== null &&
        this.parseField(hour, 0, 23) !== null &&
        this.parseField(dayOfMonth, 1, 31) !== null &&
        this.parseField(month, 1, 12) !== null &&
        this.parseField(dayOfWeek, 0, 7) !== null
      );
    } catch {
      return false;
    }
  }

  /**
   * Calculates the next execution Date for a given cron expression and timezone.
   */
  public static getNextRun(expression: string, options?: GetNextRunOptions): Date {
    const timezone = options?.timezone || DEFAULT_SCHEDULE_TIMEZONE;
    if (!this.isValidTimezone(timezone)) {
      throw new InvalidTimezoneError(timezone);
    }

    const normalized = this.normalizeExpression(expression);
    if (!this.isValid(normalized, timezone)) {
      throw new InvalidCronExpressionError(expression);
    }

    const parts = normalized.split(/\s+/);
    const minuteAllowed = this.parseField(parts[0], 0, 59)!;
    const hourAllowed = this.parseField(parts[1], 0, 23)!;
    const dayOfMonthAllowed = this.parseField(parts[2], 1, 31)!;
    const monthAllowed = this.parseField(parts[3], 1, 12)!;
    const dayOfWeekAllowed = this.parseField(parts[4], 0, 7)!;

    // Convert 7 (Sunday) to 0 if present in dayOfWeekAllowed
    if (dayOfWeekAllowed.has(7)) {
      dayOfWeekAllowed.add(0);
    }

    const startFrom = options?.fromDate ? new Date(options.fromDate.getTime() + 1000) : new Date(Date.now() + 1000);
    // Start searching minute-by-minute starting at 0 seconds
    const current = new Date(startFrom.getTime());
    current.setMilliseconds(0);
    current.setSeconds(0);

    // Limit safety iterations to 5 years (approx 2.6 million minutes)
    const maxIterations = 2628000;
    let iterations = 0;

    while (iterations < maxIterations) {
      const partsTz = this.getZonedParts(current, timezone);

      if (
        monthAllowed.has(partsTz.month) &&
        dayOfMonthAllowed.has(partsTz.dayOfMonth) &&
        dayOfWeekAllowed.has(partsTz.dayOfWeek) &&
        hourAllowed.has(partsTz.hour) &&
        minuteAllowed.has(partsTz.minute)
      ) {
        return current;
      }

      // Advance by 1 minute
      current.setTime(current.getTime() + 60000);
      iterations++;
    }

    throw new Error(`Could not find next execution date for expression '${expression}' within safety limit`);
  }

  /**
   * Helper to parse field into set of allowed integers.
   */
  private static parseField(field: string, min: number, max: number): Set<number> | null {
    const allowed = new Set<number>();

    const subparts = field.split(',');
    for (const subpart of subparts) {
      if (subpart === '') return null;

      // Handle step syntax: pattern/step
      const stepParts = subpart.split('/');
      if (stepParts.length > 2) return null;

      const basePattern = stepParts[0];
      const step = stepParts.length === 2 ? parseInt(stepParts[1], 10) : 1;
      if (isNaN(step) || step <= 0) return null;

      let start = min;
      let end = max;

      if (basePattern !== '*') {
        if (basePattern.includes('-')) {
          const rangeParts = basePattern.split('-');
          if (rangeParts.length !== 2) return null;
          start = parseInt(rangeParts[0], 10);
          end = parseInt(rangeParts[1], 10);
          if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) {
            return null;
          }
        } else {
          start = parseInt(basePattern, 10);
          end = start;
          if (isNaN(start) || start < min || start > max) {
            return null;
          }
        }
      }

      for (let i = start; i <= end; i += step) {
        allowed.add(i);
      }
    }

    return allowed.size > 0 ? allowed : null;
  }

  /**
   * Returns date fields breaking down according to specific IANA timezone.
   */
  private static getZonedParts(
    date: Date,
    timezone: string,
  ): { minute: number; hour: number; dayOfMonth: number; month: number; dayOfWeek: number } {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });

    const formattedParts = dtf.formatToParts(date);
    const partsMap: Record<string, string> = {};
    for (const p of formattedParts) {
      partsMap[p.type] = p.value;
    }

    const weekdayStr = partsMap['weekday'];
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    let hourVal = parseInt(partsMap['hour'], 10);
    if (hourVal === 24) hourVal = 0; // Intl library 24-hour edge case

    return {
      minute: parseInt(partsMap['minute'], 10),
      hour: hourVal,
      dayOfMonth: parseInt(partsMap['day'], 10),
      month: parseInt(partsMap['month'], 10),
      dayOfWeek: weekdayMap[weekdayStr] ?? 0,
    };
  }
}
