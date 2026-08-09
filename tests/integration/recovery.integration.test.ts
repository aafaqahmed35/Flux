import { pgPool } from '../../src/database/postgres.js';
import { runMigrations } from '../../src/database/migrator.js';
import { redisClient } from '../../src/redis/redis.js';
import { PostgresJobRepository } from '../../src/repositories/job.repository.js';
import { RedisQueue } from '../../src/queue/redis.queue.js';
import { RecoveryEngine } from '../../src/recovery/recovery.engine.js';
import { QueueReconciler } from '../../src/recovery/reconciler.js';
import { JobPriority, JobStatus } from '../../src/constants/job.constants.js';

describe('Recovery & Reconciliation Integration Tests', () => {
  const repository = new PostgresJobRepository(pgPool);
  const queueEngine = new RedisQueue(redisClient);
  const engine = new RecoveryEngine(repository, queueEngine);
  const reconciler = new QueueReconciler(repository, queueEngine);

  const createdJobIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();
  });

  afterEach(async () => {
    for (const id of createdJobIds) {
      await repository.deleteJob(id).catch(() => {});
      await queueEngine.removeOrphanJob('default.recovery.int', id).catch(() => {});
    }
    createdJobIds.length = 0;
  });

  afterAll(async () => {
    await pgPool.end();
    if (redisClient.status === 'ready' || redisClient.status === 'connecting') {
      await redisClient.quit();
    }
  });

  it('should recover stale RUNNING job to RETRYING and re-enqueue to Redis queue', async () => {
    const job = await repository.createJob({
      name: 'stale-running-recovery-test',
      queueName: 'default.recovery.int',
      priority: JobPriority.NORMAL,
    });
    createdJobIds.push(job.id);

    await repository.updateStatus(job.id, JobStatus.QUEUED);
    await repository.updateStatus(job.id, JobStatus.RUNNING, {
      workerId: 'worker-dead',
      lockedAt: new Date(),
    });
    await pgPool.query("UPDATE jobs SET locked_at = NOW() - INTERVAL '60 seconds' WHERE id = $1", [
      job.id,
    ]);

    const result = await engine.runRecovery();

    expect(result.recoveredCount).toBeGreaterThanOrEqual(1);
    expect(result.recoveredJobIds).toContain(job.id);

    const updated = await repository.findById(job.id);
    expect(updated?.status).toBe(JobStatus.RETRYING);
    expect(updated?.workerId).toBeNull();
    expect(updated?.lockedAt).toBeNull();
  });

  it('should recover stale CLAIMED job back to QUEUED and populate Redis queue', async () => {
    const job = await repository.createJob({
      name: 'stale-claimed-test',
      queueName: 'default.recovery.int',
    });
    createdJobIds.push(job.id);

    await repository.updateStatus(job.id, JobStatus.QUEUED);
    await repository.updateStatus(job.id, JobStatus.CLAIMED, {
      workerId: 'worker-dead',
      lockedAt: new Date(),
    });
    await pgPool.query("UPDATE jobs SET locked_at = NOW() - INTERVAL '60 seconds' WHERE id = $1", [
      job.id,
    ]);

    const result = await engine.runRecovery();

    expect(result.recoveredJobIds).toContain(job.id);
    const updated = await repository.findById(job.id);
    expect(updated?.status).toBe(JobStatus.QUEUED);

    const existsInRedis = await queueEngine.containsJob('default.recovery.int', job.id);
    expect(existsInRedis).toBe(true);
  });

  it('should reconcile PG QUEUED job missing from Redis', async () => {
    const job = await repository.createJob({
      name: 'missing-redis-test',
      queueName: 'default.recovery.int',
    });
    createdJobIds.push(job.id);

    await repository.updateStatus(job.id, JobStatus.QUEUED);

    // Ensure Redis does NOT contain job
    await queueEngine.remove('default.recovery.int', job.id);

    const reconResult = await reconciler.runReconciliation();

    expect(reconResult.reenqueuedCount).toBeGreaterThanOrEqual(1);
    expect(reconResult.reconciledJobIds).toContain(job.id);

    const existsInRedis = await queueEngine.containsJob('default.recovery.int', job.id);
    expect(existsInRedis).toBe(true);
  });

  it('should remove orphan Redis job ID with no matching PG record', async () => {
    const orphanId = '00000000-0000-0000-0000-000000000099';
    await queueEngine.enqueue('default.recovery.int', orphanId);

    const reconResult = await reconciler.runReconciliation();

    expect(reconResult.orphansRemovedCount).toBeGreaterThanOrEqual(1);
    expect(reconResult.reconciledJobIds).toContain(orphanId);

    const existsInRedis = await queueEngine.containsJob('default.recovery.int', orphanId);
    expect(existsInRedis).toBe(false);
  });
});
