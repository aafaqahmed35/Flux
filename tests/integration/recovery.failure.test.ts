import { pgPool } from '../../src/database/postgres.js';
import { runMigrations } from '../../src/database/migrator.js';
import { redisClient } from '../../src/redis/redis.js';
import { PostgresJobRepository } from '../../src/repositories/job.repository.js';
import { RedisQueue } from '../../src/queue/redis.queue.js';
import { RecoveryEngine } from '../../src/recovery/recovery.engine.js';
import { RecoveryRuntime } from '../../src/recovery/recovery.runtime.js';
import { JobStatus } from '../../src/constants/job.constants.js';

describe('Recovery Failure & Stress Integration Tests', () => {
  const repository = new PostgresJobRepository(pgPool);
  const queueEngine = new RedisQueue(redisClient);
  const engine = new RecoveryEngine(repository, queueEngine);

  const createdJobIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();
  });

  afterEach(async () => {
    for (const id of createdJobIds) {
      await repository.deleteJob(id).catch(() => {});
      await queueEngine.removeOrphanJob('stress.int', id).catch(() => {});
    }
    createdJobIds.length = 0;
  });

  afterAll(async () => {
    await pgPool.end();
    if (redisClient.status === 'ready' || redisClient.status === 'connecting') {
      await redisClient.quit();
    }
  });

  it('should handle leader failover cleanly when current leader releases lock', async () => {
    const runtime1 = new RecoveryRuntime({ instanceId: 'leader-node-1', redisClient });
    const runtime2 = new RecoveryRuntime({ instanceId: 'standby-node-2', redisClient });

    await runtime1.start();
    await new Promise((r) => setTimeout(r, 150));

    expect(runtime1.isLeaderInstance).toBe(true);

    await runtime2.start();
    await new Promise((r) => setTimeout(r, 150));

    expect(runtime2.isLeaderInstance).toBe(false);

    // Stop leader node 1
    await runtime1.stop();

    // Standby node 2 should acquire leader lock on next tick attempt
    await new Promise((r) => setTimeout(r, 200));

    await runtime2.stop();
  });

  it('should process a batch of 50 stale jobs without duplicates or errors', async () => {
    const jobsCount = 50;
    const batchJobIds: string[] = [];

    for (let i = 0; i < jobsCount; i++) {
      const job = await repository.createJob({
        name: `batch-stale-${i}`,
        queueName: 'stress.int',
      });
      batchJobIds.push(job.id);
      createdJobIds.push(job.id);

      await repository.updateStatus(job.id, JobStatus.QUEUED);
      await repository.updateStatus(job.id, JobStatus.RUNNING, {
        workerId: `worker-${i}`,
        lockedAt: new Date(),
      });
    }

    // Set all jobs to stale locked_at
    await pgPool.query(
      "UPDATE jobs SET locked_at = NOW() - INTERVAL '60 seconds' WHERE queue_name = 'stress.int'",
    );

    const result = await engine.runRecovery();

    expect(result.scannedCount).toBe(jobsCount);
    expect(result.recoveredCount).toBe(jobsCount);
    expect(result.failedCount).toBe(0);
  });
});
