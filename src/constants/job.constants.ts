export enum JobStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
  CANCELLED = 'CANCELLED',
  DELAYED = 'DELAYED',
}

export enum JobPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export const JOB_STATUS_LIST = Object.values(JobStatus);
export const JOB_PRIORITY_LIST = Object.values(JobPriority);

export const ALLOWED_STATUS_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  [JobStatus.PENDING]: [JobStatus.QUEUED, JobStatus.DELAYED, JobStatus.CANCELLED],
  [JobStatus.QUEUED]: [JobStatus.RUNNING, JobStatus.CANCELLED],
  [JobStatus.DELAYED]: [JobStatus.QUEUED, JobStatus.CANCELLED],
  [JobStatus.RUNNING]: [
    JobStatus.COMPLETED,
    JobStatus.FAILED,
    JobStatus.RETRYING,
    JobStatus.CANCELLED,
  ],
  [JobStatus.RETRYING]: [JobStatus.QUEUED, JobStatus.FAILED, JobStatus.CANCELLED],
  [JobStatus.FAILED]: [JobStatus.QUEUED, JobStatus.RETRYING],
  [JobStatus.CANCELLED]: [JobStatus.PENDING, JobStatus.QUEUED],
  [JobStatus.COMPLETED]: [],
};

export const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000,
} as const;

export const DEFAULT_PAGINATION = {
  limit: 20,
  offset: 0,
  maxLimit: 100,
} as const;

export const MAX_PAYLOAD_SIZE_BYTES = 1024 * 1024; // 1 MB

export const QUEUE_NAME_REGEX = /^[a-z0-9._-]+$/i;
