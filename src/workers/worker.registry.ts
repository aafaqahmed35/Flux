import os from 'os';
import { serverConfig } from '../config/server.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { QueueKeyFactory } from '../queue/queue.key.js';
import { redisClient } from '../redis/redis.js';
import { WorkerInfo, WorkerStatus } from './worker.types.js';

export class WorkerRegistry {
  private readonly redis = redisClient;

  buildWorkerInfo(
    workerId: string,
    queues: string[],
    concurrency: number,
    status: WorkerStatus = 'STARTING',
  ): WorkerInfo {
    const now = new Date().toISOString();
    return {
      workerId,
      hostname: os.hostname(),
      pid: process.pid,
      os: `${os.type()} ${os.release()}`,
      softwareVersion: serverConfig.appVersion,
      startedAt: now,
      lastSeen: now,
      status,
      currentJobId: null,
      currentConcurrency: 0,
      maxConcurrency: concurrency,
      supportedQueues: queues,
    };
  }

  async registerWorker(info: WorkerInfo): Promise<void> {
    try {
      if (this.redis.status !== 'ready' && this.redis.status !== 'connecting') {
        await this.redis.connect().catch(() => {});
      }
      const hashKey = QueueKeyFactory.workers();
      await this.redis.hset(hashKey, info.workerId, JSON.stringify(info));
      appLogger.info('Worker Registered', { workerId: info.workerId, status: info.status });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error('Failed to register worker in Redis', {
        workerId: info.workerId,
        error: msg,
      });
    }
  }

  async heartbeatWorker(
    workerId: string,
    status: WorkerStatus,
    currentJobId: string | null = null,
    currentConcurrency = 0,
  ): Promise<void> {
    try {
      if (this.redis.status !== 'ready' && this.redis.status !== 'connecting') {
        await this.redis.connect().catch(() => {});
      }
      const hashKey = QueueKeyFactory.workers();
      const existingRaw = await this.redis.hget(hashKey, workerId);
      if (!existingRaw) {
        return;
      }

      const info = JSON.parse(existingRaw) as WorkerInfo;
      info.lastSeen = new Date().toISOString();
      info.status = status;
      info.currentJobId = currentJobId;
      info.currentConcurrency = currentConcurrency;

      await this.redis.hset(hashKey, workerId, JSON.stringify(info));
      appLogger.info('Worker Heartbeat Updated', { workerId, status, currentConcurrency });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error('Worker Heartbeat Error', { workerId, error: msg });
    }
  }

  async deregisterWorker(workerId: string): Promise<void> {
    try {
      if (this.redis.status !== 'ready' && this.redis.status !== 'connecting') {
        await this.redis.connect().catch(() => {});
      }
      const hashKey = QueueKeyFactory.workers();
      await this.redis.hdel(hashKey, workerId);
      appLogger.info('Worker Deregistered', { workerId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLogger.error('Failed to deregister worker', { workerId, error: msg });
    }
  }

  async listActiveWorkers(): Promise<WorkerInfo[]> {
    try {
      if (this.redis.status !== 'ready' && this.redis.status !== 'connecting') {
        await this.redis.connect().catch(() => {});
      }
      const hashKey = QueueKeyFactory.workers();
      const allWorkersRaw = await this.redis.hgetall(hashKey);
      const now = Date.now();
      const workers: WorkerInfo[] = [];

      for (const [id, jsonStr] of Object.entries(allWorkersRaw)) {
        try {
          const info = JSON.parse(jsonStr) as WorkerInfo;
          const lastSeenMs = new Date(info.lastSeen).getTime();
          // Mark OFFLINE if lastSeen > 15s ago
          if (now - lastSeenMs > 15000) {
            info.status = 'OFFLINE';
          }
          workers.push(info);
        } catch {
          appLogger.warn('Corrupted worker entry in Redis', { workerId: id });
        }
      }

      return workers;
    } catch {
      return [];
    }
  }
}

export const workerRegistry = new WorkerRegistry();
