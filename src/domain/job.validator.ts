import { z } from 'zod';
import {
  DEFAULT_RETRY_CONFIG,
  JobPriority,
  MAX_PAYLOAD_SIZE_BYTES,
  QUEUE_NAME_REGEX,
} from '../constants/job.constants.js';
import { CreateJobRequest } from '../types/job.types.js';

export const createJobSchema = z.object({
  name: z
    .string({ required_error: 'Job name is required' })
    .trim()
    .min(1, 'Job name cannot be empty')
    .max(255, 'Job name cannot exceed 255 characters'),
  queueName: z
    .string({ required_error: 'Queue name is required' })
    .trim()
    .min(1, 'Queue name cannot be empty')
    .max(255, 'Queue name cannot exceed 255 characters')
    .regex(
      QUEUE_NAME_REGEX,
      'Queue name must contain only alphanumeric characters, dots, hyphens, or underscores (e.g. "emails", "reports.daily")',
    ),
  idempotencyKey: z.string().trim().min(1).max(255).nullable().optional().default(null),
  payload: z
    .record(z.unknown())
    .optional()
    .default({})
    .refine(
      (val) => {
        try {
          const jsonString = JSON.stringify(val);
          return Buffer.byteLength(jsonString, 'utf8') <= MAX_PAYLOAD_SIZE_BYTES;
        } catch {
          return false;
        }
      },
      `Job payload size exceeds maximum allowed limit of ${MAX_PAYLOAD_SIZE_BYTES / (1024 * 1024)} MB`,
    ),
  metadata: z.record(z.unknown()).optional().default({}),
  priority: z.nativeEnum(JobPriority).optional().default(JobPriority.NORMAL),
  maxRetries: z
    .number()
    .int('maxRetries must be an integer')
    .min(0, 'maxRetries cannot be negative')
    .optional()
    .default(DEFAULT_RETRY_CONFIG.maxRetries),
  retryDelay: z
    .number()
    .int('retryDelay must be an integer')
    .min(0, 'retryDelay cannot be negative')
    .optional()
    .default(DEFAULT_RETRY_CONFIG.retryDelay),
  scheduledFor: z
    .union([z.date(), z.string().datetime(), z.string().pipe(z.coerce.date())])
    .nullable()
    .optional()
    .transform((val) => (val ? new Date(val) : null)),
  delayUntil: z
    .union([z.date(), z.string().datetime(), z.string().pipe(z.coerce.date())])
    .nullable()
    .optional()
    .transform((val) => (val ? new Date(val) : null)),
});

export const validateCreateJobRequest = (input: unknown): CreateJobRequest => {
  return createJobSchema.parse(input) as CreateJobRequest;
};
