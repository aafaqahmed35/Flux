import { validateCreateSchedule, validateUpdateSchedule } from '../../src/schedules/schedule.validator';

describe('Schedule Validator Unit Tests', () => {
  describe('validateCreateSchedule', () => {
    it('should validate valid create schedule payload', () => {
      const payload = {
        name: 'daily-report',
        queueName: 'reports',
        cronExpression: '0 0 * * *',
        timezone: 'UTC',
        payload: { reportType: 'daily' },
      };

      const validated = validateCreateSchedule(payload);
      expect(validated.name).toBe('daily-report');
      expect(validated.queueName).toBe('reports');
      expect(validated.cronExpression).toBe('0 0 * * *');
      expect(validated.enabled).toBe(true);
    });

    it('should throw error when name is missing', () => {
      expect(() =>
        validateCreateSchedule({
          queueName: 'reports',
          cronExpression: '0 0 * * *',
        }),
      ).toThrow();
    });

    it('should throw error when cron expression is invalid', () => {
      expect(() =>
        validateCreateSchedule({
          name: 'test',
          queueName: 'reports',
          cronExpression: '99 99 * * *',
        }),
      ).toThrow();
    });

    it('should throw error when timezone is invalid', () => {
      expect(() =>
        validateCreateSchedule({
          name: 'test',
          queueName: 'reports',
          cronExpression: '0 0 * * *',
          timezone: 'Invalid/Zone',
        }),
      ).toThrow();
    });
  });

  describe('validateUpdateSchedule', () => {
    it('should validate valid partial update schedule payload', () => {
      const validated = validateUpdateSchedule({
        name: 'updated-name',
        enabled: false,
      });

      expect(validated.name).toBe('updated-name');
      expect(validated.enabled).toBe(false);
    });

    it('should reject update with invalid cron expression', () => {
      expect(() =>
        validateUpdateSchedule({
          cronExpression: 'invalid-cron',
        }),
      ).toThrow();
    });
  });
});
