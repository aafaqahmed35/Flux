import { Router, Request, Response, NextFunction } from 'express';
import { ScheduleController } from '../controllers/schedule.controller.js';

export function createScheduleRouter(controller?: ScheduleController): Router {
  const router = Router();
  const scheduleController = controller || new ScheduleController();

  router.get('/', (req: Request, res: Response, next: NextFunction) => {
    void scheduleController.listSchedules(req, res, next);
  });
  router.post('/', (req: Request, res: Response, next: NextFunction) => {
    void scheduleController.createSchedule(req, res, next);
  });
  router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
    void scheduleController.getScheduleById(req, res, next);
  });
  router.get('/:id/history', (req: Request, res: Response, next: NextFunction) => {
    void scheduleController.getScheduleHistory(req, res, next);
  });
  router.patch('/:id', (req: Request, res: Response, next: NextFunction) => {
    void scheduleController.updateSchedule(req, res, next);
  });
  router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
    void scheduleController.deleteSchedule(req, res, next);
  });
  router.post('/:id/enable', (req: Request, res: Response, next: NextFunction) => {
    void scheduleController.enableSchedule(req, res, next);
  });
  router.post('/:id/disable', (req: Request, res: Response, next: NextFunction) => {
    void scheduleController.disableSchedule(req, res, next);
  });
  router.post('/:id/run', (req: Request, res: Response, next: NextFunction) => {
    void scheduleController.runScheduleNow(req, res, next);
  });

  return router;
}
