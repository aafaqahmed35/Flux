import { Router } from 'express';
import { deadLetterController } from '../controllers/deadletter.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(deadLetterController.listDeadLetterJobs.bind(deadLetterController)));

router.post(
  '/:id/requeue',
  asyncHandler(deadLetterController.requeueDeadLetterJob.bind(deadLetterController)),
);

router.delete(
  '/:id',
  asyncHandler(deadLetterController.deleteDeadLetterJob.bind(deadLetterController)),
);

export default router;
