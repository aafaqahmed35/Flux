import { Router, Request, Response, NextFunction } from 'express';
import { ScheduleController } from '../controllers/schedule.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireScope } from '../auth/authorize.middleware.js';
import { createRateLimitMiddleware } from '../security/rate-limit/rate-limit.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export function createScheduleRouter(controller?: ScheduleController): Router {
  const router = Router();
  const scheduleController = controller || new ScheduleController();
  const scheduleCreateRateLimit = createRateLimitMiddleware('schedule-create', 30, 60);

  router.get(
    '/',
    authMiddleware,
    requireScope('schedules:read'),
    asyncHandler((req: Request, res: Response, next: NextFunction) =>
      scheduleController.listSchedules(req, res, next),
    ),
  );
  router.post(
    '/',
    authMiddleware,
    requireScope('schedules:write'),
    scheduleCreateRateLimit,
    asyncHandler((req: Request, res: Response, next: NextFunction) =>
      scheduleController.createSchedule(req, res, next),
    ),
  );
  router.get(
    '/:id',
    authMiddleware,
    requireScope('schedules:read'),
    asyncHandler((req: Request, res: Response, next: NextFunction) =>
      scheduleController.getScheduleById(req, res, next),
    ),
  );
  router.get(
    '/:id/history',
    authMiddleware,
    requireScope('schedules:read'),
    asyncHandler((req: Request, res: Response, next: NextFunction) =>
      scheduleController.getScheduleHistory(req, res, next),
    ),
  );
  router.patch(
    '/:id',
    authMiddleware,
    requireScope('schedules:write'),
    asyncHandler((req: Request, res: Response, next: NextFunction) =>
      scheduleController.updateSchedule(req, res, next),
    ),
  );
  router.delete(
    '/:id',
    authMiddleware,
    requireScope('schedules:write'),
    asyncHandler((req: Request, res: Response, next: NextFunction) =>
      scheduleController.deleteSchedule(req, res, next),
    ),
  );
  router.post(
    '/:id/enable',
    authMiddleware,
    requireScope('schedules:write'),
    asyncHandler((req: Request, res: Response, next: NextFunction) =>
      scheduleController.enableSchedule(req, res, next),
    ),
  );
  router.post(
    '/:id/disable',
    authMiddleware,
    requireScope('schedules:write'),
    asyncHandler((req: Request, res: Response, next: NextFunction) =>
      scheduleController.disableSchedule(req, res, next),
    ),
  );
  router.post(
    '/:id/run',
    authMiddleware,
    requireScope('schedules:write'),
    asyncHandler((req: Request, res: Response, next: NextFunction) =>
      scheduleController.runScheduleNow(req, res, next),
    ),
  );

  return router;
}
