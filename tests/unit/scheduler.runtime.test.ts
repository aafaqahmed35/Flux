import { SchedulerRuntime } from '../../src/schedules/scheduler.runtime';
import { IScheduleRepository } from '../../src/schedules/schedule.interface';
import { getRedisClient } from '../../src/redis/redis';

jest.mock('../../src/redis/redis');

describe('SchedulerRuntime Unit Tests', () => {
  let mockRepo: jest.Mocked<IScheduleRepository>;
  let mockJobService: any;
  let mockRedis: any;

  beforeEach(() => {
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
      createJob: jest.fn().mockResolvedValue({ id: 'job-100' }),
    };

    mockRedis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue('scheduler-test-id'),
      pexpire: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
    };

    (getRedisClient as jest.Mock).mockReturnValue(mockRedis);
  });

  it('should acquire leader lock on start and run overdue recovery', async () => {
    const runtime = new SchedulerRuntime(mockRepo, mockJobService, 'scheduler-test-id');

    await runtime.start();

    expect(runtime.isLeader()).toBe(true);
    expect(runtime.isRunning()).toBe(true);
    expect(mockRepo.findDueSchedules).toHaveBeenCalled();

    await runtime.stop();
    expect(runtime.isRunning()).toBe(false);
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

    await runtime.tick();

    expect(mockJobService.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'due-task',
        queueName: 'emails',
      }),
    );
    expect(mockRepo.updateNextRun).toHaveBeenCalledWith('sch-due', expect.any(Date), expect.any(Date));
    expect(mockRepo.addExecutionRecord).toHaveBeenCalled();

    await runtime.stop();
  });
});
