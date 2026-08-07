import { getPgPool } from '../../src/database/postgres';
import { getRedisClient } from '../../src/redis/redis';
import { ScheduleService } from '../../src/schedules/schedule.service';
import { SchedulerRuntime } from '../../src/schedules/scheduler.runtime';
import { WorkerRuntime } from '../../src/workers/worker.runtime';
import { processorRegistry } from '../../src/workers/processor.registry';

describe('Scheduler Engine End-to-End Integration Test', () => {
  const testQueue = `sch-e2e-${Date.now()}`;
  let scheduleService: ScheduleService;
  let schedulerRuntime: SchedulerRuntime;
  let workerRuntime: WorkerRuntime;
  let scheduleId: string;
  let processedCount = 0;

  beforeAll(async () => {
    scheduleService = new ScheduleService();

    // Register test processor
    processorRegistry.register({
      queueName: testQueue,
      handler: async (job) => {
        processedCount++;
        return { success: true, processedJobId: job.id };
      },
    });

    workerRuntime = new WorkerRuntime({
      workerId: `wrk-sch-e2e-${Date.now()}`,
      queues: [testQueue],
      concurrency: 1,
      pollIntervalMs: 200,
    });
    await workerRuntime.start();
  });

  afterAll(async () => {
    if (schedulerRuntime) {
      await schedulerRuntime.stop();
    }
    if (workerRuntime) {
      await workerRuntime.stop();
    }

    processorRegistry.unregister(testQueue);

    try {
      const pool = getPgPool();
      await pool.query(
        'DELETE FROM schedule_execution_history WHERE schedule_id IN (SELECT id FROM schedules WHERE queue_name = $1)',
        [testQueue],
      );
      await pool.query('DELETE FROM schedules WHERE queue_name = $1', [testQueue]);
      await pool.query('DELETE FROM jobs WHERE queue_name = $1', [testQueue]);

      const redis = getRedisClient();
      await redis.del(`flux:queue:${testQueue}`);
      await redis.del('flux:scheduler:leader');
    } catch {
      // Cleanup fallback
    }
  });

  it('should create schedule, execute tick(), enqueue job to Redis, and have Worker process it', async () => {
    // 1. Create schedule with next_run_at set in the past so it is due
    const schedule = await scheduleService.createSchedule({
      name: 'e2e-recurring-job',
      queueName: testQueue,
      cronExpression: '*/5 * * * *',
      timezone: 'UTC',
      payload: { e2e: true },
    });

    scheduleId = schedule.id;

    // Manually force next_run_at to past to trigger due polling
    const pool = getPgPool();
    await pool.query('UPDATE schedules SET next_run_at = NOW() - INTERVAL \'1 minute\' WHERE id = $1', [
      scheduleId,
    ]);

    // 2. Start SchedulerRuntime
    schedulerRuntime = new SchedulerRuntime(undefined, undefined, `scheduler-e2e-${Date.now()}`);
    await schedulerRuntime.start();

    // Execute explicit tick
    await schedulerRuntime.tick();

    // 3. Verify job created in PostgreSQL and enqueued to Redis
    const jobsRes = await pool.query('SELECT * FROM jobs WHERE queue_name = $1', [testQueue]);
    expect(jobsRes.rows.length).toBeGreaterThanOrEqual(1);

    // 4. Wait for WorkerRuntime to process the job
    let retries = 0;
    while (processedCount < 1 && retries < 20) {
      await new Promise((res) => setTimeout(res, 200));
      retries++;
    }

    expect(processedCount).toBe(1);

    // 5. Verify next_run_at was updated to future timestamp
    const updatedScheduleRes = await pool.query('SELECT * FROM schedules WHERE id = $1', [scheduleId]);
    const updatedNextRun = new Date(updatedScheduleRes.rows[0].next_run_at);
    expect(updatedNextRun.getTime()).toBeGreaterThan(Date.now());

    // 6. Verify execution history recorded
    const history = await scheduleService.getExecutionHistory(scheduleId);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].status).toBe('SUCCESS');
  });
});
