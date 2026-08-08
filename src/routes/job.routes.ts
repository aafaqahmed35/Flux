import { Router } from 'express';
import { jobController } from '../controllers/job.controller.js';
import { createJobSchema } from '../domain/job.validator.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireScope } from '../auth/authorize.middleware.js';
import { createRateLimitMiddleware } from '../security/rate-limit/rate-limit.middleware.js';
import {
  cancelJobBodySchema,
  jobIdParamSchema,
  listJobsQuerySchema,
} from '../validators/job.api.validator.js';

const router = Router();

const jobCreateRateLimit = createRateLimitMiddleware('job-create', 120, 60);
const manualRetryRateLimit = createRateLimitMiddleware('manual-retry', 30, 60);

router.post(
  '/',
  authMiddleware,
  requireScope('jobs:write'),
  jobCreateRateLimit,
  validateRequest({
    body: createJobSchema,
  }),
  jobController.createJob,
);

router.get(
  '/',
  authMiddleware,
  requireScope('jobs:read'),
  validateRequest({
    query: listJobsQuerySchema,
  }),
  jobController.listJobs,
);

router.get(
  '/:id',
  authMiddleware,
  requireScope('jobs:read'),
  validateRequest({
    params: jobIdParamSchema,
  }),
  jobController.getJobById,
);

router.get(
  '/:id/retries',
  authMiddleware,
  requireScope('retries:read'),
  validateRequest({
    params: jobIdParamSchema,
  }),
  jobController.getJobRetries,
);

router.post(
  '/:id/retry',
  authMiddleware,
  requireScope('retries:write'),
  manualRetryRateLimit,
  validateRequest({
    params: jobIdParamSchema,
  }),
  jobController.manualRetryJob,
);

router.patch(
  '/:id/cancel',
  authMiddleware,
  requireScope('jobs:cancel'),
  validateRequest({
    params: jobIdParamSchema,
    body: cancelJobBodySchema,
  }),
  jobController.cancelJob,
);

router.delete(
  '/:id',
  authMiddleware,
  requireScope('jobs:delete'),
  validateRequest({
    params: jobIdParamSchema,
  }),
  jobController.deleteJob,
);

export const jobRouter = router;
