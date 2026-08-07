import { Request, Response } from 'express';
import { HTTP_STATUS } from '../constants/statusCodes.js';
import { jobService } from '../services/job.service.js';
import { sendSuccess } from '../utils/response.js';

export class RetryController {
  async getRetryMetrics(_req: Request, res: Response): Promise<void> {
    const metrics = await jobService.getRetryMetrics();
    sendSuccess(res, metrics, HTTP_STATUS.OK);
  }

  async getJobRetries(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const history = await jobService.getJobRetries(id);
    sendSuccess(res, history, HTTP_STATUS.OK);
  }

  async manualRetryJob(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const job = await jobService.manualRetryJob(id);
    sendSuccess(res, job, HTTP_STATUS.OK);
  }
}

export const retryController = new RetryController();
