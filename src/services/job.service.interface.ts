import { JobPriority, JobStatus } from '../constants/job.constants.js';
import {
  CancelJobResponseDTO,
  CreateJobRequestDTO,
  CreateJobResponseDTO,
  DeleteJobResponseDTO,
  JobResponseDTO,
  ListJobsResponseDTO,
} from '../dtos/job.dto.js';

export interface ListJobsQueryOptions {
  page?: number;
  limit?: number;
  status?: JobStatus;
  priority?: JobPriority;
  queue?: string;
  workerId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  scheduledAfter?: Date;
  scheduledBefore?: Date;
  sortBy?: 'createdAt' | 'priority' | 'status' | 'scheduledFor';
  sortOrder?: 'asc' | 'desc' | 'ASC' | 'DESC';
}

export interface IJobService {
  createJob(dto: CreateJobRequestDTO, idempotencyHeader?: string): Promise<CreateJobResponseDTO>;
  getJobById(id: string): Promise<JobResponseDTO>;
  listJobs(options: ListJobsQueryOptions): Promise<ListJobsResponseDTO>;
  cancelJob(id: string, reason?: string): Promise<CancelJobResponseDTO>;
  deleteJob(id: string): Promise<DeleteJobResponseDTO>;
}
