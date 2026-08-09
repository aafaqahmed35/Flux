/* eslint-disable @typescript-eslint/unbound-method */
import { RecoveryRuntime } from '../../src/recovery/recovery.runtime.js';

import { RecoveryEngine } from '../../src/recovery/recovery.engine.js';
import { QueueReconciler } from '../../src/recovery/reconciler.js';
import { Redis } from 'ioredis';

describe('RecoveryRuntime Unit Tests', () => {
  let mockRedis: jest.Mocked<Redis>;
  let mockEngine: jest.Mocked<RecoveryEngine>;
  let mockReconciler: jest.Mocked<QueueReconciler>;
  let runtime: RecoveryRuntime;

  beforeEach(() => {
    jest.useFakeTimers();

    mockRedis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<Redis>;

    mockEngine = {
      runRecovery: jest.fn().mockResolvedValue({
        scannedCount: 2,
        recoveredCount: 1,
        failedCount: 0,
        skippedCount: 0,
        recoveredJobIds: ['j-1'],
        failedJobIds: [],
        errors: [],
      }),
    } as unknown as jest.Mocked<RecoveryEngine>;

    mockReconciler = {
      runReconciliation: jest.fn().mockResolvedValue({
        scannedCount: 5,
        reenqueuedCount: 1,
        staleRedisRemovedCount: 0,
        orphansRemovedCount: 0,
        reconciledJobIds: ['j-2'],
        errors: [],
      }),
    } as unknown as jest.Mocked<QueueReconciler>;

    runtime = new RecoveryRuntime(
      { instanceId: 'recovery-test-node', redisClient: mockRedis, recoveryIntervalMs: 100 },
      mockEngine,
      mockReconciler,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should acquire leader lock and run recovery/reconciliation tick', async () => {
    void runtime.start();

    // Trigger startup tick
    await jest.advanceTimersByTimeAsync(10);

    const { set } = mockRedis;
    const { runRecovery } = mockEngine;
    const { runReconciliation } = mockReconciler;

    expect(set).toHaveBeenCalledWith(
      'flux:recovery:leader',
      'recovery-test-node',
      'PX',
      15000,
      'NX',
    );
    expect(runtime.isLeaderInstance).toBe(true);
    expect(runRecovery).toHaveBeenCalled();
    expect(runReconciliation).toHaveBeenCalled();

    const metrics = runtime.getMetrics();
    expect(metrics.leader).toBe(true);
    expect(metrics.totalScans).toBe(1);
    expect(metrics.totalRecovered).toBe(1);

    await runtime.stop();
  });

  it('should remain standby when leader lock acquisition returns false', async () => {
    mockRedis.set.mockResolvedValueOnce(null);

    void runtime.start();
    await jest.advanceTimersByTimeAsync(10);

    const { runRecovery } = mockEngine;
    const { runReconciliation } = mockReconciler;

    expect(runtime.isLeaderInstance).toBe(false);
    expect(runRecovery).not.toHaveBeenCalled();
    expect(runReconciliation).not.toHaveBeenCalled();

    await runtime.stop();
  });

  it('should release leader lock cleanly on stop', async () => {
    void runtime.start();
    await jest.advanceTimersByTimeAsync(10);

    await runtime.stop();

    const { eval: evalCmd } = mockRedis;

    expect(evalCmd).toHaveBeenCalledWith(
      expect.stringContaining('del'),
      1,
      'flux:recovery:leader',
      'recovery-test-node',
    );
    expect(runtime.isLeaderInstance).toBe(false);
  });
});
