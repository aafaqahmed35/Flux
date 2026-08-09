import { redisClient } from '../../src/redis/redis.js';
import { RedisQueue } from '../../src/queue/redis.queue.js';

describe('Queue Transport Throughput Benchmark Tests', () => {
  const queueEngine = new RedisQueue(redisClient);
  const queueName = 'throughput-queue-test';

  afterEach(async () => {
    await queueEngine.clear(queueName).catch(() => {});
  });

  afterAll(async () => {
    if (redisClient.status === 'ready' || redisClient.status === 'connecting') {
      await redisClient.quit();
    }
  });

  it('should benchmark single and batch enqueue and claim throughput in Redis', async () => {
    const jobIds = Array.from({ length: 200 }).map((_, i) => `job-q-${i}`);

    const startEnqueue = Date.now();
    await queueEngine.enqueueMany(queueName, jobIds);
    const enqueueDurationMs = Date.now() - startEnqueue;
    const enqueueThroughput = Number((jobIds.length / (enqueueDurationMs / 1000)).toFixed(2));

    expect(enqueueThroughput).toBeGreaterThan(0);

    const length = await queueEngine.queueLength(queueName);
    expect(length).toBe(200);

    const startClaim = Date.now();
    const claimedIds: string[] = [];
    for (let i = 0; i < 200; i++) {
      const id = await queueEngine.claimJob(queueName, 0);
      if (id) claimedIds.push(id);
    }
    const claimDurationMs = Date.now() - startClaim;
    const claimThroughput = Number((claimedIds.length / (claimDurationMs / 1000)).toFixed(2));

    expect(claimedIds).toHaveLength(200);
    expect(claimThroughput).toBeGreaterThan(0);
  });
});
