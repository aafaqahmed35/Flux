import { JobStatus } from '../constants/job.constants.js';
import { Job } from '../types/job.types.js';

export type RecoveryReason =
  | 'WORKER_CRASH'
  | 'STALE_LEASE'
  | 'REDIS_MISSING'
  | 'REDIS_ORPHAN'
  | 'SCHEDULER_MISSED'
  | 'PROCESS_RESTART'
  | 'UNKNOWN';

export interface RecoveryJob extends Job {
  recoveryReason?: RecoveryReason;
  lastLeaseAt?: Date | null;
}

export interface StaleJobInfo {
  jobId: string;
  queueName: string;
  status: JobStatus;
  workerId: string | null;
  lockedAt: Date | null;
  staleForMs: number;
}

export interface RecoveryResult {
  scannedCount: number;
  recoveredCount: number;
  failedCount: number;
  skippedCount: number;
  recoveredJobIds: string[];
  failedJobIds: string[];
  errors: Array<{ jobId: string; error: string }>;
}

export interface ReconciliationResult {
  scannedCount: number;
  reenqueuedCount: number;
  staleRedisRemovedCount: number;
  orphansRemovedCount: number;
  reconciledJobIds: string[];
  errors: Array<{ key: string; error: string }>;
}

export interface RecoveryMetrics {
  totalScans: number;
  totalRecovered: number;
  totalFailed: number;
  totalStaleJobs: number;
  totalReconciled: number;
  totalOrphansRemoved: number;
  totalConflicts: number;
  lastScanTimeMs: number | null;
  lastReconciliationTimeMs: number | null;
}

export interface RecoveryOptions {
  leaseTimeoutMs?: number;
  recoveryIntervalMs?: number;
  batchSize?: number;
  reconciliationIntervalMs?: number;
  maxRecoveryAttempts?: number;
}
