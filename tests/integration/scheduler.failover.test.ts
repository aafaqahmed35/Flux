import { getRedisClient } from '../../src/redis/redis';
import { SchedulerRuntime } from '../../src/schedules/scheduler.runtime';
import { SCHEDULER_REDIS_LOCK_KEY } from '../../src/schedules/schedule.constants';

describe('Scheduler Leader Lock Distributed Failover Integration Test', () => {
  let instance1: SchedulerRuntime;
  let instance2: SchedulerRuntime;

  afterEach(async () => {
    if (instance1) await instance1.stop();
    if (instance2) await instance2.stop();

    try {
      const redis = getRedisClient();
      await redis.del(SCHEDULER_REDIS_LOCK_KEY);
    } catch {
      // Cleanup fallback
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
    const redis = getRedisClient();
    const currentLeader = await redis.get(SCHEDULER_REDIS_LOCK_KEY);
    expect(currentLeader).toBe('instance-1');

    // 4. Instance 1 stops and releases leader lock
    await instance1.stop();
    expect(instance1.isLeader()).toBe(false);

    // 5. Instance 2 should acquire leader lock upon next attempt
    // Manually invoke start or heartbeat tick for instance2
    await instance2.start();
    expect(instance2.isLeader()).toBe(true);

    const newLeader = await redis.get(SCHEDULER_REDIS_LOCK_KEY);
    expect(newLeader).toBe('instance-2');
  });
});
