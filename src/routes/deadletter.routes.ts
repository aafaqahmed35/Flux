import { Router } from 'express';
import { deadLetterController } from '../controllers/deadletter.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireScope } from '../auth/authorize.middleware.js';

const router = Router();

router.get(
  '/',
  authMiddleware,
  requireScope('deadletter:read'),
  asyncHandler(deadLetterController.listDeadLetterJobs.bind(deadLetterController)),
);

router.post(
  '/:id/requeue',
  authMiddleware,
  requireScope('deadletter:write'),
  asyncHandler(deadLetterController.requeueDeadLetterJob.bind(deadLetterController)),
);

router.delete(
  '/:id',
  authMiddleware,
  requireScope('deadletter:write'),
  asyncHandler(deadLetterController.deleteDeadLetterJob.bind(deadLetterController)),
);

export default router;
