export const METRIC_NAMES = {
  // Job Metrics
  JOBS_CREATED_TOTAL: 'flux_jobs_created_total',
  JOBS_COMPLETED_TOTAL: 'flux_jobs_completed_total',
  JOBS_FAILED_TOTAL: 'flux_jobs_failed_total',
  JOBS_RETRIED_TOTAL: 'flux_jobs_retried_total',
  JOBS_DEAD_LETTERED_TOTAL: 'flux_jobs_dead_lettered_total',
  JOBS_CANCELLED_TOTAL: 'flux_jobs_cancelled_total',
  JOBS_DELETED_TOTAL: 'flux_jobs_deleted_total',
  JOB_IDEMPOTENCY_HITS_TOTAL: 'flux_job_idempotency_hits_total',
  JOB_EXECUTION_DURATION_MS: 'flux_job_execution_duration_ms',
  JOB_QUEUE_WAIT_DURATION_MS: 'flux_job_queue_wait_duration_ms',
  JOB_RETRY_DELAY_MS: 'flux_job_retry_delay_ms',

  // Queue Metrics
  QUEUE_DEPTH: 'flux_queue_depth',
  QUEUE_PROCESSING: 'flux_queue_processing',
  QUEUE_SCHEDULED: 'flux_queue_scheduled',
  QUEUE_DEADLETTER: 'flux_queue_deadletter',
  QUEUE_ENQUEUED_TOTAL: 'flux_queue_enqueued_total',
  QUEUE_CLAIMED_TOTAL: 'flux_queue_claimed_total',
  QUEUE_ACKNOWLEDGED_TOTAL: 'flux_queue_acknowledged_total',

  // Worker Metrics
  WORKER_ACTIVE: 'flux_worker_active',
  WORKER_BUSY: 'flux_worker_busy',
  WORKER_CONCURRENCY: 'flux_worker_concurrency',
  WORKER_JOB_DURATION_MS: 'flux_worker_job_duration_ms',

  // Scheduler Metrics
  SCHEDULER_LAG_MS: 'flux_scheduler_lag_ms',
  SCHEDULER_TICKS_TOTAL: 'flux_scheduler_ticks_total',
  SCHEDULER_FAILURES_TOTAL: 'flux_scheduler_failures_total',

  // API Metrics
  API_REQUESTS_TOTAL: 'flux_api_requests_total',
  API_REQUEST_DURATION_MS: 'flux_api_request_duration_ms',

  // Infrastructure Metrics
  DB_QUERY_DURATION_MS: 'flux_db_query_duration_ms',
  DB_POOL_ACTIVE: 'flux_db_pool_active',
  DB_POOL_IDLE: 'flux_db_pool_idle',
  DB_POOL_WAITING: 'flux_db_pool_waiting',
  REDIS_OPERATION_DURATION_MS: 'flux_redis_operation_duration_ms',

  // Recovery Metrics
  RECOVERY_SCANS_TOTAL: 'flux_recovery_scans_total',
  JOBS_RECOVERED_TOTAL: 'flux_jobs_recovered_total',
  JOBS_RECOVERY_FAILED_TOTAL: 'flux_jobs_recovery_failed_total',
  JOBS_STALE_TOTAL: 'flux_jobs_stale_total',
  JOBS_RECONCILED_TOTAL: 'flux_jobs_reconciled_total',
  REDIS_ORPHANS_REMOVED_TOTAL: 'flux_redis_orphans_removed_total',
  RECOVERY_DURATION_MS: 'flux_recovery_duration_ms',
  RECOVERY_CONFLICTS_TOTAL: 'flux_recovery_conflicts_total',
} as const;

export const DEFAULT_LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
export const API_LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
export const DB_LATENCY_BUCKETS_MS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
export const REDIS_LATENCY_BUCKETS_MS = [0.5, 1, 2, 5, 10, 25, 50, 100, 250];
