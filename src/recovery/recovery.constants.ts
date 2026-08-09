export const RECOVERY_DEFAULTS = {
  leaseTimeoutMs: 30000,
  recoveryIntervalMs: 10000,
  batchSize: 100,
  reconciliationIntervalMs: 30000,
  maxRecoveryAttempts: 3,
  leaderLockKey: 'flux:recovery:leader',
  leaderTtlMs: 15000,
} as const;
