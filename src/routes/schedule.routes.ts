import { Router } from 'express';
import { ScheduleController } from '../controllers/schedule.controller';

export function createScheduleRouter(controller?: ScheduleController): Router {
  const router = Router();
  const scheduleController = controller || new ScheduleController();

  router.get('/', scheduleController.listSchedules);
  router.post('/', scheduleController.createSchedule);
  router.get('/:id', scheduleController.getScheduleById);
  router.get('/:id/history', scheduleController.getScheduleHistory);
  router.patch('/:id', scheduleController.updateSchedule);
  router.delete('/:id', scheduleController.deleteSchedule);
  router.post('/:id/enable', scheduleController.enableSchedule);
  router.post('/:id/disable', scheduleController.disableSchedule);
  router.post('/:id/run', scheduleController.runScheduleNow);

  return router;
}
