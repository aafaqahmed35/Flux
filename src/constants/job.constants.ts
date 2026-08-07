export enum JobStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  CLAIMED = 'CLAIMED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
  CANCELLED = 'CANCELLED',
  DELAYED = 'DELAYED',
  DEAD_LETTER = 'DEAD_LETTER',
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
  [JobStatus.PENDING]: [
    JobStatus.QUEUED,
    JobStatus.CLAIMED,
    JobStatus.DELAYED,
    JobStatus.CANCELLED,
  ],
  [JobStatus.QUEUED]: [
    JobStatus.CLAIMED,
    JobStatus.RUNNING,
    JobStatus.CANCELLED,
    JobStatus.DEAD_LETTER,
  ],
  [JobStatus.CLAIMED]: [
    JobStatus.RUNNING,
    JobStatus.FAILED,
    JobStatus.CANCELLED,
    JobStatus.DEAD_LETTER,
  ],
  [JobStatus.DELAYED]: [JobStatus.QUEUED, JobStatus.CANCELLED],
  [JobStatus.RUNNING]: [
    JobStatus.COMPLETED,
    JobStatus.FAILED,
    JobStatus.RETRYING,
    JobStatus.CANCELLED,
    JobStatus.DEAD_LETTER,
  ],
  [JobStatus.RETRYING]: [
    JobStatus.QUEUED,
    JobStatus.CLAIMED,
    JobStatus.RUNNING,
    JobStatus.FAILED,
    JobStatus.CANCELLED,
    JobStatus.DEAD_LETTER,
  ],
  [JobStatus.FAILED]: [JobStatus.QUEUED, JobStatus.RETRYING, JobStatus.DEAD_LETTER],
  [JobStatus.CANCELLED]: [JobStatus.PENDING, JobStatus.QUEUED],
  [JobStatus.DEAD_LETTER]: [JobStatus.QUEUED, JobStatus.RETRYING, JobStatus.PENDING],
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
