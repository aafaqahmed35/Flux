export interface QueueMetrics {
  pending: number;
  queued: number;
  processing: number;
  scheduled: number;
  deadletter: number;
  activeWorkers: number;
}

export interface QueueInfo {
  name: string;
  length: number;
}

export interface EnqueueResult {
  jobId: string;
  queueName: string;
  enqueuedAt: Date;
}
