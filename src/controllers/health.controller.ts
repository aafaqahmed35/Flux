import { Request, Response } from 'express';
import { serverConfig } from '../config/server.js';
import { HTTP_STATUS } from '../constants/statusCodes.js';
import { getAppliedMigrations } from '../database/migrator.js';
import { pgPool } from '../database/postgres.js';
import { queueService } from '../queue/queue.service.js';
import { redisClient } from '../redis/redis.js';
import { retryEngine } from '../retry/retry.engine.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { processorRegistry } from '../workers/processor.registry.js';
import { workerRegistry } from '../workers/worker.registry.js';

const parseRedisInfo = (infoRaw: string): Record<string, string> => {
  const result: Record<string, string> = {};
  infoRaw.split('\r\n').forEach((line) => {
    if (line && !line.startsWith('#')) {
      const [key, val] = line.split(':');
      if (key && val) {
        result[key.trim()] = val.trim();
      }
    }
  });
  return result;
};

export const getHealth = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  let dbStatus = 'DOWN';
  let dbLatencyMs = -1;
  try {
    const start = Date.now();
    await pgPool.query('SELECT NOW()');
    dbLatencyMs = Date.now() - start;
    dbStatus = 'UP';
  } catch {
    dbStatus = 'DOWN';
  }

  let redisStatus = 'DOWN';
  let redisLatencyMs = -1;
  let redisVersion = 'UNKNOWN';
  let redisUptimeSeconds = -1;
  let redisRole = 'UNKNOWN';
  let usedMemoryHuman = 'UNKNOWN';
  let connectedClients = -1;

  try {
    if (redisClient.status !== 'ready' && redisClient.status !== 'connecting') {
      await redisClient.connect();
    }
    const start = Date.now();
    const resPing = await redisClient.ping();
    if (resPing === 'PONG') {
      redisLatencyMs = Date.now() - start;
      redisStatus = 'UP';

      const infoRaw = await redisClient.info();
      const parsedInfo = parseRedisInfo(infoRaw);

      redisVersion = parsedInfo['redis_version'] ?? 'UNKNOWN';
      redisUptimeSeconds = Number(parsedInfo['uptime_in_seconds'] ?? -1);
      redisRole = parsedInfo['role'] ?? 'UNKNOWN';
      usedMemoryHuman = parsedInfo['used_memory_human'] ?? 'UNKNOWN';
      connectedClients = Number(parsedInfo['connected_clients'] ?? -1);
    }
  } catch {
    redisStatus = 'DOWN';
  }

  let migrationStatus = 'UNKNOWN';
  let appliedCount = 0;
  let latestMigration: string | null = null;
  try {
    const applied = await getAppliedMigrations();
    appliedCount = applied.length;
    latestMigration = applied.length > 0 ? (applied[applied.length - 1]?.name ?? null) : null;
    migrationStatus = 'UP';
  } catch {
    migrationStatus = 'ERROR';
  }

  let queueMetrics = {
    pending: 0,
    queued: 0,
    processing: 0,
    scheduled: 0,
    deadletter: 0,
    activeWorkers: 0,
  };

  try {
    queueMetrics = await queueService.getMetrics();
  } catch {
    // Graceful fallback
  }

  let retryMetrics = {
    scheduled: 0,
    retrying: 0,
    deadletter: 0,
    averageDelayMs: 0,
  };

  try {
    const rm = await retryEngine.getMetrics();
    retryMetrics = {
      scheduled: rm.scheduled,
      retrying: rm.retrying,
      deadletter: rm.deadletter,
      averageDelayMs: rm.averageDelayMs,
    };
  } catch {
    // Graceful fallback
  }

  let workerMetrics = {
    registered: 0,
    active: 0,
    busy: 0,
    idle: 0,
    heartbeatAgeMs: -1,
    processorCount: processorRegistry.processorCount,
  };

  try {
    const activeWorkers = await workerRegistry.listActiveWorkers();
    const now = Date.now();
    let minHeartbeatAge = Infinity;

    let busyCount = 0;
    let idleCount = 0;

    activeWorkers.forEach((w) => {
      if (w.status !== 'OFFLINE') {
        const age = now - new Date(w.lastSeen).getTime();
        if (age < minHeartbeatAge) {
          minHeartbeatAge = age;
        }
      }
      if (w.status === 'BUSY') {
        busyCount++;
      } else if (w.status === 'IDLE') {
        idleCount++;
      }
    });

    workerMetrics = {
      registered: activeWorkers.length,
      active: activeWorkers.filter((w) => w.status !== 'OFFLINE').length,
      busy: busyCount,
      idle: idleCount,
      heartbeatAgeMs: minHeartbeatAge === Infinity ? -1 : minHeartbeatAge,
      processorCount: processorRegistry.processorCount,
    };
  } catch {
    // Graceful fallback
  }

  const overallStatus = dbStatus === 'UP' && redisStatus === 'UP' ? 'UP' : 'DEGRADED';
  const statusCode = overallStatus === 'UP' ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE;

  const healthData = {
    status: overallStatus,
    service: serverConfig.appName,
    version: serverConfig.appVersion,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    components: {
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
      },
      redis: {
        status: redisStatus,
        latencyMs: redisLatencyMs,
        version: redisVersion,
        uptimeSeconds: redisUptimeSeconds,
        role: redisRole,
        usedMemory: usedMemoryHuman,
        connectedClients,
      },
      migrations: {
        status: migrationStatus,
        appliedCount,
        latest: latestMigration,
      },
      queue: queueMetrics,
      retry: retryMetrics,
      workers: workerMetrics,
    },
  };

  res.status(statusCode).json(healthData);
});
