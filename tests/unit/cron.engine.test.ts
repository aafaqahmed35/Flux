import { CronEngine } from '../../src/schedules/cron.engine';
import { InvalidCronExpressionError, InvalidTimezoneError } from '../../src/schedules/schedule.errors';

describe('CronEngine Unit Tests', () => {
  describe('isValidTimezone', () => {
    it('should validate valid IANA timezones', () => {
      expect(CronEngine.isValidTimezone('UTC')).toBe(true);
      expect(CronEngine.isValidTimezone('America/New_York')).toBe(true);
      expect(CronEngine.isValidTimezone('Asia/Tokyo')).toBe(true);
      expect(CronEngine.isValidTimezone('Europe/London')).toBe(true);
    });

    it('should reject invalid timezones', () => {
      expect(CronEngine.isValidTimezone('Invalid/Timezone')).toBe(false);
      expect(CronEngine.isValidTimezone('Mars/Olympus')).toBe(false);
    });
  });

  describe('normalizeExpression', () => {
    it('should expand macros to 5-part cron syntax', () => {
      expect(CronEngine.normalizeExpression('@hourly')).toBe('0 * * * *');
      expect(CronEngine.normalizeExpression('@daily')).toBe('0 0 * * *');
      expect(CronEngine.normalizeExpression('@midnight')).toBe('0 0 * * *');
      expect(CronEngine.normalizeExpression('@weekly')).toBe('0 0 * * 0');
      expect(CronEngine.normalizeExpression('@monthly')).toBe('0 0 1 * *');
      expect(CronEngine.normalizeExpression('@yearly')).toBe('0 0 1 1 *');
    });

    it('should pass through standard 5-part expressions', () => {
      expect(CronEngine.normalizeExpression('*/15 * * * *')).toBe('*/15 * * * *');
    });
  });

  describe('isValid', () => {
    it('should return true for valid cron expressions', () => {
      expect(CronEngine.isValid('* * * * *')).toBe(true);
      expect(CronEngine.isValid('0 0 * * *')).toBe(true);
      expect(CronEngine.isValid('*/15 9-17 1,15 * 1-5')).toBe(true);
      expect(CronEngine.isValid('@daily')).toBe(true);
    });

    it('should return false for invalid syntax', () => {
      expect(CronEngine.isValid('invalid cron')).toBe(false);
      expect(CronEngine.isValid('60 * * * *')).toBe(false); // minute out of range
      expect(CronEngine.isValid('* 24 * * *')).toBe(false); // hour out of range
      expect(CronEngine.isValid('* * 32 * *')).toBe(false); // day out of range
      expect(CronEngine.isValid('* * * 13 *')).toBe(false); // month out of range
      expect(CronEngine.isValid('* * * * 8')).toBe(false); // dayOfWeek out of range
    });
  });

  describe('getNextRun', () => {
    it('should calculate next run for @hourly cron expression', () => {
      const fromDate = new Date('2026-08-07T12:00:00.000Z');
      const nextRun = CronEngine.getNextRun('@hourly', { fromDate, timezone: 'UTC' });

      expect(nextRun.toISOString()).toBe('2026-08-07T13:00:00.000Z');
    });

    it('should calculate next run for step syntax */15 * * * *', () => {
      const fromDate = new Date('2026-08-07T12:07:00.000Z');
      const nextRun = CronEngine.getNextRun('*/15 * * * *', { fromDate, timezone: 'UTC' });

      expect(nextRun.toISOString()).toBe('2026-08-07T12:15:00.000Z');
    });

    it('should handle timezone offsets accurately', () => {
      const fromDate = new Date('2026-08-07T12:00:00.000Z');
      const nextRunTz = CronEngine.getNextRun('0 9 * * *', { fromDate, timezone: 'America/New_York' });

      // America/New_York is UTC-4 in August (EDT)
      // 9:00 AM EDT = 13:00 UTC
      expect(nextRunTz.getUTCHours()).toBe(13);
      expect(nextRunTz.getUTCMinutes()).toBe(0);
    });

    it('should throw InvalidTimezoneError for invalid timezone', () => {
      expect(() => CronEngine.getNextRun('0 0 * * *', { timezone: 'Fake/Zone' })).toThrow(
        InvalidTimezoneError,
      );
    });

    it('should throw InvalidCronExpressionError for malformed cron expression', () => {
      expect(() => CronEngine.getNextRun('invalid-cron')).toThrow(InvalidCronExpressionError);
    });
  });
});
