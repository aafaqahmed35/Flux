import { Router, Request, Response, NextFunction } from 'express';
import { authRouter } from './auth.routes.js';
import deadLetterRouter from './deadletter.routes.js';
import { healthRoutes } from './health.routes.js';
import { jobRouter } from './job.routes.js';
import retryRouter from './retry.routes.js';
import { createScheduleRouter } from './schedule.routes.js';
import { recoveryRouter } from './recovery.routes.js';
import { metricsController } from '../controllers/metrics.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireScope } from '../auth/authorize.middleware.js';
import { AuthenticatedRequest } from '../auth/auth.types.js';

const router = Router();

// /metrics requires metrics:read if auth headers are supplied, otherwise open for scraper
router.get('/metrics', (req: Request, res: Response, next: NextFunction) => {
  const hasAuth = req.headers['authorization'] || req.headers['x-api-key'];
  if (hasAuth) {
    authMiddleware(req as AuthenticatedRequest, res, (err) => {
      if (err) return next(err);
      requireScope('metrics:read')(req as AuthenticatedRequest, res, () => {
        void metricsController.getMetrics(req, res, next);
      });
    });
  } else {
    void metricsController.getMetrics(req, res, next);
  }
});

router.use('/health', healthRoutes);
router.use('/api/v1/auth', authRouter);
router.use('/api/v1/jobs', jobRouter);
router.use('/api/v1/deadletter', deadLetterRouter);
router.use('/api/v1/retries', retryRouter);
router.use('/api/v1/schedules', createScheduleRouter());
router.use('/api/v1/recovery', recoveryRouter);

export const appRouter = router;
export default router;
