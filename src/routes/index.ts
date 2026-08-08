import { Router, Request, Response, NextFunction } from 'express';
import deadLetterRouter from './deadletter.routes.js';
import { healthRoutes } from './health.routes.js';
import { jobRouter } from './job.routes.js';
import retryRouter from './retry.routes.js';
import { createScheduleRouter } from './schedule.routes.js';
import { metricsController } from '../controllers/metrics.controller.js';

const router = Router();

router.get('/metrics', (req: Request, res: Response, next: NextFunction) => {
  void metricsController.getMetrics(req, res, next);
});
router.use('/health', healthRoutes);
router.use('/api/v1/jobs', jobRouter);
router.use('/api/v1/deadletter', deadLetterRouter);
router.use('/api/v1/retries', retryRouter);
router.use('/api/v1/schedules', createScheduleRouter());

export const appRouter = router;
export default router;
