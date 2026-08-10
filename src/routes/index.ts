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
import { queueService } from '../queue/queue.service.js';
import { workerRegistry } from '../workers/worker.registry.js';
import { pgPool } from '../database/postgres.js';
import { redisClient } from '../redis/redis.js';
import { asyncHandler } from '../utils/asyncHandler.js';

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

// TELEMETRY ENDPOINTS FOR CONTROL PLANE UI
router.get(
  '/api/v1/queues',
  authMiddleware,
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const list = await queueService.listQueues();
    const names = list.length > 0 ? Array.from(new Set(['default', ...list])) : ['default'];
    const queues = await Promise.all(
      names.map(async (name) => {
        const m = await queueService.getMetrics(name);
        return {
          name,
          depth: (m.queued || 0) + (m.pending || 0),
          processing: m.processing || 0,
          scheduled: m.scheduled || 0,
          deadletter: m.deadletter || 0,
          activeWorkers: m.activeWorkers || 0,
          status: m.processing > 0 ? 'ACTIVE' : 'IDLE',
        };
      }),
    );
    res.json({ success: true, data: queues });
  }),
);

router.get(
  '/api/v1/workers',
  authMiddleware,
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const workers = await workerRegistry.listActiveWorkers();
    res.json({ success: true, data: workers });
  }),
);

router.get(
  '/api/v1/metrics/summary',
  authMiddleware,
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const m = await queueService.getMetrics();
    const activeWorkers = await workerRegistry.listActiveWorkers();

    const dbActive = Math.max(0, pgPool.totalCount - pgPool.idleCount);
    const dbIdle = pgPool.idleCount;
    const dbWaiting = pgPool.waitingCount;

    let redisMemory = '1.6M';
    let redisClients = 1;
    try {
      const info = await redisClient.info();
      const matchMem = info.match(/used_memory_human:(.+)/);
      const matchClients = info.match(/connected_clients:(.+)/);
      if (matchMem && matchMem[1]) redisMemory = matchMem[1].trim();
      if (matchClients && matchClients[1]) redisClients = parseInt(matchClients[1].trim(), 10) || 1;
    } catch (err: unknown) {
      // Graceful fallback if Redis info command fails
    }

    res.json({
      success: true,
      data: {
        queueDepth: (m.queued || 0) + (m.pending || 0),
        activeWorkers: activeWorkers.filter((w) => w.status !== 'OFFLINE').length,
        runningJobs: m.processing || 0,
        dlqCount: m.deadletter || 0,
        dbActive,
        dbIdle,
        dbWaiting,
        redisMemory,
        redisClients,
        uptimeSeconds: Math.floor(process.uptime()),
      },
    });
  }),
);

export const appRouter = router;
export default router;
