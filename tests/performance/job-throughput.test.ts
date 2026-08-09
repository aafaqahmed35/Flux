/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
import { pgPool } from '../../src/database/postgres.js';

import { runMigrations } from '../../src/database/migrator.js';
import { redisClient } from '../../src/redis/redis.js';
import { PostgresJobRepository } from '../../src/repositories/job.repository.js';
import { RedisQueue } from '../../src/queue/redis.queue.js';
import { QueueService } from '../../src/queue/queue.service.js';
import { JobService } from '../../src/services/job.service.js';

describe('Job Creation Throughput Benchmark Tests', () => {
  const repository = new PostgresJobRepository(pgPool);
  const queueEngine = new RedisQueue(redisClient);
  const queueService = new QueueService(queueEngine, repository);
  const jobService = new JobService(repository, queueService);

  const queueName = 'throughput-job-create-test';

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

  it('should measure 100 job creation batch throughput and latency', async () => {
    const jobCount = 100;
    const start = Date.now();

    const batch = Array.from({ length: jobCount }).map((_, i) =>
      jobService.createJob({
        name: `bench-create-${i}`,
        queueName,
        payload: { i },
      }),
    );

    const results = await Promise.all(batch);
    const durationMs = Date.now() - start;
    const throughput = Number((jobCount / (durationMs / 1000)).toFixed(2));

    expect(results).toHaveLength(jobCount);
    expect(throughput).toBeGreaterThan(0);

    const countRes = await pgPool.query(
      "SELECT COUNT(*)::int as count FROM jobs WHERE queue_name = $1 AND status = 'QUEUED'",
      [queueName],
    );
    expect(countRes.rows[0].count).toBe(jobCount);
  });
});
