import { Request, Response } from 'express';
import { HTTP_STATUS } from '../constants/statusCodes.js';
import { CreateJobRequestDTO } from '../dtos/job.dto.js';
import { IJobService } from '../services/job.service.interface.js';
import { jobService } from '../services/job.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export class JobController {
  private readonly service: IJobService;

  constructor(service: IJobService = jobService) {
    this.service = service;
  }

  createJob = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const idempotencyHeader =
      (req.headers['idempotency-key'] as string) ||
      (req.headers['x-idempotency-key'] as string) ||
      undefined;

    const dto = req.body as CreateJobRequestDTO;
    const result = await this.service.createJob(dto, idempotencyHeader);

    if (result.isDuplicate) {
      sendSuccess(res, result.job, HTTP_STATUS.OK);
    } else {
      const location = `/api/v1/jobs/${result.job.id}`;
      sendSuccess(res, result.job, HTTP_STATUS.CREATED, { Location: location });
    }
  });

  getJobById = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const job = await this.service.getJobById(id);
    sendSuccess(res, job, HTTP_STATUS.OK);
  });

  listJobs = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.listJobs(req.query);
    sendSuccess(res, result, HTTP_STATUS.OK);
  });

  cancelJob = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const body = req.body as { reason?: string } | undefined;
    const reason = body?.reason;
    const result = await this.service.cancelJob(id, reason);
    sendSuccess(res, result, HTTP_STATUS.OK);
  });

  deleteJob = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const result = await this.service.deleteJob(id);
    sendSuccess(res, result, HTTP_STATUS.OK);
  });
}

export const jobController = new JobController();
