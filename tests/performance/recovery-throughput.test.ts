import { pgPool } from '../../src/database/postgres.js';
import { runMigrations } from '../../src/database/migrator.js';
import { redisClient } from '../../src/redis/redis.js';
import { PostgresJobRepository } from '../../src/repositories/job.repository.js';
import { RedisQueue } from '../../src/queue/redis.queue.js';
import { RecoveryEngine } from '../../src/recovery/recovery.engine.js';
import { JobStatus } from '../../src/constants/job.constants.js';

describe('Recovery Scanning Throughput Benchmark Tests', () => {
  const repository = new PostgresJobRepository(pgPool);
  const queueEngine = new RedisQueue(redisClient);
  const recoveryEngine = new RecoveryEngine(repository, queueEngine);

  const queueName = 'throughput-recovery-test';

  beforeAll(async () => {
    await runMigrations();
  });

  afterEach(async () => {
    await queueEngine.clear(queueName).catch(() => {});
    await pgPool.query('DELETE FROM jobs WHERE queue_name = $1', [queueName]);
  });

  afterAll(async () => {
    await pgPool.end();
    if (redisClient.status === 'ready' || redisClient.status === 'connecting') {
      await redisClient.quit();
    }
  });

  it('should scan and recover a batch of 50 stale jobs within a reasonable duration', async () => {
    const jobCount = 50;
    for (let i = 0; i < jobCount; i++) {
      const job = await repository.createJob({
        name: `stale-bench-${i}`,
        queueName,
      });
      await repository.updateStatus(job.id, JobStatus.QUEUED);
      await repository.updateStatus(job.id, JobStatus.RUNNING, {
        workerId: `dead-worker-${i}`,
        lockedAt: new Date(Date.now() - 60000),
      });
    }

    await pgPool.query(
      "UPDATE jobs SET locked_at = NOW() - INTERVAL '60 seconds' WHERE queue_name = $1",
      [queueName],
    );

    const start = Date.now();
    const result = await recoveryEngine.runRecovery();
    const durationMs = Date.now() - start;

    expect(result.scannedCount).toBe(jobCount);
    expect(result.recoveredCount).toBe(jobCount);
    expect(durationMs).toBeLessThan(10000);
  });
});
