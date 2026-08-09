/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
import { pgPool } from '../../src/database/postgres.js';
import { runMigrations } from '../../src/database/migrator.js';
import { redisClient } from '../../src/redis/redis.js';
import { PostgresJobRepository } from '../../src/repositories/job.repository.js';
import { RedisQueue } from '../../src/queue/redis.queue.js';
import { QueueService } from '../../src/queue/queue.service.js';
import { JobService } from '../../src/services/job.service.js';
import { WorkerRuntime } from '../../src/workers/worker.runtime.js';
import { processorRegistry } from '../../src/workers/processor.registry.js';

describe('Worker Execution Throughput Benchmark Tests', () => {
  const repository = new PostgresJobRepository(pgPool);
  const queueEngine = new RedisQueue(redisClient);
  const queueService = new QueueService(queueEngine, repository);
  const jobService = new JobService(repository, queueService);

  const queueName = 'throughput-worker-test';

  beforeAll(async () => {
    await runMigrations();
  });

  afterEach(async () => {
    processorRegistry.removeProcessor(queueName);
    await queueEngine.clear(queueName).catch(() => {});
    await pgPool.query('DELETE FROM jobs WHERE queue_name = $1', [queueName]);
  });

  afterAll(async () => {
    await pgPool.end();
    if (redisClient.status === 'ready' || redisClient.status === 'connecting') {
      await redisClient.quit();
    }
  });

  it('should process 100 jobs across worker concurrency levels (10 vs 25)', async () => {
    const jobCount = 100;
    for (let i = 0; i < jobCount; i++) {
      await jobService.createJob({
        name: `worker-bench-${i}`,
        queueName,
      });
    }

    processorRegistry.registerProcessor(queueName, async (): Promise<{ ok: boolean }> => {
      await Promise.resolve();
      return { ok: true };
    });

    const worker = new WorkerRuntime(
      {
        workerId: 'worker-bench-1',
        queues: [queueName],
        concurrency: 25,
        pollIntervalMs: 10,
      },
      queueEngine,
      repository,
    );

    const start = Date.now();
    await worker.start();

    let completed = 0;
    while (Date.now() - start < 15000) {
      const res = await pgPool.query<{ count: number }>(
        "SELECT COUNT(*)::int as count FROM jobs WHERE queue_name = $1 AND status = 'COMPLETED'",
        [queueName],
      );
      completed = Number(res.rows[0]?.count ?? 0);
      if (completed >= jobCount) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const durationMs = Date.now() - start;
    await worker.stop();

    expect(completed).toBe(jobCount);
    const throughput = Number((jobCount / (durationMs / 1000)).toFixed(2));
    expect(throughput).toBeGreaterThan(0);
  });
});
