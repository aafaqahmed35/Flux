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

      const minute = parts[0] ?? '';
      const hour = parts[1] ?? '';
      const dayOfMonth = parts[2] ?? '';
      const month = parts[3] ?? '';
      const dayOfWeek = parts[4] ?? '';

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
    const minuteStr = parts[0] ?? '*';
    const hourStr = parts[1] ?? '*';
    const domStr = parts[2] ?? '*';
    const monthStr = parts[3] ?? '*';
    const dowStr = parts[4] ?? '*';

    const minuteAllowed = this.parseField(minuteStr, 0, 59);
    const hourAllowed = this.parseField(hourStr, 0, 23);
    const dayOfMonthAllowed = this.parseField(domStr, 1, 31);
    const monthAllowed = this.parseField(monthStr, 1, 12);
    const dayOfWeekAllowed = this.parseField(dowStr, 0, 7);

    if (
      !minuteAllowed ||
      !hourAllowed ||
      !dayOfMonthAllowed ||
      !monthAllowed ||
      !dayOfWeekAllowed
    ) {
      throw new InvalidCronExpressionError(expression);
    }

    // Convert 7 (Sunday) to 0 if present in dayOfWeekAllowed
    if (dayOfWeekAllowed.has(7)) {
      dayOfWeekAllowed.add(0);
    }

    const isDomRestricted = domStr !== '*';
    const isDowRestricted = dowStr !== '*';

    // Guaranteed strictly-after invariant: candidate date must be > fromDate
    const baseTime = options?.fromDate ? options.fromDate.getTime() : Date.now();
    const current = new Date(baseTime + 60000);
    current.setMilliseconds(0);
    current.setSeconds(0);

    // Limit safety iterations to 5 years (approx 2.6 million minutes)
    const maxIterations = 2628000;
    let iterations = 0;

    while (iterations < maxIterations) {
      const partsTz = this.getZonedParts(current, timezone);

      const monthMatches = monthAllowed.has(partsTz.month);
      const hourMatches = hourAllowed.has(partsTz.hour);
      const minuteMatches = minuteAllowed.has(partsTz.minute);

      const domMatches = dayOfMonthAllowed.has(partsTz.dayOfMonth);
      const dowMatches = dayOfWeekAllowed.has(partsTz.dayOfWeek);

      let dayMatches = false;
      if (isDomRestricted && isDowRestricted) {
        // POSIX standard: If both DOM and DOW are restricted, match if EITHER matches (OR)
        dayMatches = domMatches || dowMatches;
      } else {
        // Normal evaluation (AND)
        dayMatches = domMatches && dowMatches;
      }

      if (monthMatches && dayMatches && hourMatches && minuteMatches) {
        return current;
      }

      // Advance by 1 minute
      current.setTime(current.getTime() + 60000);
      iterations++;
    }

    throw new Error(
      `Could not find next execution date for expression '${expression}' within safety limit`,
    );
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

      const basePattern = stepParts[0] ?? '';
      const stepStr = stepParts[1];
      const step = stepParts.length === 2 && stepStr !== undefined ? parseInt(stepStr, 10) : 1;
      if (isNaN(step) || step <= 0) return null;

      let start = min;
      let end = max;

      if (basePattern !== '*') {
        if (basePattern.includes('-')) {
          const rangeParts = basePattern.split('-');
          if (rangeParts.length !== 2) return null;
          const startStr = rangeParts[0] ?? '';
          const endStr = rangeParts[1] ?? '';
          start = parseInt(startStr, 10);
          end = parseInt(endStr, 10);
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

    const weekdayStr = partsMap['weekday'] ?? 'Sun';
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    let hourVal = parseInt(partsMap['hour'] ?? '0', 10);
    if (hourVal === 24) hourVal = 0; // Intl library 24-hour edge case

    return {
      minute: parseInt(partsMap['minute'] ?? '0', 10),
      hour: hourVal,
      dayOfMonth: parseInt(partsMap['day'] ?? '1', 10),
      month: parseInt(partsMap['month'] ?? '1', 10),
      dayOfWeek: weekdayMap[weekdayStr] ?? 0,
    };
  }
}
