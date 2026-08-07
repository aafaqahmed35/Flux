export type WorkerStatus = 'STARTING' | 'IDLE' | 'BUSY' | 'STOPPING' | 'OFFLINE' | 'STOPPED';

export interface WorkerInfo {
  workerId: string;
  hostname: string;
  pid: number;
  os: string;
  softwareVersion: string;
  startedAt: string;
  lastSeen: string;
  status: WorkerStatus;
  currentJobId: string | null;
  currentConcurrency: number;
  maxConcurrency: number;
  supportedQueues: string[];
}

export interface WorkerOptions {
  workerId?: string;
  queues?: string[];
  concurrency?: number;
  heartbeatIntervalMs?: number;
  pollIntervalMs?: number;
}
