import { ZodError } from 'zod';
import { JobPriority, MAX_PAYLOAD_SIZE_BYTES } from '../../src/constants/job.constants.js';
import { createJobSchema, validateCreateJobRequest } from '../../src/domain/job.validator.js';

describe('Job Validator (Zod Schema)', () => {
  it('should validate and parse a valid job creation request with defaults', () => {
    const validInput = {
      name: 'send-welcome-email',
      queueName: 'emails',
      payload: { userId: '12345', email: 'user@example.com' },
    };

    const validated = validateCreateJobRequest(validInput);

    expect(validated.name).toBe('send-welcome-email');
    expect(validated.queueName).toBe('emails');
    expect(validated.payload).toEqual({ userId: '12345', email: 'user@example.com' });
    expect(validated.priority).toBe(JobPriority.NORMAL);
    expect(validated.maxRetries).toBe(3);
    expect(validated.retryDelay).toBe(1000);
    expect(validated.metadata).toEqual({});
    expect(validated.idempotencyKey).toBeNull();
  });

  it('should trim job name and queue name', () => {
    const input = {
      name: '  process-payment  ',
      queueName: '  payments.stripe  ',
    };

    const validated = validateCreateJobRequest(input);
    expect(validated.name).toBe('process-payment');
    expect(validated.queueName).toBe('payments.stripe');
  });

  it('should reject invalid queue names with special characters or spaces', () => {
    const invalidQueueNames = [
      'emails queue',
      'payments/v1',
      'queue@name',
      'invalid!queue',
      'queue$name',
    ];

    invalidQueueNames.forEach((queueName) => {
      expect(() =>
        validateCreateJobRequest({
          name: 'test-job',
          queueName,
        }),
      ).toThrow(ZodError);
    });
  });

  it('should accept valid queue names matching pattern', () => {
    const validQueueNames = [
      'emails',
      'reports.daily',
      'payments_v2',
      'user-notifications',
      'analytics.2026',
    ];

    validQueueNames.forEach((queueName) => {
      const validated = validateCreateJobRequest({
        name: 'test-job',
        queueName,
      });
      expect(validated.queueName).toBe(queueName);
    });
  });

  it('should reject empty job name or empty queue name', () => {
    expect(() => validateCreateJobRequest({ name: '', queueName: 'default' })).toThrow(ZodError);
    expect(() => validateCreateJobRequest({ name: 'job', queueName: '' })).toThrow(ZodError);
  });

  it('should reject payloads exceeding 1 MB limit', () => {
    // Generate a payload string > 1 MB
    const largeString = 'a'.repeat(MAX_PAYLOAD_SIZE_BYTES + 10);
    const hugePayload = { data: largeString };

    expect(() =>
      validateCreateJobRequest({
        name: 'heavy-job',
        queueName: 'heavy',
        payload: hugePayload,
      }),
    ).toThrow(ZodError);
  });

  it('should accept customized priority, retries, and delay parameters', () => {
    const scheduledDate = new Date(Date.now() + 60000);

    const input = {
      name: 'urgent-report',
      queueName: 'reports',
      priority: JobPriority.CRITICAL,
      maxRetries: 5,
      retryDelay: 5000,
      scheduledFor: scheduledDate,
      idempotencyKey: 'idemp-12345',
    };

    const validated = validateCreateJobRequest(input);

    expect(validated.priority).toBe(JobPriority.CRITICAL);
    expect(validated.maxRetries).toBe(5);
    expect(validated.retryDelay).toBe(5000);
    expect(validated.scheduledFor).toEqual(scheduledDate);
    expect(validated.idempotencyKey).toBe('idemp-12345');
  });

  it('should reject negative maxRetries or retryDelay', () => {
    expect(() =>
      createJobSchema.parse({
        name: 'job',
        queueName: 'queue',
        maxRetries: -1,
      }),
    ).toThrow(ZodError);

    expect(() =>
      createJobSchema.parse({
        name: 'job',
        queueName: 'queue',
        retryDelay: -500,
      }),
    ).toThrow(ZodError);
  });
});
