import { Router } from 'express';
import { retryController } from '../controllers/retry.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireScope } from '../auth/authorize.middleware.js';

const router = Router();

router.get(
  '/',
  authMiddleware,
  requireScope('retries:read'),
  asyncHandler(retryController.getRetryMetrics.bind(retryController)),
);

export default router;
