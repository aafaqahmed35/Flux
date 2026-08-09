import { Redis } from 'ioredis';
import { appLogger, errorLogger } from '../logger/logger.js';
import { redisClient as defaultRedisClient } from '../redis/redis.js';
import { RECOVERY_DEFAULTS } from './recovery.constants.js';
import { RecoveryEngine } from './recovery.engine.js';
import { RecoveryMetrics, RecoveryOptions } from './recovery.types.js';
import { QueueReconciler } from './reconciler.js';

const RENEW_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export class RecoveryRuntime {
  readonly instanceId: string;
  private readonly redis: Redis;
  private readonly engine: RecoveryEngine;
  private readonly reconciler: QueueReconciler;
  private readonly options: Required<RecoveryOptions>;

  private isRunning = false;
  private isLeader = false;
  private tickTimer: NodeJS.Timeout | null = null;
  private lastTickTime: Date | null = null;
  private isProcessingTick = false;

  private totalScans = 0;
  private totalRecovered = 0;
  private totalFailed = 0;
  private totalStaleJobs = 0;
  private totalReconciled = 0;
  private totalOrphansRemoved = 0;
  private totalConflicts = 0;
  private lastScanTimeMs: number | null = null;
  private lastReconciliationTimeMs: number | null = null;

  constructor(
    options?: RecoveryOptions & { instanceId?: string; redisClient?: Redis },
    engine?: RecoveryEngine,
    reconciler?: QueueReconciler,
  ) {
    this.instanceId =
      options?.instanceId ?? `recovery-${Math.random().toString(36).substring(2, 9)}`;
    this.redis = options?.redisClient ?? defaultRedisClient;
    this.engine = engine ?? new RecoveryEngine();
    this.reconciler = reconciler ?? new QueueReconciler();

    this.options = {
      leaseTimeoutMs: options?.leaseTimeoutMs ?? RECOVERY_DEFAULTS.leaseTimeoutMs,
      recoveryIntervalMs: options?.recoveryIntervalMs ?? RECOVERY_DEFAULTS.recoveryIntervalMs,
      batchSize: options?.batchSize ?? RECOVERY_DEFAULTS.batchSize,
      reconciliationIntervalMs:
        options?.reconciliationIntervalMs ?? RECOVERY_DEFAULTS.reconciliationIntervalMs,
      maxRecoveryAttempts: options?.maxRecoveryAttempts ?? RECOVERY_DEFAULTS.maxRecoveryAttempts,
    };
  }

  get isLeaderInstance(): boolean {
    return this.isLeader;
  }

  get isRuntimeRunning(): boolean {
    return this.isRunning;
  }

  getMetrics(): RecoveryMetrics & { leader: boolean; running: boolean; lastTick: string | null } {
    return {
      leader: this.isLeader,
      running: this.isRunning,
      lastTick: this.lastTickTime ? this.lastTickTime.toISOString() : null,
      totalScans: this.totalScans,
      totalRecovered: this.totalRecovered,
      totalFailed: this.totalFailed,
      totalStaleJobs: this.totalStaleJobs,
      totalReconciled: this.totalReconciled,
      totalOrphansRemoved: this.totalOrphansRemoved,
      totalConflicts: this.totalConflicts,
      lastScanTimeMs: this.lastScanTimeMs,
      lastReconciliationTimeMs: this.lastReconciliationTimeMs,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    appLogger.info('RecoveryRuntime starting', {
      instanceId: this.instanceId,
      intervalMs: this.options.recoveryIntervalMs,
    });

    this.scheduleNextTick(0);
    await Promise.resolve();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }

    if (this.isLeader) {
      await this.releaseLeaderLock();
      this.isLeader = false;
    }

    appLogger.info('RecoveryRuntime stopped cleanly', { instanceId: this.instanceId });
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.isRunning) {
      return;
    }

    this.tickTimer = setTimeout(() => {
      void this.executeTick();
    }, delayMs);
  }

  private async executeTick(): Promise<void> {
    if (!this.isRunning || this.isProcessingTick) {
      return;
    }

    this.isProcessingTick = true;
    try {
      if (!this.isLeader) {
        this.isLeader = await this.tryAcquireLeader();
      } else {
        const renewed = await this.renewLeaderLock();
        if (!renewed) {
          appLogger.warn('Recovery instance lost leader lock during tick', {
            instanceId: this.instanceId,
          });
          this.isLeader = false;
        }
      }

      if (this.isLeader) {
        this.lastTickTime = new Date();
        appLogger.info('Recovery tick starting (Leader)', { instanceId: this.instanceId });

        // Execute recovery engine scan
        const scanStart = Date.now();
        const recoveryResult = await this.engine.runRecovery();
        this.lastScanTimeMs = Date.now() - scanStart;

        this.totalScans++;
        this.totalRecovered += recoveryResult.recoveredCount;
        this.totalFailed += recoveryResult.failedCount;
        this.totalStaleJobs = recoveryResult.scannedCount;

        // Execute reconciler scan
        const reconStart = Date.now();
        const reconResult = await this.reconciler.runReconciliation();
        this.lastReconciliationTimeMs = Date.now() - reconStart;

        this.totalReconciled += reconResult.reenqueuedCount + reconResult.staleRedisRemovedCount;
        this.totalOrphansRemoved += reconResult.orphansRemovedCount;
      } else {
        appLogger.debug('Recovery tick skipped (Standby)', { instanceId: this.instanceId });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error('Error executing recovery runtime tick', {
        instanceId: this.instanceId,
        error: msg,
      });
    } finally {
      this.isProcessingTick = false;
      if (this.isRunning) {
        this.scheduleNextTick(this.options.recoveryIntervalMs);
      }
    }
  }

  private async tryAcquireLeader(): Promise<boolean> {
    try {
      const result = await this.redis.set(
        RECOVERY_DEFAULTS.leaderLockKey,
        this.instanceId,
        'PX',
        RECOVERY_DEFAULTS.leaderTtlMs,
        'NX',
      );
      const acquired = result === 'OK';
      if (acquired) {
        appLogger.info('Acquired recovery leader lock', { instanceId: this.instanceId });
      }
      return acquired;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error('Failed to acquire recovery leader lock', { error: msg });
      return false;
    }
  }

  private async renewLeaderLock(): Promise<boolean> {
    try {
      const res = await this.redis.eval(
        RENEW_LOCK_LUA,
        1,
        RECOVERY_DEFAULTS.leaderLockKey,
        this.instanceId,
        RECOVERY_DEFAULTS.leaderTtlMs,
      );
      return res === 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error('Failed to renew recovery leader lock', { error: msg });
      return false;
    }
  }

  private async releaseLeaderLock(): Promise<void> {
    try {
      await this.redis.eval(RELEASE_LOCK_LUA, 1, RECOVERY_DEFAULTS.leaderLockKey, this.instanceId);
      appLogger.info('Released recovery leader lock', { instanceId: this.instanceId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error('Failed to release recovery leader lock', { error: msg });
    }
  }
}

export const recoveryRuntime = new RecoveryRuntime();
