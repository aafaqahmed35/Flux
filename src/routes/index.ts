import { Router } from 'express';
import deadLetterRouter from './deadletter.routes.js';
import { healthRoutes } from './health.routes.js';
import { jobRouter } from './job.routes.js';
import retryRouter from './retry.routes.js';
import { createScheduleRouter } from './schedule.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/api/v1/jobs', jobRouter);
router.use('/api/v1/deadletter', deadLetterRouter);
router.use('/api/v1/retries', retryRouter);
router.use('/api/v1/schedules', createScheduleRouter());

export const appRouter = router;
export default router;
