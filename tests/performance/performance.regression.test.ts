import { pgPool } from '../../src/database/postgres.js';
import { runMigrations } from '../../src/database/migrator.js';
import { redisClient } from '../../src/redis/redis.js';
import { PostgresJobRepository } from '../../src/repositories/job.repository.js';
import { RedisQueue } from '../../src/queue/redis.queue.js';
import { QueueService } from '../../src/queue/queue.service.js';
import { JobService } from '../../src/services/job.service.js';

describe('Performance Regression Test Suite', () => {
  const repository = new PostgresJobRepository(pgPool);
  const queueEngine = new RedisQueue(redisClient);
  const queueService = new QueueService(queueEngine, repository);
  const jobService = new JobService(repository, queueService);

  const queueName = 'regression-perf-test';

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

  it('should verify single job creation latency stays below 100ms threshold', async () => {
    const start = Date.now();
    const result = await jobService.createJob({
      name: 'regression-job',
      queueName,
    });
    const durationMs = Date.now() - start;

    expect(result.job.id).toBeDefined();
    expect(durationMs).toBeLessThan(100);
  });

  it('should verify Redis claim latency stays below 50ms threshold', async () => {
    await queueEngine.enqueue(queueName, 'job-reg-1');
    const start = Date.now();
    const claimedId = await queueEngine.claimJob(queueName, 0);
    const durationMs = Date.now() - start;

    expect(claimedId).toBe('job-reg-1');
    expect(durationMs).toBeLessThan(50);
  });
});
