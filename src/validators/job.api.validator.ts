import { z } from 'zod';
import { JobPriority, JobStatus, QUEUE_NAME_REGEX } from '../constants/job.constants.js';

export const jobIdParamSchema = z.object({
  id: z.string().uuid('Job ID must be a valid UUID'),
});

export const listJobsQuerySchema = z.object({
  page: z.coerce
    .number()
    .int('Page must be an integer')
    .min(1, 'Page must be at least 1')
    .optional()
    .default(1),
  limit: z.coerce
    .number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .optional()
    .default(20),
  status: z.nativeEnum(JobStatus).optional(),
  priority: z.nativeEnum(JobPriority).optional(),
  queue: z
    .string()
    .trim()
    .regex(
      QUEUE_NAME_REGEX,
      'Queue filter must contain only alphanumeric characters, dots, hyphens, or underscores',
    )
    .optional(),
  workerId: z.string().trim().optional(),
  createdAfter: z.coerce.date().optional(),
  createdBefore: z.coerce.date().optional(),
  scheduledAfter: z.coerce.date().optional(),
  scheduledBefore: z.coerce.date().optional(),
  sortBy: z
    .enum(['createdAt', 'priority', 'status', 'scheduledFor'])
    .optional()
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc', 'ASC', 'DESC']).optional().default('desc'),
});

export const cancelJobBodySchema = z.object({
  reason: z.string().trim().max(255, 'Cancellation reason cannot exceed 255 characters').optional(),
});
