import { redisClient, closeRedisConnection } from '../../src/redis/redis.js';
import { SchedulerRuntime } from '../../src/schedules/scheduler.runtime.js';
import { SCHEDULER_REDIS_LOCK_KEY } from '../../src/schedules/schedule.constants.js';

describe('Scheduler Leader Lock Distributed Failover Integration Test', () => {
  let instance1: SchedulerRuntime;
  let instance2: SchedulerRuntime;

  afterEach(async () => {
    if (instance1) await instance1.stop();
    if (instance2) await instance2.stop();

    try {
      await redisClient.del(SCHEDULER_REDIS_LOCK_KEY);
    } catch {
      // Cleanup fallback
    }
  });

  afterAll(async () => {
    try {
      await closeRedisConnection();
    } catch {
      // Cleanup
    }
  });

  it('should allow only one instance to acquire Leader Lock and perform failover on instance stop', async () => {
    instance1 = new SchedulerRuntime(undefined, undefined, 'instance-1');
    instance2 = new SchedulerRuntime(undefined, undefined, 'instance-2');

    // 1. Instance 1 starts first and acquires leader lock
    await instance1.start();
    expect(instance1.isLeader()).toBe(true);

    // 2. Instance 2 starts second and becomes standby node
    await instance2.start();
    expect(instance2.isLeader()).toBe(false);

    // 3. Verify Redis lock key holds instance-1
    const currentLeader = await redisClient.get(SCHEDULER_REDIS_LOCK_KEY);
    expect(currentLeader).toBe('instance-1');

    // 4. Instance 1 stops and releases leader lock
    await instance1.stop();
    expect(instance1.isLeader()).toBe(false);

    // 5. Instance 2 should acquire leader lock upon next attempt
    const instance2Internal = instance2 as unknown as {
      acquireLeaderLock(): Promise<boolean>;
      startPollingLoop(): void;
    };
    const acquired = await instance2Internal.acquireLeaderLock();
    if (acquired) {
      instance2Internal.startPollingLoop();
    }
    expect(instance2.isLeader()).toBe(true);

    const newLeader = await redisClient.get(SCHEDULER_REDIS_LOCK_KEY);
    expect(newLeader).toBe('instance-2');
  });
});
