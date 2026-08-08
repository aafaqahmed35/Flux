/* eslint-disable @typescript-eslint/unbound-method */
import { SchedulerRuntime } from '../../src/schedules/scheduler.runtime.js';
import { IScheduleRepository } from '../../src/schedules/schedule.interface.js';
import { redisClient } from '../../src/redis/redis.js';
import { JobService } from '../../src/services/job.service.js';

jest.mock('../../src/redis/redis.js', () => ({
  redisClient: {
    set: jest.fn(),
    get: jest.fn(),
    pexpire: jest.fn(),
    eval: jest.fn(),
  },
}));

describe('SchedulerRuntime Unit Tests', () => {
  let mockRepo: jest.Mocked<IScheduleRepository>;
  let mockJobService: jest.Mocked<JobService>;
  const mockRedis = redisClient as jest.Mocked<typeof redisClient>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRepo = {
      createSchedule: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn(),
      listSchedules: jest.fn(),
      updateSchedule: jest.fn(),
      deleteSchedule: jest.fn(),
      findDueSchedules: jest.fn().mockResolvedValue([]),
      updateNextRun: jest.fn(),
      toggleEnabled: jest.fn(),
      addExecutionRecord: jest.fn(),
      getExecutionHistory: jest.fn(),
    };

    mockJobService = {
      createJob: jest.fn().mockResolvedValue({ job: { id: 'job-100' }, isDuplicate: false }),
    } as unknown as jest.Mocked<JobService>;

    (mockRedis.set as jest.Mock).mockResolvedValue('OK');
    (mockRedis.get as jest.Mock).mockResolvedValue('scheduler-test-id');
    (mockRedis.pexpire as jest.Mock).mockResolvedValue(1);
    (mockRedis.eval as jest.Mock).mockResolvedValue(1);
  });

  it('should acquire leader lock on start and run overdue recovery', async () => {
    const runtime = new SchedulerRuntime(mockRepo, mockJobService, 'scheduler-test-id');

    await runtime.start();

    expect(runtime.isLeader()).toBe(true);
    expect(runtime.isRunning()).toBe(true);
    expect(mockRepo.findDueSchedules).toHaveBeenCalledTimes(1);

    await runtime.stop();
    expect(runtime.isRunning()).toBe(false);
  });

  it('should ignore duplicate start() calls without recreating timers', async () => {
    const runtime = new SchedulerRuntime(mockRepo, mockJobService, 'scheduler-test-id');

    await runtime.start();
    const findDueCallCount = (mockRepo.findDueSchedules as jest.Mock).mock.calls.length;

    await runtime.start(); // Second start
    expect((mockRepo.findDueSchedules as jest.Mock).mock.calls.length).toBe(findDueCallCount);

    await runtime.stop();
  });

  it('should execute due schedules during tick()', async () => {
    const dueSchedule = {
      id: 'sch-due',
      name: 'due-task',
      queueName: 'emails',
      cronExpression: '*/5 * * * *',
      timezone: 'UTC',
      payload: {},
      metadata: {},
      enabled: true,
      nextRunAt: new Date(Date.now() - 10000),
      lastRunAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockRepo.findDueSchedules.mockResolvedValue([dueSchedule]);

    const runtime = new SchedulerRuntime(mockRepo, mockJobService, 'scheduler-test-id');
    await runtime.start();
    mockRepo.addExecutionRecord.mockClear();

    await runtime.tick();

    expect(mockJobService.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'due-task',
        queueName: 'emails',
      }),
    );
    expect(mockRepo.updateNextRun).toHaveBeenCalledWith(
      'sch-due',
      expect.any(Date),
      expect.any(Date),
    );
    expect(mockRepo.addExecutionRecord).toHaveBeenCalledTimes(1);

    await runtime.stop();
  });

  it('should handle leadership loss during lock renewal', async () => {
    const runtime = new SchedulerRuntime(mockRepo, mockJobService, 'scheduler-test-id');
    await runtime.start();
    expect(runtime.isLeader()).toBe(true);

    // Simulate another instance taking leadership in Redis
    (mockRedis.get as jest.Mock).mockResolvedValue('other-instance-id');

    // Trigger renewal
    const runtimeInternal = runtime as unknown as { renewLeaderLock(): Promise<boolean> };
    const isRenewed = await runtimeInternal.renewLeaderLock();
    expect(isRenewed).toBe(false);
    expect(runtime.isLeader()).toBe(false);

    await runtime.stop();
  });
});
