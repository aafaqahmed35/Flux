import { Router } from 'express';
import { retryController } from '../controllers/retry.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(retryController.getRetryMetrics.bind(retryController)));

export default router;
