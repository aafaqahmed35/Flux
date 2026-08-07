/* eslint-disable @typescript-eslint/unbound-method */
import { Redis } from 'ioredis';
import { RedisQueue } from '../../src/queue/redis.queue.js';

describe('RedisQueue (Unit Tests)', () => {
  let mockRedisClient: jest.Mocked<Redis>;
  let redisQueue: RedisQueue;

  beforeEach(() => {
    const pipelineMock = {
      rpush: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      srem: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, 1],
        [null, 1],
      ]),
    };

    mockRedisClient = {
      status: 'ready',
      pipeline: jest.fn().mockReturnValue(pipelineMock),
      llen: jest.fn().mockResolvedValue(5),
      lrange: jest.fn().mockResolvedValue(['job-1', 'job-2']),
      lrem: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue(['emails', 'payments']),
      zcard: jest.fn().mockResolvedValue(0),
      hlen: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<Redis>;

    redisQueue = new RedisQueue(mockRedisClient);
  });

  it('should enqueue a job ID into Redis queue list', async () => {
    const result = await redisQueue.enqueue('emails', 'job-123');

    expect(result.jobId).toBe('job-123');
    expect(result.queueName).toBe('emails');
    expect(mockRedisClient.pipeline).toHaveBeenCalled();
  });

  it('should return queue length', async () => {
    const len = await redisQueue.queueLength('emails');
    expect(len).toBe(5);
    expect(mockRedisClient.llen).toHaveBeenCalledWith('flux:queue:emails');
  });

  it('should peek jobs in queue', async () => {
    const items = await redisQueue.peek('emails', 2);
    expect(items).toEqual(['job-1', 'job-2']);
    expect(mockRedisClient.lrange).toHaveBeenCalledWith('flux:queue:emails', 0, 1);
  });

  it('should remove a job ID from queue', async () => {
    const removed = await redisQueue.remove('emails', 'job-1');
    expect(removed).toBe(true);
    expect(mockRedisClient.lrem).toHaveBeenCalledWith('flux:queue:emails', 0, 'job-1');
  });

  it('should list registered queues', async () => {
    const queues = await redisQueue.listQueues();
    expect(queues).toEqual(['emails', 'payments']);
    expect(mockRedisClient.smembers).toHaveBeenCalledWith('flux:queues');
  });
});
