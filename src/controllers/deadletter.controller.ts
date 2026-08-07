import { Request, Response } from 'express';
import { HTTP_STATUS } from '../constants/statusCodes.js';
import { mapJobToDTO } from '../dtos/job.dto.js';
import { deadLetterService } from '../services/deadletter.service.js';
import { sendSuccess } from '../utils/response.js';

export class DeadLetterController {
  async listDeadLetterJobs(req: Request, res: Response): Promise<void> {
    const page = req.query['page'] ? parseInt(req.query['page'] as string, 10) : 1;
    const limit = req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : 20;

    const result = await deadLetterService.listDeadLetterJobs({
      limit,
      offset: (page - 1) * limit,
    });

    const totalPages = Math.ceil(result.total / limit) || 1;
    const data = {
      items: result.jobs.map(mapJobToDTO),
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      },
    };

    sendSuccess(res, data, HTTP_STATUS.OK);
  }

  async requeueDeadLetterJob(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const requeuedJob = await deadLetterService.requeueDeadLetterJob(id);
    sendSuccess(res, mapJobToDTO(requeuedJob), HTTP_STATUS.OK);
  }

  async deleteDeadLetterJob(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    await deadLetterService.deleteDeadLetterJob(id);
    sendSuccess(res, { id, deleted: true as const }, HTTP_STATUS.OK);
  }
}

export const deadLetterController = new DeadLetterController();
