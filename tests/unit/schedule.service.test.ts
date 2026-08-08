/* eslint-disable @typescript-eslint/unbound-method */
import { ScheduleService } from '../../src/schedules/schedule.service.js';
import { ScheduleNotFoundError } from '../../src/schedules/schedule.errors.js';
import { IScheduleRepository } from '../../src/schedules/schedule.interface.js';
import { Schedule } from '../../src/schedules/schedule.types.js';
import { JobService } from '../../src/services/job.service.js';

describe('ScheduleService Unit Tests', () => {
  let mockRepo: jest.Mocked<IScheduleRepository>;
  let mockJobService: jest.Mocked<JobService>;
  let service: ScheduleService;

  const mockSchedule: Schedule = {
    id: 'sch-123',
    name: 'test-schedule',
    queueName: 'test-queue',
    cronExpression: '0 0 * * *',
    timezone: 'UTC',
    payload: { test: true },
    metadata: {},
    enabled: true,
    nextRunAt: new Date('2026-08-08T00:00:00.000Z'),
    lastRunAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockRepo = {
      createSchedule: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn(),
      listSchedules: jest.fn(),
      updateSchedule: jest.fn(),
      deleteSchedule: jest.fn(),
      findDueSchedules: jest.fn(),
      updateNextRun: jest.fn(),
      toggleEnabled: jest.fn(),
      addExecutionRecord: jest.fn(),
      getExecutionHistory: jest.fn(),
    };

    mockJobService = {
      createJob: jest.fn().mockResolvedValue({ job: { id: 'job-999' }, isDuplicate: false }),
    } as unknown as jest.Mocked<JobService>;

    service = new ScheduleService(mockRepo, mockJobService);
  });

  it('should create schedule successfully', async () => {
    mockRepo.createSchedule.mockResolvedValue(mockSchedule);

    const result = await service.createSchedule({
      name: 'test-schedule',
      queueName: 'test-queue',
      cronExpression: '0 0 * * *',
    });

    expect(result.id).toBe('sch-123');
    expect(mockRepo.createSchedule).toHaveBeenCalledTimes(1);
  });

  it('should throw ScheduleNotFoundError when schedule does not exist', async () => {
    mockRepo.findById.mockResolvedValue(null);

    await expect(service.getScheduleById('non-existent')).rejects.toThrow(ScheduleNotFoundError);
  });

  it('should trigger schedule manually via triggerScheduleNow', async () => {
    mockRepo.findById.mockResolvedValue(mockSchedule);
    mockRepo.addExecutionRecord.mockResolvedValue({
      id: 'rec-1',
      scheduleId: 'sch-123',
      jobId: 'job-999',
      startedAt: new Date(),
      finishedAt: new Date(),
      status: 'SUCCESS',
      executionTimeMs: 0,
      workerId: null,
      errorMessage: null,
      createdAt: new Date(),
    });

    const result = await service.triggerScheduleNow('sch-123');

    expect(result.jobId).toBe('job-999');
    expect(mockJobService.createJob).toHaveBeenCalledTimes(1);
    expect(mockRepo.addExecutionRecord).toHaveBeenCalledTimes(1);
  });

  it('should toggle schedule enabled status', async () => {
    mockRepo.findById.mockResolvedValue(mockSchedule);
    mockRepo.toggleEnabled.mockResolvedValue({ ...mockSchedule, enabled: false });

    const disabled = await service.disableSchedule('sch-123');
    expect(disabled.enabled).toBe(false);
  });
});
