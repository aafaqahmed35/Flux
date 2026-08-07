import { Router } from 'express';
import { jobController } from '../controllers/job.controller.js';
import { createJobSchema } from '../domain/job.validator.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import {
  cancelJobBodySchema,
  jobIdParamSchema,
  listJobsQuerySchema,
} from '../validators/job.api.validator.js';

const router = Router();

router.post(
  '/',
  validateRequest({
    body: createJobSchema,
  }),
  jobController.createJob,
);

router.get(
  '/',
  validateRequest({
    query: listJobsQuerySchema,
  }),
  jobController.listJobs,
);

router.get(
  '/:id',
  validateRequest({
    params: jobIdParamSchema,
  }),
  jobController.getJobById,
);

router.patch(
  '/:id/cancel',
  validateRequest({
    params: jobIdParamSchema,
    body: cancelJobBodySchema,
  }),
  jobController.cancelJob,
);

router.delete(
  '/:id',
  validateRequest({
    params: jobIdParamSchema,
  }),
  jobController.deleteJob,
);

export const jobRouter = router;
