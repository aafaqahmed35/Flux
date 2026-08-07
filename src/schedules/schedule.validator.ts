import { z } from 'zod';
import { CronEngine } from './cron.engine';
import { CreateScheduleInput, UpdateScheduleInput } from './schedule.types';

export const createScheduleSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(255),
    queueName: z.string().min(1, 'Queue name is required').max(255),
    cronExpression: z.string().min(1, 'Cron expression is required'),
    timezone: z
      .string()
      .optional()
      .default('UTC')
      .refine((tz) => CronEngine.isValidTimezone(tz), {
        message: 'Invalid IANA timezone identifier',
      }),
    payload: z.record(z.unknown()).optional().default({}),
    metadata: z.record(z.unknown()).optional().default({}),
    enabled: z.boolean().optional().default(true),
  })
  .refine((data) => CronEngine.isValid(data.cronExpression, data.timezone), {
    message: 'Invalid cron expression for specified timezone',
    path: ['cronExpression'],
  });

export const updateScheduleSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    queueName: z.string().min(1).max(255).optional(),
    cronExpression: z.string().min(1).optional(),
    timezone: z
      .string()
      .optional()
      .refine((tz) => !tz || CronEngine.isValidTimezone(tz), {
        message: 'Invalid IANA timezone identifier',
      }),
    payload: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.cronExpression) {
        const tz = data.timezone || 'UTC';
        return CronEngine.isValid(data.cronExpression, tz);
      }
      return true;
    },
    {
      message: 'Invalid cron expression',
      path: ['cronExpression'],
    },
  );

export function validateCreateSchedule(input: unknown): CreateScheduleInput {
  return createScheduleSchema.parse(input) as CreateScheduleInput;
}

export function validateUpdateSchedule(input: unknown): UpdateScheduleInput {
  return updateScheduleSchema.parse(input) as UpdateScheduleInput;
}
