export const SCHEDULER_REDIS_LOCK_KEY = 'flux:scheduler:leader';
export const SCHEDULER_LOCK_TTL_MS = 15000;
export const SCHEDULER_POLL_INTERVAL_MS = 5000;
export const SCHEDULER_HEARTBEAT_INTERVAL_MS = 5000;

export const DEFAULT_SCHEDULE_TIMEZONE = 'UTC';

export const CRON_MACROS: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};
