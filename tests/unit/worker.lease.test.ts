/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { WorkerRuntime } from '../../src/workers/worker.runtime.js';

import { IJobRepository } from '../../src/repositories/job.repository.interface.js';
import { IQueueEngine } from '../../src/queue/queue.interface.js';
import { IExecutionEngine } from '../../src/execution/execution.interface.js';

describe('Worker Lease Heartbeat Unit Tests', () => {
  let mockRepository: jest.Mocked<IJobRepository>;
  let mockQueueEngine: jest.Mocked<IQueueEngine>;
  let mockExecutionEngine: jest.Mocked<IExecutionEngine>;

  beforeEach(() => {
    jest.useFakeTimers();

    mockRepository = {
      updateJobLease: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<IJobRepository>;

    mockQueueEngine = {} as unknown as jest.Mocked<IQueueEngine>;
    mockExecutionEngine = {} as unknown as jest.Mocked<IExecutionEngine>;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should start lease heartbeat during job execution and renew lease periodically', async () => {
    const worker = new WorkerRuntime(
      { workerId: 'worker-test-1', queues: ['default'], leaseRenewalIntervalMs: 100 },
      mockQueueEngine,
      mockRepository,
      mockExecutionEngine,
    );

    (worker as any).startLeaseHeartbeat('job-lease-123');

    // Advance 250ms to trigger 2 heartbeat intervals (100ms each)
    await jest.advanceTimersByTimeAsync(250);

    const { updateJobLease } = mockRepository;
    expect(updateJobLease).toHaveBeenCalledWith('job-lease-123', 'worker-test-1');
    expect(updateJobLease.mock.calls.length).toBeGreaterThanOrEqual(2);

    (worker as any).stopLeaseHeartbeat('job-lease-123');
  });

  it('should handle lease loss by recording lost lease and stopping heartbeat', async () => {
    mockRepository.updateJobLease.mockResolvedValueOnce(false);

    const worker = new WorkerRuntime(
      { workerId: 'worker-test-1', queues: ['default'], leaseRenewalIntervalMs: 100 },
      mockQueueEngine,
      mockRepository,
      mockExecutionEngine,
    );

    (worker as any).startLeaseHeartbeat('job-lease-123');

    await jest.advanceTimersByTimeAsync(150);

    const { updateJobLease } = mockRepository;
    expect(updateJobLease).toHaveBeenCalledWith('job-lease-123', 'worker-test-1');
    expect((worker as any).lostLeases.has('job-lease-123')).toBe(true);

    const callsCount = updateJobLease.mock.calls.length;
    await jest.advanceTimersByTimeAsync(300);

    // Heartbeat stopped after lease loss
    expect(updateJobLease.mock.calls.length).toBe(callsCount);
  });

  it('should stop all lease heartbeats cleanly when worker runtime stops', async () => {
    const worker = new WorkerRuntime(
      { workerId: 'worker-test-1', queues: ['default'], leaseRenewalIntervalMs: 100 },
      mockQueueEngine,
      mockRepository,
      mockExecutionEngine,
    );

    (worker as any).isRunning = true;
    (worker as any).startLeaseHeartbeat('job-lease-123');

    await jest.advanceTimersByTimeAsync(150);

    const { updateJobLease } = mockRepository;
    const initialCalls = updateJobLease.mock.calls.length;
    (worker as any).clearAllLeaseHeartbeats();

    await jest.advanceTimersByTimeAsync(300);

    expect(updateJobLease.mock.calls.length).toBe(initialCalls);
  });
});
