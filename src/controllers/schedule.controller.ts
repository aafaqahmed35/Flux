import { Request, Response, NextFunction } from 'express';
import { ScheduleService } from '../schedules/schedule.service';
import { logger } from '../utils/logger';

export class ScheduleController {
  private service: ScheduleService;

  constructor(service?: ScheduleService) {
    this.service = service || new ScheduleService();
  }

  public listSchedules = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const queueName = req.query.queueName as string | undefined;
      const enabled = req.query.enabled !== undefined ? req.query.enabled === 'true' : undefined;
      const search = req.query.search as string | undefined;

      const result = await this.service.listSchedules({
        page,
        limit,
        queueName,
        enabled,
        search,
      });

      res.status(200).json({
        success: true,
        data: result.schedules,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public createSchedule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const schedule = await this.service.createSchedule(req.body);
      res.setHeader('Location', `/api/v1/schedules/${schedule.id}`);
      res.status(201).json({
        success: true,
        data: schedule,
      });
    } catch (err) {
      next(err);
    }
  };

  public getScheduleById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const schedule = await this.service.getScheduleById(id);
      res.status(200).json({
        success: true,
        data: schedule,
      });
    } catch (err) {
      next(err);
    }
  };

  public updateSchedule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const schedule = await this.service.updateSchedule(id, req.body);
      res.status(200).json({
        success: true,
        data: schedule,
      });
    } catch (err) {
      next(err);
    }
  };

  public deleteSchedule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      await this.service.deleteSchedule(id);
      res.status(200).json({
        success: true,
        message: 'Schedule deleted successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public enableSchedule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const schedule = await this.service.enableSchedule(id);
      res.status(200).json({
        success: true,
        data: schedule,
      });
    } catch (err) {
      next(err);
    }
  };

  public disableSchedule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const schedule = await this.service.disableSchedule(id);
      res.status(200).json({
        success: true,
        data: schedule,
      });
    } catch (err) {
      next(err);
    }
  };

  public runScheduleNow = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await this.service.triggerScheduleNow(id);
      res.status(200).json({
        success: true,
        message: 'Schedule triggered manually',
        data: {
          schedule: result.schedule,
          jobId: result.jobId,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public getScheduleHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const history = await this.service.getExecutionHistory(id, limit);
      res.status(200).json({
        success: true,
        data: history,
      });
    } catch (err) {
      next(err);
    }
  };
}
